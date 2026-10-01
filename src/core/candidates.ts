// Candidate/curated boundary (§21, §34H). Candidates live in a separate namespace with their
// own gate states; only a human gate decision, separate from the producing agent, admits
// content into the curated corpus — and the decision is editorial admission, never truth.
import { pj } from "./db.ts";
import { DomainError, notFound, type Kernel } from "./kernel.ts";
import { createEntity, sealDrafts } from "./authoring.ts";
import { mapRefs } from "./refs.ts";
import { j, newId } from "./db.ts";
import { GATE_TRANSITIONS, type GateState, type PayloadKind } from "./vocab.ts";
import type { Content } from "./types.ts";

export function gateStateOf(k: Kernel, entityId: string) {
  const events = k.events("kind = 'gate' and subject_entity = ?", entityId);
  let state: GateState = "proposed";
  for (const e of events) if (e.payload.to) state = e.payload.to;
  return {
    state,
    history: events.map((e) => ({
      id: e.id,
      to: e.payload.to,
      action: e.payload.action,
      reason: e.payload.reason,
      scope: e.payload.scope,
      curated_rev: e.payload.curated_rev,
      fragment: e.payload.fragment,
      actor: k.agentDescriptor(e.actor_id),
      independence: e.payload.independence,
      at: e.recorded_at,
    })),
  };
}

export interface CandidateInput {
  workspace_id: string;
  kind: PayloadKind;
  title: string;
  content: Partial<Content>;
  proposed_kind?: string;
  uncertainty?: string;
  fixture_label?: string;
}

/** Workflow 15 / §21: an agent (or a manual import) delivers a proposal into the separate inbox. */
export function submitCandidate(k: Kernel, actor: string, input: CandidateInput, opts: { idem_key?: string } = {}) {
  if (opts.idem_key) {
    const prev = k.db.get("select subject_entity from events where idem_key = ?", opts.idem_key);
    if (prev) {
      const rev = k.revisionsOf(prev.subject_entity)[0];
      return { entity_id: prev.subject_entity, rev: rev.id, replayed: true };
    }
  }
  const agentKind = k.agent(actor)?.kind;
  return k.db.tx(() => {
    const { entity_id, draft_id } = createEntity(k, actor, {
      workspace_id: input.workspace_id,
      kind: input.kind,
      title: input.title,
      namespace: "candidate",
      fixture_label: input.fixture_label,
      content: {
        ...input.content,
        provenance: {
          origin: agentKind === "ai" ? "ai" : agentKind === "service" ? "deterministic" : "human",
          acquisition: "extraction",
          ...input.content.provenance,
        } as any,
      },
    });
    const sealed = sealDrafts(k, actor, [draft_id]);
    k.recordEvent({
      kind: "gate",
      workspace_id: input.workspace_id,
      actor_id: actor,
      subject_entity: entity_id,
      subject_rev: sealed.revisions[0],
      payload: { to: "proposed", action: "submitted", proposed_kind: input.proposed_kind ?? input.kind, uncertainty: input.uncertainty },
      audience: { mode: "workspace" },
      idem_key: opts.idem_key,
    });
    return { entity_id, rev: sealed.revisions[0], replayed: false };
  });
}

function requireHumanGate(k: Kernel, actor: string, candidateEntity: string) {
  const ent = k.entityRow(candidateEntity);
  if (!ent || ent.namespace !== "candidate" || !k.viewer(actor).canSeeEntity(candidateEntity)) throw notFound();
  const kind = k.agent(actor)?.kind;
  if (kind !== "human")
    throw new DomainError("gate_missing", "Gate decisions require an authorized human reviewer; agents and services cannot decide (I39, I40).");
  k.requireRole(ent.workspace_id, actor, "curator", "editor");
  // A human may admit their own extraction/text as an attributed assertion (§21, §34H); the
  // record says so. Agents never gate (checked above), so no agent output is self-approved.
  const producer = ent.owner_id;
  const operator = k.agent(producer)?.operator_id;
  return {
    ent,
    independence:
      producer === actor
        ? "Self-admission by the human producer (own text or extraction); not an independent review."
        : operator === actor
          ? "Reviewer operates the producing agent; this is the operator's own review, not independent validation."
          : "Reviewer is distinct from the producer.",
  };
}

export function gateTransition(k: Kernel, actor: string, candidateEntity: string, input: { to: GateState; reason: string }) {
  const { ent, independence } = requireHumanGate(k, actor, candidateEntity);
  const { state } = gateStateOf(k, candidateEntity);
  if (input.to === "promoted") throw new DomainError("invalid_transition", "Use promote to admit content.");
  if (!GATE_TRANSITIONS[state].includes(input.to))
    throw new DomainError("invalid_transition", `Cannot move a candidate from ${state} to ${input.to}.`);
  if (["rejected", "quarantined"].includes(input.to) && !input.reason.trim())
    throw new DomainError("invalid_input", "Rejection and quarantine record a reason.");
  return k.recordEvent({
    kind: "gate",
    workspace_id: ent.workspace_id,
    actor_id: actor,
    subject_entity: candidateEntity,
    payload: { to: input.to, action: input.to, reason: input.reason, independence },
    audience: { mode: "workspace" },
  });
}

export interface PromoteInput {
  candidate_rev: string;
  scope: string;
  decision: string;
  edited_content?: Partial<Content>;
  fragment?: { content: Partial<Content>; locator: string };
  idem_key?: string;
}

/** Promotion maps candidate → curated IDs; a reference to an unpromoted candidate blocks the gate. */
function curatedFor(k: Kernel, candidateRev: string): string | undefined {
  const e = k.db.get(
    "select payload from events where kind = 'gate' and subject_rev = ? and json_extract(payload, '$.action') = 'promoted'",
    candidateRev,
  );
  return e ? pj(e.payload).curated_rev : undefined;
}

export function promote(k: Kernel, actor: string, input: PromoteInput) {
  if (input.idem_key) {
    const prev = k.db.get("select payload, idem_hash from events where idem_key = ?", input.idem_key);
    if (prev) {
      const p = pj(prev.payload);
      if (p.candidate_rev !== input.candidate_rev)
        throw new DomainError("idempotency_conflict", "This activity identifier was used for another gate decision.");
      return { curated_rev: p.curated_rev, curated_entity: p.curated_entity, replayed: true };
    }
  }
  const crow = k.revRow(input.candidate_rev);
  if (!crow) throw notFound();
  const { ent, independence } = requireHumanGate(k, actor, crow.entity_id);
  const gs = gateStateOf(k, ent.id).state;
  if (!["proposed", "under_review"].includes(gs))
    throw new DomainError("invalid_transition", `A ${gs} candidate cannot be promoted; reopen it for review first.`);
  if (!input.scope.trim()) throw new DomainError("invalid_input", "A gate decision states its scope (e.g. 'faithful transcription').");
  const cand: Content = pj(crow.content);
  const mapping = input.fragment ? "fragment" : input.edited_content ? "edited" : "whole";
  const base = input.fragment?.content ?? input.edited_content ?? {};
  const merged: any = { ...cand, ...base, payload: base.payload ?? cand.payload };
  const missing: string[] = [];
  const content = mapRefs(merged, (ref) => {
    if (!("rev" in ref)) return ref;
    const target = k.revRow(ref.rev);
    if (!target) return ref;
    if (k.entityRow(target.entity_id)!.namespace !== "candidate") return ref;
    const cur = curatedFor(k, ref.rev);
    if (!cur) missing.push(`${target.title} (${ref.rev})`);
    return cur ? { ...ref, rev: cur } : ref;
  });
  if (missing.length)
    throw new DomainError("gate_missing", "This candidate references candidates that have not been promoted.", missing);
  const origin = cand.provenance.origin;
  content.provenance = {
    ...cand.provenance,
    origin: mapping !== "whole" && origin === "ai" ? "human_ai" : origin,
    derived_from_candidate: { rev: input.candidate_rev, mapping, locator: input.fragment?.locator },
  };
  content.contributions = [
    ...(cand.contributions ?? []),
    { agent: actor, roles: ["curation"], scope: input.scope, character: "claimed" },
  ];
  content.parents = [];
  return k.db.tx(() => {
    if (gs === "proposed")
      k.recordEvent({
        kind: "gate",
        workspace_id: ent.workspace_id,
        actor_id: actor,
        subject_entity: ent.id,
        payload: { to: "under_review", action: "under_review", reason: "inspection started", independence },
        audience: { mode: "workspace" },
      });
    const { entity_id, draft_id } = createEntity(k, actor, {
      workspace_id: ent.workspace_id,
      kind: content.kind,
      title: content.title,
      facets: content.facets,
      access: pj(ent.access),
      fixture_label: ent.fixture_label ?? undefined,
      content,
    });
    // createEntity sets provenance defaults; restore the candidate-derived provenance exactly.
    k.db.run("update drafts set content = ? where id = ?", j(content), draft_id);
    const sealed = sealDrafts(k, actor, [draft_id]);
    const curated_rev = sealed.revisions[0];
    k.recordEvent({
      kind: "gate",
      workspace_id: ent.workspace_id,
      actor_id: actor,
      subject_entity: ent.id,
      subject_rev: input.candidate_rev,
      payload: {
        to: mapping === "fragment" ? undefined : "promoted",
        action: mapping === "fragment" ? "fragment_promoted" : "promoted",
        candidate_rev: input.candidate_rev,
        curated_rev,
        curated_entity: entity_id,
        scope: input.scope,
        decision: input.decision,
        fragment: input.fragment?.locator,
        independence,
        note: "Editorial admission in the stated scope; not a validation of truth.",
      },
      audience: { mode: "workspace" },
      idem_key: input.idem_key,
    });
    return { curated_rev, curated_entity: entity_id, replayed: false };
  });
}

/** Batch decision with one common scope; items are processed in reference order so internal links map to curated IDs. */
export function promoteBatch(k: Kernel, actor: string, input: { candidate_revs: string[]; scope: string; decision: string; batch_id?: string }) {
  const batch = input.batch_id ?? newId("bat");
  const pending = new Set(input.candidate_revs);
  const results: { candidate_rev: string; curated_rev: string }[] = [];
  return k.db.tx(() => {
    let progress = true;
    while (pending.size && progress) {
      progress = false;
      for (const rev of [...pending]) {
        const deps: string[] = [];
        const c = k.revContent(rev);
        if (!c) throw notFound();
        mapRefs(c, (ref) => {
          if ("rev" in ref && pending.has(ref.rev) && ref.rev !== rev) deps.push(ref.rev);
          return ref;
        });
        if (deps.length) continue;
        const r = promote(k, actor, { candidate_rev: rev, scope: input.scope, decision: input.decision, idem_key: `${batch}:${rev}` });
        results.push({ candidate_rev: rev, curated_rev: r.curated_rev });
        pending.delete(rev);
        progress = true;
      }
    }
    if (pending.size) throw new DomainError("cycle", "Candidates in this batch reference each other cyclically; promote them as a reviewed group.", [...pending]);
    return { batch_id: batch, promoted: results };
  });
}

/** Q23: candidate queue with exact gate states, origins and decisions. */
export function candidateQueue(k: Kernel, actor: string | null, ws: string) {
  const v = k.viewer(actor);
  if (!v.member(ws)) throw notFound();
  return k.db
    .all("select * from entities where workspace_id = ? and namespace = 'candidate' order by created_at desc", ws)
    .filter((e) => v.canSeeEntity(e.id))
    .map((e) => {
      const rev = k.revisionsOf(e.id).at(-1);
      const c = rev ? pj(rev.content) : undefined;
      return {
        entity_id: e.id,
        rev: rev?.id,
        title: e.title,
        kind: e.kind,
        producer: k.agentDescriptor(e.owner_id),
        origin: c?.provenance?.origin,
        acquisition: c?.provenance?.acquisition,
        fixture_label: e.fixture_label,
        gate: gateStateOf(k, e.id),
        submitted_at: e.created_at,
      };
    });
}
