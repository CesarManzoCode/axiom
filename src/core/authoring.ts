// Workspaces, entities, drafts and sealing (§6, §7, §10, §34B/C/E).
// Drafts are the only mutable content. Seal validates contracts, resolves exact
// references and writes immutable revisions; a cohort seal is all-or-nothing.
import { canonicalJson, j, newId, pj, sha256, type Row } from "./db.ts";
import { DomainError, notFound, type Kernel } from "./kernel.ts";
import { ContentSchema, type Audience, type Content, type Ref } from "./types.ts";
import { classify, mapRefs, walkRefs, SEMANTIC_VIAS } from "./refs.ts";
import { accessOf, admits } from "./exposure.ts";
import {
  parsePayload,
  validateArgument,
  validateContext,
  validateEvaluation,
  validateRelation,
  validateResearch,
  type Lookup,
  type RevInfo,
} from "./validate.ts";
import { VOCAB_VERSION, type PayloadKind, type WorkspaceRole } from "./vocab.ts";

// ------------------------------------------------------------------ workspaces

export function createWorkspace(
  k: Kernel,
  actor: string,
  input: { name: string; description?: string; profile?: "classical_informal" | "unknown" },
) {
  if (!k.isHuman(actor) && k.agent(actor)?.kind !== "group")
    throw new DomainError("insufficient_permission", "Only a human or group agent can own a workspace.");
  return k.db.tx(() => {
    const ws = newId("wsp");
    k.db.run(
      "insert into workspaces(id, name, description, created_by, created_at) values(?,?,?,?,?)",
      ws,
      input.name,
      input.description ?? "",
      actor,
      k.now(),
    );
    k.db.run(
      "insert into memberships(workspace_id, agent_id, roles, active, since) values(?,?,?,1,?)",
      ws,
      actor,
      j(["owner"]),
      k.now(),
    );
    k.recordEvent({
      kind: "membership",
      workspace_id: ws,
      actor_id: actor,
      payload: { action: "grant", agent: actor, roles: ["owner"], reason: "workspace created" },
      audience: { mode: "workspace" },
    });
    const root = bootstrapRootContext(k, actor, ws, input.profile ?? "classical_informal");
    k.db.run("update workspaces set root_context_rev = ? where id = ?", root, ws);
    return { workspace_id: ws, root_context_rev: root };
  });
}

/** Root context (§10, T29): declares its own interpretation profile via a self-reference; no consistency claim. */
function bootstrapRootContext(k: Kernel, actor: string, ws: string, profile: "classical_informal" | "unknown") {
  const content: Content = ContentSchema.parse({
    kind: "context",
    title: profile === "classical_informal" ? "Root context — classical informal mathematics" : "Root context — foundations unknown",
    context: { self: true },
    payload: {
      root: true,
      profile,
      foundations:
        profile === "classical_informal"
          ? "Classical informal mathematics (interpretation profile declaration; no consistency claim)"
          : "unknown",
      conventions:
        profile === "classical_informal"
          ? "Classical logic, informal set-theoretic background; no library or checker imported."
          : "Interpretation profile intentionally left unknown; formal export is incomplete.",
    },
    provenance: { origin: "deterministic", acquisition: "authorship", notes: "Workspace bootstrap" },
    contributions: [],
  });
  const { entity_id } = insertEntity(k, actor, ws, "context", content.title, ["context"], { mode: "team" }, "curated");
  const draft = insertDraft(k, actor, entity_id, ws, content, []);
  return sealDrafts(k, actor, [draft]).revisions[0];
}

export function addMember(k: Kernel, actor: string, ws: string, agentId: string, roles: WorkspaceRole[], reason = "") {
  k.requireRole(ws, actor, "owner");
  if (!k.agent(agentId)) throw notFound();
  k.db.tx(() => {
    k.db.run(
      `insert into memberships(workspace_id, agent_id, roles, active, since) values(?,?,?,1,?)
       on conflict(workspace_id, agent_id) do update set roles = excluded.roles, active = 1`,
      ws,
      agentId,
      j(roles),
      k.now(),
    );
    k.recordEvent({
      kind: "membership",
      workspace_id: ws,
      actor_id: actor,
      payload: { action: "grant", agent: agentId, roles, reason },
      audience: { mode: "workspace" },
    });
  });
}

/** Revoking cuts future access; it cannot make already received copies forgotten (§22). */
export function revokeMember(k: Kernel, actor: string, ws: string, agentId: string, reason = "") {
  k.requireRole(ws, actor, "owner");
  const owners = k.db
    .all("select agent_id, roles from memberships where workspace_id = ? and active = 1", ws)
    .filter((m) => pj<string[]>(m.roles).includes("owner"));
  if (owners.length === 1 && owners[0].agent_id === agentId)
    throw new DomainError("invalid_transition", "The last owner cannot be removed; transfer stewardship first.");
  k.db.tx(() => {
    k.db.run("update memberships set active = 0 where workspace_id = ? and agent_id = ?", ws, agentId);
    k.recordEvent({
      kind: "membership",
      workspace_id: ws,
      actor_id: actor,
      payload: { action: "revoke", agent: agentId, reason },
      audience: { mode: "workspace" },
    });
  });
}

// ------------------------------------------------------------------ entities & drafts

function insertEntity(
  k: Kernel,
  actor: string,
  ws: string,
  kind: PayloadKind,
  title: string,
  facets: string[],
  access: Audience,
  namespace: "curated" | "candidate",
  fixture?: string,
) {
  const id = newId("ent");
  const ev = k.recordEvent({
    kind: "entity_created",
    workspace_id: ws,
    actor_id: actor,
    subject_entity: id,
    payload: { kind, namespace },
    audience: { mode: "subject" },
  });
  k.db.run(
    `insert into entities(id, workspace_id, namespace, kind, facets, title, access, owner_id, steward_id,
      created_event, created_at, fixture_label) values(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    ws,
    namespace,
    kind,
    j(facets),
    title,
    j(access),
    actor,
    actor,
    ev.id,
    k.now(),
    fixture ?? null,
  );
  return { entity_id: id };
}

function insertDraft(k: Kernel, actor: string, entityId: string, ws: string, content: unknown, baseRevs: string[], intent?: string) {
  const id = newId("drf");
  k.db.run(
    `insert into drafts(id, entity_id, workspace_id, author_id, content, base_revs, generation, status,
      created_at, updated_at, intent) values(?,?,?,?,?,?,1,'editing',?,?,?)`,
    id,
    entityId,
    ws,
    actor,
    j(content),
    j(baseRevs),
    k.now(),
    k.now(),
    intent ?? null,
  );
  return id;
}

export interface CreateEntityInput {
  workspace_id: string;
  kind: PayloadKind;
  title: string;
  facets?: string[];
  access?: Audience;
  namespace?: "curated" | "candidate";
  content?: Partial<Content>;
  fixture_label?: string;
}

/** Workflow 3: a new anchor with a lightweight draft; only content and inherited context are needed. */
export function createEntity(k: Kernel, actor: string, input: CreateEntityInput) {
  const ns = input.namespace ?? "curated";
  if (ns === "candidate") {
    if (!k.isMember(input.workspace_id, actor)) throw notFound();
  } else k.requireRole(input.workspace_id, actor, "editor", "curator");
  const access = input.access ?? { mode: "team" };
  if (access.mode === "public")
    throw new DomainError("invalid_input", "Public visibility is obtained by publishing a sealed revision, not at creation.");
  const ws = k.db.get("select * from workspaces where id = ?", input.workspace_id)!;
  return k.db.tx(() => {
    const { entity_id } = insertEntity(
      k,
      actor,
      input.workspace_id,
      input.kind,
      input.title,
      input.facets ?? [input.kind],
      access,
      ns,
      input.fixture_label,
    );
    const content = {
      kind: input.kind,
      title: input.title,
      facets: input.facets ?? [input.kind],
      context: { rev: ws.root_context_rev },
      payload: {},
      representations: [],
      references: [],
      contributions: [],
      parents: [],
      ...input.content,
      provenance: { origin: k.agent(actor)?.kind === "ai" ? "ai" : "human", acquisition: "authorship", ...input.content?.provenance },
    };
    const draft_id = insertDraft(k, actor, entity_id, input.workspace_id, content, []);
    return { entity_id, draft_id };
  });
}

function requireDraftEditor(k: Kernel, actor: string, d: Row) {
  if (!k.viewer(actor).canSeeDraft(d)) throw notFound();
  const ent = k.entityRow(d.entity_id)!;
  if (d.author_id === actor) return;
  if (ent.namespace === "candidate" && ent.owner_id === actor) return;
  k.requireRole(d.workspace_id, actor, "editor");
}

/** Save draft content against its generation; a stale baseline is a conflict, never a silent overwrite (I50, AC47). */
export function saveDraft(k: Kernel, actor: string, draftId: string, content: unknown, generation: number) {
  const d = k.db.get("select * from drafts where id = ?", draftId);
  if (!d) throw notFound();
  requireDraftEditor(k, actor, d);
  if (d.status !== "editing") throw new DomainError("invalid_transition", `Draft is ${d.status}.`);
  if (d.generation !== generation)
    throw new DomainError(
      "stale_draft",
      "This draft changed since you loaded it. Your text was not saved over the other edit; save it as an alternative draft or merge manually.",
      { current_generation: d.generation, current_content: pj(d.content), updated_at: d.updated_at },
    );
  k.db.run(
    "update drafts set content = ?, generation = generation + 1, updated_at = ? where id = ?",
    j(content),
    k.now(),
    draftId,
  );
  return { draft_id: draftId, generation: generation + 1 };
}

/** Keep a conflicting edit as a sibling draft on the same baseline (alternatives, not overwrite). */
export function saveAsAlternativeDraft(k: Kernel, actor: string, draftId: string, content: unknown) {
  const d = k.db.get("select * from drafts where id = ?", draftId);
  if (!d) throw notFound();
  requireDraftEditor(k, actor, d);
  const id = insertDraft(k, actor, d.entity_id, d.workspace_id, content, pj(d.base_revs), "alternative");
  return { draft_id: id };
}

export function discardDraft(k: Kernel, actor: string, draftId: string) {
  const d = k.db.get("select * from drafts where id = ?", draftId);
  if (!d) throw notFound();
  requireDraftEditor(k, actor, d);
  if (d.status !== "editing") throw new DomainError("invalid_transition", `Draft is ${d.status}.`);
  k.db.run("update drafts set status = 'discarded', updated_at = ? where id = ?", k.now(), draftId);
  return { ok: true };
}

/** Workflow 5/11: a new draft descending from exact sealed revision(s). Siblings are legal (no global head). */
export function draftFromRevision(k: Kernel, actor: string, revIds: string[], intent?: string) {
  const v = k.viewer(actor);
  const revs = revIds.map((id) => {
    if (!v.canSeeRev(id)) throw notFound();
    return k.revRow(id)!;
  });
  const entity = revs[0].entity_id;
  if (revs.some((r) => r.entity_id !== entity))
    throw new DomainError("invalid_input", "Parents of a revision belong to the same entity; use derived_from for other anchors.");
  const ent = k.entityRow(entity)!;
  if (ent.namespace === "curated") k.requireRole(ent.workspace_id, actor, "editor");
  const content = { ...pj(revs[0].content), parents: revIds, change_summary: "" };
  const id = insertDraft(k, actor, entity, ent.workspace_id, content, revIds, intent);
  return { draft_id: id, entity_id: entity };
}

/**
 * Derive a new, autonomous anchor from existing revisions (fork / redaction / public derivative).
 * The lineage is kept as a private `derived_from` ledger entry: it never enters exposure closure
 * and never publishes the parent ID (§22, T30, AC58).
 */
export function deriveEntity(
  k: Kernel,
  actor: string,
  fromRev: string,
  input: { title?: string; access?: Audience; reason: string },
) {
  const v = k.viewer(actor);
  if (!v.canSeeRev(fromRev)) throw notFound();
  const src = k.revRow(fromRev)!;
  k.requireRole(src.workspace_id, actor, "editor");
  return k.db.tx(() => {
    const c = pj(src.content);
    const title = input.title ?? c.title;
    const { entity_id } = insertEntity(k, actor, src.workspace_id, c.kind, title, c.facets ?? [c.kind], input.access ?? { mode: "team" }, "curated");
    const content = {
      ...c,
      title,
      parents: [],
      provenance: { ...c.provenance, acquisition: "editorial_transformation", notes: input.reason },
      change_summary: `Derived anchor: ${input.reason}`,
    };
    const draft_id = insertDraft(k, actor, entity_id, src.workspace_id, content, [], "derived");
    k.recordEvent({
      kind: "lineage",
      workspace_id: src.workspace_id,
      actor_id: actor,
      subject_entity: entity_id,
      payload: { relation: "derived_from", from_rev: fromRev, reason: input.reason },
      audience: { mode: "workspace" },
    });
    return { entity_id, draft_id };
  });
}

// ------------------------------------------------------------------ live selector resolution

export function preferredRevision(k: Kernel, entityId: string, viewer = k.viewer(null)): string | undefined {
  const sel = k.events("kind = 'preferred_selected' and subject_entity = ?", entityId).filter((e) => viewer.canSeeEvent(e));
  const last = sel.at(-1);
  if (last && viewer.canSeeRev(last.payload.rev)) return last.payload.rev;
  return undefined;
}

export function mostRecentVisible(k: Kernel, entityId: string, viewer = k.viewer(null)): string | undefined {
  return k
    .revisionsOf(entityId)
    .filter((r) => viewer.canSeeRev(r.id))
    .at(-1)?.id;
}

/**
 * Turn live selectors in a draft into exact references, as an explicit user action whose
 * result is shown (AC11). Seal itself never resolves "latest".
 */
export function resolveSelectors(k: Kernel, actor: string, draftId: string) {
  const d = k.db.get("select * from drafts where id = ?", draftId);
  if (!d) throw notFound();
  requireDraftEditor(k, actor, d);
  const v = k.viewer(actor);
  const resolutions: { entity: string; selector: string; rev: string | null; basis: string }[] = [];
  const content = mapRefs(pj(d.content), (ref) => {
    if (!("entity" in ref)) return ref;
    const preferred = preferredRevision(k, ref.entity, v);
    const rev = ref.selector === "preferred" ? preferred : (preferred ?? mostRecentVisible(k, ref.entity, v));
    resolutions.push({
      entity: ref.entity,
      selector: ref.selector,
      rev: rev ?? null,
      basis: rev ? (rev === preferred ? "explicit preferred selection" : "most recent sealed revision visible to you") : "unresolved",
    });
    return rev ? { rev } : ref;
  });
  k.db.run(
    "update drafts set content = ?, generation = generation + 1, updated_at = ? where id = ?",
    j(content),
    k.now(),
    draftId,
  );
  return { resolutions, generation: d.generation + 1 };
}

export function selectPreferred(k: Kernel, actor: string, revId: string, scope: string) {
  const rev = k.revRow(revId);
  if (!rev || !k.viewer(actor).canSeeRev(revId)) throw notFound();
  k.requireRole(rev.workspace_id, actor, "editor", "curator");
  return k.recordEvent({
    kind: "preferred_selected",
    workspace_id: rev.workspace_id,
    actor_id: actor,
    subject_entity: rev.entity_id,
    subject_rev: revId,
    payload: { rev: revId, scope },
    audience: { mode: "workspace" },
  });
}

// ------------------------------------------------------------------ seal

function lookupFactory(k: Kernel, cohort: Map<string, RevInfo>): Lookup {
  return (revId) => {
    const c = cohort.get(revId);
    if (c) return c;
    const r = k.revRow(revId);
    if (!r) return undefined;
    const ent = k.entityRow(r.entity_id)!;
    return { id: r.id, entity_id: r.entity_id, workspace_id: r.workspace_id, kind: r.kind, namespace: ent.namespace, content: pj(r.content) };
  };
}

function readableRepresentation(c: Content): Content["representations"] {
  if (c.representations.some((r) => ["text", "latex"].includes(r.modality))) return c.representations;
  const p: any = c.payload;
  const body = p.statement ?? p.description ?? p.goal ?? p.interpretation ?? p.summary ?? p.citation ?? p.foundations ?? c.title;
  return [
    ...c.representations,
    { id: "readable", modality: "text", content: String(body), meaning_role: "statement", bindings: [] },
  ];
}

export interface SealResult {
  revisions: string[];
  event_id: string;
  replayed: boolean;
}

/**
 * Seal one draft or a cohort of mutually referencing drafts as a joint snapshot.
 * Reserved IDs become stable references only if the whole cohort validates (AC32).
 */
export function sealDrafts(k: Kernel, actor: string, draftIds: string[], opts: { idem_key?: string } = {}): SealResult {
  if (!draftIds.length) throw new DomainError("invalid_input", "Nothing to seal.");
  if (opts.idem_key) {
    const prev = k.db.get("select payload, idem_hash from events where idem_key = ?", opts.idem_key);
    if (prev) {
      const p = pj(prev.payload);
      if (canonicalJson([...p.drafts].sort()) !== canonicalJson([...draftIds].sort()))
        throw new DomainError("idempotency_conflict", "This activity identifier was already used for other drafts.");
      const ev = k.db.get("select id from events where idem_key = ?", opts.idem_key)!;
      return { revisions: p.revisions, event_id: ev.id, replayed: true };
    }
  }
  const viewer = k.viewer(actor);
  return k.db.tx(() => {
    const drafts = draftIds.map((id) => {
      const d = k.db.get("select * from drafts where id = ?", id);
      if (!d) throw notFound();
      requireDraftEditor(k, actor, d);
      if (d.status !== "editing") throw new DomainError("invalid_transition", `Draft ${id} is ${d.status}.`);
      return d;
    });
    const reserved = new Map(drafts.map((d) => [d.id, newId("rev")]));
    const cohort = new Map<string, RevInfo>();
    const prepared: { d: Row; ent: Row; content: Content; revId: string }[] = [];

    for (const d of drafts) {
      const ent = k.entityRow(d.entity_id)!;
      const revId = reserved.get(d.id)!;
      const unresolved: string[] = [];
      const raw = mapRefs(pj(d.content), (ref: Ref) => {
        if ("draft" in ref) {
          const r = reserved.get(ref.draft);
          if (!r) {
            unresolved.push(`draft ${ref.draft} is not part of this snapshot`);
            return ref;
          }
          return ref.slot ? { rev: r, slot: ref.slot } : { rev: r };
        }
        if ("entity" in ref) unresolved.push(`live selector '${ref.selector}' on entity ${ref.entity}`);
        return ref;
      });
      if (unresolved.length)
        throw new DomainError(
          "reference_unresolved",
          "Sealed content must reference exact revisions. Resolve live selectors explicitly first.",
          unresolved,
        );
      const parsed = ContentSchema.safeParse(raw);
      if (!parsed.success)
        throw new DomainError(
          "contract_violation",
          "Content is incomplete for sealing.",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
      const content = parsed.data;
      if (content.kind !== ent.kind)
        throw new DomainError("contract_violation", `Entity ${ent.id} holds '${ent.kind}' content, not '${content.kind}'.`);
      content.payload = parsePayload(content);
      content.representations = readableRepresentation(content);
      cohort.set(revId, {
        id: revId,
        entity_id: ent.id,
        workspace_id: ent.workspace_id,
        kind: content.kind,
        namespace: ent.namespace,
        content: (content.context as any)?.self ? content : content,
      });
      prepared.push({ d, ent, content, revId });
    }

    const lookup = lookupFactory(k, cohort);
    for (const { d, ent, content, revId } of prepared) {
      // Exact references must exist and be visible to the sealer.
      const missing: string[] = [];
      walkRefs(content, (ref, path) => {
        if (!("rev" in ref)) return;
        if (cohort.has(ref.rev)) return;
        if (!k.revRow(ref.rev) || !viewer.canSeeRev(ref.rev)) missing.push(`${path.join(".")} → ${ref.rev}`);
        const info = lookup(ref.rev);
        const cls = classify(content, path);
        if (
          info &&
          info.namespace === "candidate" &&
          ent.namespace === "curated" &&
          !["subject", "compared", "provenance", "parent"].includes(cls.via)
        )
          throw new DomainError(
            "gate_missing",
            `Curated content cannot adopt candidate content '${info.content.title}' without a gate decision; review it or state the premise as a visible hypothesis.`,
          );
      });
      if (missing.length) throw new DomainError("reference_unresolved", "Referenced revisions are not resolvable.", missing);

      // A revision may only reference what its own audience can read; otherwise sealing would
      // leak IDs/titles of narrower material to that audience (§22).
      const ownAudience = pj(ent.access);
      const narrower: string[] = [];
      walkRefs(content, (ref, path) => {
        if (!("rev" in ref)) return;
        const cls = classify(content, path);
        if (!SEMANTIC_VIAS.has(cls.via)) return;
        const t = cohort.has(ref.rev)
          ? {
              workspace_id: cohort.get(ref.rev)!.workspace_id,
              access: { ...pj(k.entityRow(cohort.get(ref.rev)!.entity_id)!.access), owner: k.entityRow(cohort.get(ref.rev)!.entity_id)!.owner_id },
              publications: [],
            }
          : accessOf(k, ref.rev);
        if (t && !admits(k, t, ownAudience, ent.workspace_id, ent.owner_id))
          narrower.push(`${path.join(".")} → ${lookup(ref.rev)?.content.title ?? ref.rev}`);
      });
      if (narrower.length)
        throw new DomainError(
          "exposure_conflict",
          "This revision's audience could not read some referenced items. Narrow its visibility, publish the referenced items to that audience first, or remove the references.",
          narrower,
        );

      // Ancestry: parents are sealed revisions of this same entity (DAG by construction).
      for (const p of content.parents) {
        const pr = k.revRow(p);
        if (!pr || pr.entity_id !== ent.id)
          throw new DomainError("cycle", "Revision parents must be existing revisions of the same entity.");
      }

      // Context: exact, of kind context; self only for root.
      const ctx = content.context as any;
      if (!ctx.self) {
        const info = lookup(ctx.rev);
        if (!info || info.kind !== "context")
          throw new DomainError("reference_unresolved", "The context reference must be an exact Context revision.");
      } else if (content.kind !== "context" || !(content.payload as any).root)
        throw new DomainError("contract_violation", "Only a root context may be its own context.");

      // Provenance minimum for curated content (I35).
      const prov = content.provenance;
      if (
        ent.namespace === "curated" &&
        ["import", "extraction"].includes(prov.acquisition) &&
        !prov.sources.length &&
        !prov.original_attribution
      )
        throw new DomainError(
          "missing_provenance",
          "Imported or extracted content needs a source or an explicit original attribution.",
        );

      const ownCtx = ctx.self ? revId : ctx.rev;
      switch (content.kind) {
        case "relation":
          validateRelation(k, lookup, content.payload as any, ownCtx);
          break;
        case "context":
          validateContext(lookup, content, content.payload as any, ent.id);
          break;
        case "evaluation":
          validateEvaluation(lookup, content.payload);
          break;
        case "research":
          validateResearch(content.payload);
          break;
        case "argument":
          validateArgument(lookup, content.payload);
          break;
        case "source": {
          const p: any = content.payload;
          if (p.revision_identity.status === "unknown" && !p.revision_identity.reason)
            throw new DomainError("contract_violation", "An unknown source edition must state why it is unknown.");
          break;
        }
      }
      void d;
    }

    // Write: revisions, edge index, drafts → sealed.
    const sealedAt = k.now();
    const ev = k.recordEvent({
      kind: "sealed",
      workspace_id: prepared[0].ent.workspace_id,
      actor_id: actor,
      payload: { drafts: draftIds, revisions: prepared.map((p) => p.revId), cohort: prepared.length > 1 },
      audience: { mode: "workspace" },
      idem_key: opts.idem_key,
    });
    for (const { d, ent, content, revId } of prepared) {
      const seq = (k.db.get("select coalesce(max(seq),0) as m from revisions where entity_id = ?", ent.id)!.m as number) + 1;
      const access = { ...pj(ent.access), owner: ent.owner_id };
      const ctx = content.context as any;
      k.db.run(
        `insert into revisions(id, entity_id, workspace_id, seq, kind, title, content, context_rev, parents, access,
          content_hash, sealed_at, sealed_by, seal_event, vocab) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        revId,
        ent.id,
        ent.workspace_id,
        seq,
        content.kind,
        content.title,
        j(content),
        ctx.self ? revId : ctx.rev,
        j(content.parents),
        j(access),
        sha256(canonicalJson(content)),
        sealedAt,
        actor,
        ev.id,
        VOCAB_VERSION,
      );
      indexEdges(k, revId, content, lookup);
      k.db.run("update drafts set status = 'sealed', sealed_rev = ?, updated_at = ? where id = ?", revId, sealedAt, d.id);
      if (content.title !== ent.title) k.db.run("update entities set title = ? where id = ?", content.title, ent.id);
    }
    checkStructuralAcyclic(k, prepared.map((p) => p.revId));
    checkContextAcyclic(k, prepared.map((p) => p.revId));
    for (const { revId, content } of prepared) notifyConsumersOfUpdate(k, revId, content.parents);
    return { revisions: prepared.map((p) => p.revId), event_id: ev.id, replayed: false };
  });
}

export function indexEdges(k: Kernel, revId: string, content: Content, lookup: Lookup) {
  const structuralContract =
    content.kind === "relation" && ["has_part", "contains"].includes((content.payload as any).contract?.id);
  walkRefs(content, (ref, path) => {
    if (!("rev" in ref)) return;
    const cls = classify(content, path);
    const info = lookup(ref.rev);
    const structural =
      cls.structural || (structuralContract && cls.via === "participant" && cls.role === "part") ? 1 : 0;
    k.db.run(
      `insert into refs(rev_id, target_rev, target_entity, via, role, slot, dep_kind, origin, structural, locator)
       values(?,?,?,?,?,?,?,?,?,?)`,
      revId,
      ref.rev,
      info?.entity_id ?? "",
      cls.via,
      cls.role ?? null,
      cls.slot ?? ref.slot ?? null,
      cls.dep_kind ?? null,
      cls.origin ?? null,
      structural,
      cls.locator ?? null,
    );
  });
  // A structural relation whose whole is W makes W structurally contain its parts.
  if (structuralContract) {
    const p: any = content.payload;
    const whole = p.slots.find((s: any) => s.role === "whole")?.ref?.rev;
    for (const s of p.slots.filter((s: any) => s.role === "part"))
      k.db.run(
        `insert into refs(rev_id, target_rev, target_entity, via, role, slot, structural) values(?,?,?,?,?,?,1)`,
        whole,
        s.ref.rev,
        lookup(s.ref.rev)?.entity_id ?? "",
        "structural_relation",
        "part",
        s.slot,
      );
  }
}

/** Structural containment (has_part/contains, manifests) must stay acyclic (I08, AC31). */
function checkStructuralAcyclic(k: Kernel, newRevs: string[]) {
  const children = (rev: string) =>
    k.db.all("select target_rev from refs where rev_id = ? and structural = 1", rev).map((r) => r.target_rev as string);
  for (const start of newRevs) {
    const stack = [...children(start)];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === start) throw new DomainError("cycle", "Structural containment would contain itself (cycle).");
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...children(cur));
    }
  }
}

/** Interpretive imports and context parents must stay acyclic (I07). */
function checkContextAcyclic(k: Kernel, newRevs: string[]) {
  const next = (rev: string) =>
    k.db
      .all("select target_rev from refs where rev_id = ? and via in ('context_parent','context_import')", rev)
      .map((r) => r.target_rev as string);
  for (const start of newRevs) {
    const stack = [...next(start)];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === start) throw new DomainError("cycle", "Context imports/parents would form a cycle.");
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...next(cur));
    }
  }
}

/** A new revision of Y notifies consumers pinned to its parents; nothing is rewritten (AC12, workflow 11). */
function notifyConsumersOfUpdate(k: Kernel, newRev: string, parents: string[]) {
  for (const parent of parents) {
    const consumers = k.db.all(
      "select distinct rev_id from refs where target_rev = ? and via != 'parent'",
      parent,
    );
    for (const c of consumers) {
      const cr = k.revRow(c.rev_id);
      if (!cr) continue;
      const ent = k.entityRow(cr.entity_id)!;
      const recipients = new Set([cr.sealed_by, ent.owner_id]);
      for (const agent of recipients) {
        if (!k.viewer(agent).canSeeRev(newRev)) continue;
        k.notify(agent, cr.workspace_id, "update_available", {
          consumer_rev: cr.id,
          consumer_title: cr.title,
          pinned_rev: parent,
          new_rev: newRev,
          message: "A newer revision exists. Your revision still uses the pinned one; compare and migrate explicitly if wanted.",
        });
      }
    }
    k.recordEvent({
      kind: "update_available",
      subject_rev: parent,
      subject_entity: k.revRow(parent)?.entity_id,
      workspace_id: k.revRow(parent)?.workspace_id,
      payload: { from: parent, to: newRev },
      audience: { mode: "subject" },
    });
  }
}

// ------------------------------------------------------------------ convenience

/** Create an entity and seal its first revision in one step (used by guided forms and imports). */
export function createAndSeal(k: Kernel, actor: string, input: CreateEntityInput & { content: Partial<Content> }, opts: { idem_key?: string } = {}) {
  if (opts.idem_key) {
    const prev = k.db.get("select payload from events where idem_key = ?", opts.idem_key);
    if (prev) {
      const p = pj(prev.payload);
      const rev = k.revRow(p.revisions[0])!;
      return { entity_id: rev.entity_id, rev: rev.id, replayed: true };
    }
  }
  return k.db.tx(() => {
    const { entity_id, draft_id } = createEntity(k, actor, input);
    const r = sealDrafts(k, actor, [draft_id], opts);
    return { entity_id, rev: r.revisions[0], replayed: false };
  });
}

export function registerExtensionContract(
  k: Kernel,
  actor: string,
  ws: string,
  def: { id: string; version: string; family?: string; roles: { role: string; card: { min: number; max: number | null } }[]; description: string },
) {
  k.requireRole(ws, actor, "curator");
  if (k.db.get("select 1 from contracts where id = ? and version = ?", def.id, def.version))
    throw new DomainError("invalid_transition", "A contract revision is immutable; register a new version.");
  k.db.run(
    "insert into contracts(id, version, workspace_id, definition, created_by, created_at) values(?,?,?,?,?,?)",
    def.id,
    def.version,
    ws,
    j({ ...def, family: def.family ?? "extension", directed: true, inference: "none" }),
    actor,
    k.now(),
  );
  k.recordEvent({ kind: "contract_registered", workspace_id: ws, actor_id: actor, payload: def, audience: { mode: "workspace" } });
  return { id: def.id, version: def.version };
}

export { SEMANTIC_VIAS };
