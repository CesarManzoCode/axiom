// Read projections and the required queries (§35, Q01–Q25). Every function receives a Viewer
// and filters objects *and* metadata before exposure. Defaults: curated only, workspace
// policy, present time, and an explicitly shown revision selection.
import { pj } from "./db.ts";
import { notFound, type Kernel, type Viewer } from "./kernel.ts";
import { preferredRevision } from "./authoring.ts";
import { gateStateOf } from "./candidates.ts";
import { identityRecords } from "./governance.ts";
import { publicationsFor } from "./publication.ts";
import { barrierApplicability, failedAttempts, plansFor, routeStatus } from "./research.ts";
import { validityOf, workStateOf } from "./state.ts";
import { positionsOn, statusVector, summarize, supportOf, type QueryScope } from "./status.ts";
import { NON_LOGICAL_DEPS } from "./vocab.ts";

const desc = (k: Kernel, id: string | null | undefined) => k.agentDescriptor(id);

// ------------------------------------------------------------------ revision projection

/** Content filtered for the viewer: lineage and raw inputs outside the audience are dropped, not marked. */
export function projectRevision(k: Kernel, v: Viewer, revId: string) {
  const row = k.revRow(revId);
  if (!row || !v.canSeeRev(revId)) throw notFound();
  const ent = k.entityRow(row.entity_id)!;
  const content = pj(row.content);
  const withheld = v.contentWithheld(revId);
  const prov = { ...content.provenance };
  prov.sources = (prov.sources ?? []).filter((s: any) => !("rev" in s.source) || v.canSeeRev(s.source.rev));
  if (prov.derived_from_candidate && !v.canSeeRev(prov.derived_from_candidate.rev)) delete prov.derived_from_candidate;
  const member = v.member(row.workspace_id);
  const parents = pj<string[]>(row.parents).filter((p) => v.canSeeRev(p));
  return {
    id: row.id,
    entity_id: row.entity_id,
    seq: row.seq,
    kind: row.kind,
    title: row.title,
    namespace: ent.namespace,
    fixture_label: ent.fixture_label ?? content.fixture_label ?? null,
    sealed_at: row.sealed_at,
    sealed_by: desc(k, row.sealed_by),
    context: { rev: row.context_rev, title: k.revRow(row.context_rev)?.title, self: row.context_rev === row.id },
    parents,
    content_hash: row.content_hash,
    vocab: row.vocab,
    access: member ? pj(row.access) : undefined,
    withheld: withheld ? { reason: withheld, tombstone: { entity: row.entity_id, revision: row.id, title: row.title, sealed_at: row.sealed_at } } : null,
    content: withheld ? null : { ...content, parents, provenance: prov },
    contributions: withheld ? [] : (content.contributions ?? []).map((c: any) => ({ ...c, agent: c.agent ? desc(k, c.agent) : null })),
  };
}

export function titleOf(k: Kernel, v: Viewer, rev: string) {
  return v.canSeeRev(rev) ? k.revRow(rev)?.title : null;
}

// ------------------------------------------------------------------ entity page

export function entityView(k: Kernel, v: Viewer, entityId: string, opts: { rev?: string } & QueryScope = {}) {
  const ent = k.entityRow(entityId);
  if (!ent || !v.canSeeEntity(entityId)) throw notFound();
  const revisions = k
    .revisionsOf(entityId)
    .filter((r) => v.canSeeRev(r.id) && (!opts.cut || r.sealed_at <= opts.cut))
    .map((r) => {
      const c = pj(r.content);
      return {
        id: r.id,
        seq: r.seq,
        sealed_at: r.sealed_at,
        sealed_by: desc(k, r.sealed_by),
        change_summary: c.change_summary,
        parents: pj<string[]>(r.parents).filter((p) => v.canSeeRev(p)),
        validity: validityOf(k, v, r.id, opts.cut).values,
        published: k.db.all("select kind from rev_audience where rev_id = ?", r.id).map((x) => x.kind),
      };
    });
  const preferred = preferredRevision(k, entityId, v);
  let shown = opts.rev && revisions.some((r) => r.id === opts.rev) ? opts.rev : (preferred ?? revisions.at(-1)?.id);
  if (opts.rev && !revisions.some((r) => r.id === opts.rev)) shown = undefined;
  const basis = opts.rev ? "explicitly selected revision" : preferred ? "preferred selection (explicit curatorial event)" : shown ? "most recent sealed revision visible to you — no preferred revision selected" : "no sealed revision yet";
  const member = v.member(ent.workspace_id);
  const drafts = member
    ? k.db
        .all("select * from drafts where entity_id = ? and status = 'editing' order by updated_at desc", entityId)
        .filter((d) => v.canSeeDraft(d))
        .map((d) => ({ id: d.id, author: desc(k, d.author_id), generation: d.generation, base_revs: pj(d.base_revs), updated_at: d.updated_at, intent: d.intent }))
    : [];
  const base = {
    entity: {
      id: ent.id,
      kind: ent.kind,
      namespace: ent.namespace,
      title: ent.title,
      facets: pj(ent.facets),
      fixture_label: ent.fixture_label,
      workspace_id: member ? ent.workspace_id : undefined,
      steward: member ? desc(k, ent.steward_id) : undefined,
      access: member ? pj(ent.access) : undefined,
      created_at: ent.created_at,
      gate: ent.namespace === "candidate" && member ? gateStateOf(k, ent.id) : undefined,
    },
    revisions,
    preferred,
    shown_rev: shown ?? null,
    shown_basis: basis,
    drafts,
    identity: identityRecords(k, v, entityId),
  };
  if (!shown) return { ...base, revision: null };
  const revision = projectRevision(k, v, shown);
  const research = ent.kind === "research";
  return {
    ...base,
    revision,
    status: statusVector(k, v, shown, opts),
    support: supportOf(k, v, shown, opts),
    relations: relationsOf(k, v, shown, opts),
    dependencies: dependsOn(k, v, shown, opts),
    used_by: usedBy(k, v, shown, opts),
    equivalences: equivalences(k, v, shown, opts),
    formalization: formalization(k, v, shown, opts),
    reproducibility: ["argument", "research"].includes(ent.kind) ? reproducibility(k, v, shown, opts) : undefined,
    manifest: ent.kind === "collection" ? manifest(k, v, shown) : undefined,
    contributions: contributions(k, v, entityId),
    publications: publicationsFor(k, v, { rev: shown }),
    work: research ? workStateOf(k, entityId, opts.cut) : undefined,
    plans: research ? plansFor(k, v, entityId, opts) : undefined,
    route: research || ent.kind === "method" ? routeStatus(k, v, entityId, opts) : undefined,
    failed_attempts: failedAttempts(k, v, entityId, opts),
    barrier: revision.content?.payload?.editorial_roles?.includes("barrier") ? barrierApplicability(k, v, shown, opts) : undefined,
  };
}

// ------------------------------------------------------------------ relations around a revision

export function relationsOf(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  const rows = k.db.all("select distinct rev_id, role, slot from refs where target_rev = ? and via = 'participant'", revId);
  const incoming = rows
    .filter((r) => v.canSeeRev(r.rev_id) && (!scope.cut || k.revRow(r.rev_id)!.sealed_at <= scope.cut))
    .filter((r) => scope.include_candidates || k.entityRow(k.revRow(r.rev_id)!.entity_id)!.namespace === "curated")
    .map((r) => relationSummary(k, v, r.rev_id, { role: r.role, slot: r.slot }));
  return { participates_in: incoming };
}

export function relationSummary(k: Kernel, v: Viewer, relRev: string, here?: { role: string; slot: string }) {
  const row = k.revRow(relRev)!;
  const c = pj(row.content);
  return {
    rev: relRev,
    entity: row.entity_id,
    title: row.title,
    contract: c.payload.contract,
    modality: c.payload.modality,
    interpretation: c.payload.interpretation,
    assertion: c.payload.assertion,
    hypotheses: c.payload.hypotheses,
    scope: c.payload.scope,
    grouping: c.payload.grouping,
    fields: c.payload.fields,
    here,
    slots: c.payload.slots.map((s: any) => ({
      slot: s.slot,
      role: s.role,
      modality: s.modality,
      order: s.order,
      rev: v.canSeeRev(s.ref.rev) ? s.ref.rev : null,
      title: titleOf(k, v, s.ref.rev),
    })),
    status: (() => {
      const s = statusVector(k, v, relRev, {});
      return { logical: s.dimensions.logical.summary, review: s.dimensions.review.summary, validity: s.dimensions.validity.summary, support: s.support };
    })(),
  };
}

// ------------------------------------------------------------------ dependencies (Q02, Q03, Q05, Q17)

function edgeView(k: Kernel, v: Viewer, e: any, direction: "out" | "in") {
  const other = direction === "out" ? e.target_rev : e.rev_id;
  return {
    rev: other,
    title: titleOf(k, v, other),
    kind: k.revRow(other)?.kind,
    via: e.via,
    role: e.role,
    slot: e.slot,
    dep_kind: e.dep_kind,
    origin: e.origin,
    locator: e.locator,
  };
}

function classOf(e: any): string {
  if (["context", "context_parent", "context_import", "context_definition"].includes(e.via)) return "ambient_context";
  if (e.origin === "inferred" || e.dep_kind === "inferred") return "inferred";
  if (e.dep_kind && NON_LOGICAL_DEPS.has(e.dep_kind)) return e.dep_kind;
  if (e.origin === "formal" || e.dep_kind === "formal") return "formal";
  if (e.via === "step_use" || e.via === "dependency_set" || e.dep_kind === "proof_local_use") return "proof_local_use";
  if (e.dep_kind === "necessary_assumption") return "necessary_assumption";
  if (e.via === "participant") return `relation_participant`;
  if (e.dep_kind === "explicit_informal") return "explicit_informal";
  return e.via;
}

/** Q02: what X depends on — grouped by kind, and by argument as alternative support sets. */
export function dependsOn(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  if (!v.canSeeRev(revId)) throw notFound();
  const out = k.db.all("select * from refs where rev_id = ? and via not in ('parent','provenance')", revId).filter((e) => v.canSeeRev(e.target_rev));
  const groups: Record<string, any[]> = {};
  for (const e of out) (groups[classOf(e)] ??= []).push(edgeView(k, v, e, "out"));
  const support = supportOf(k, v, revId, scope);
  const perArgument = support.entries
    .filter((s) => s.via === "argument")
    .map((s) => {
      const deps = k.db.all("select * from refs where rev_id = ? and via in ('step_use','dependency_set','reference','environment')", s.rev).filter((e) => v.canSeeRev(e.target_rev));
      return {
        argument: { rev: s.rev, title: s.title, status: s.status },
        dependency_sets: s.dependency_sets.map((d: any) => ({
          ...d,
          members: d.members.filter((m: any) => v.canSeeRev(m.rev)).map((m: any) => ({ rev: m.rev, title: titleOf(k, v, m.rev) })),
          minimality_note:
            d.minimality === "none_claimed"
              ? "No minimality claimed."
              : d.certificate || d.method
                ? `${d.minimality} for this derivation (${d.method ?? "certificate"}); not necessary for every proof.`
                : `${d.minimality} asserted without certificate/method: delimited assertion for this derivation only.`,
        })),
        uses: deps.map((e) => ({ ...edgeView(k, v, e, "out"), class: classOf(e) })),
      };
    });
  return {
    subject: revId,
    by_kind: groups,
    alternative_support_sets: perArgument,
    completeness: "Dependencies are those recorded; informal capture is not guaranteed complete. Formal kernel dependencies are listed only when extracted.",
  };
}

/** Q03/Q17: what uses X and where — including relations-on-relations and n-ary role positions. */
export function usedBy(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  if (!v.canSeeRev(revId)) throw notFound();
  const rows = k.db
    .all("select * from refs where target_rev = ? and via not in ('parent','provenance')", revId)
    .filter((e) => v.canSeeRev(e.rev_id) && e.rev_id !== revId)
    .filter((e) => !scope.cut || k.revRow(e.rev_id)!.sealed_at <= scope.cut)
    .filter((e) => scope.include_candidates || k.entityRow(k.revRow(e.rev_id)!.entity_id)!.namespace === "curated");
  const groups: Record<string, any[]> = {};
  for (const e of rows) (groups[classOf(e)] ??= []).push(edgeView(k, v, e, "in"));
  return { subject: revId, by_kind: groups, total: rows.length, note: "Ambient imports are listed separately from uses." };
}

/** Q05: which exact revision of entity Y does this proof use, and where. */
export function revisionUsed(k: Kernel, v: Viewer, consumerRev: string, entityId: string) {
  if (!v.canSeeRev(consumerRev)) throw notFound();
  return k.db
    .all("select * from refs where rev_id = ? and target_entity = ? and via not in ('parent','provenance')", consumerRev, entityId)
    .filter((e) => v.canSeeRev(e.target_rev))
    .map((e) => ({ ...edgeView(k, v, e, "out"), seq: k.revRow(e.target_rev)?.seq, note: "Exact pinned revision; never substituted by a newer one." }));
}

// ------------------------------------------------------------------ equivalence & similarity (Q09)

function norm(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function jaccard(a: string, b: string) {
  const A = new Set(norm(a).split(" "));
  const B = new Set(norm(b).split(" "));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
}

export function equivalences(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  const rel = relationsOf(k, v, revId, scope).participates_in.filter((r) =>
    ["equivalent_under", "isomorphic_to", "reformulates", "translates", "generalizes", "specializes"].includes(r.contract.id),
  );
  const content = k.revContent(revId);
  const text = content?.payload?.statement ?? content?.payload?.description;
  const similar: any[] = [];
  if (text) {
    const ws = k.revRow(revId)!.workspace_id;
    const seen = new Set<string>();
    for (const r of k.db.all("select id, entity_id, content, title from revisions where workspace_id = ? and kind = ? and entity_id != ?", ws, content.kind, k.revRow(revId)!.entity_id)) {
      if (seen.has(r.entity_id) || !v.canSeeRev(r.id)) continue;
      const other = pj(r.content).payload?.statement ?? pj(r.content).payload?.description;
      if (!other) continue;
      const score = jaccard(text, other);
      if (score >= 0.55) {
        seen.add(r.entity_id);
        similar.push({ rev: r.id, title: r.title, lexical_similarity: Math.round(score * 100) / 100, same_expression: norm(text) === norm(other) });
      }
    }
  }
  return {
    claims: rel.map((r) => ({ ...r, conditions: r.hypotheses, note: r.contract.id === "equivalent_under" && !r.hypotheses.length ? "Unconditional within its context." : "Holds only under the stated conditions/context." })),
    lexical_candidates: similar.sort((a, b) => b.lexical_similarity - a.lexical_similarity).slice(0, 10),
    note: "Lexical similarity proposes candidates only; it never changes identity, IDs or state.",
  };
}

// ------------------------------------------------------------------ formalization (Q20), reproducibility (Q24)

export function formalization(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  const rels = relationsOf(k, v, revId, scope).participates_in.filter((r) => ["formalizes", "faithfully_expresses"].includes(r.contract.id));
  const content = k.revContent(revId);
  const formalReps = (content?.representations ?? []).filter((r: any) => r.modality === "formal");
  const status = statusVector(k, v, revId, scope);
  const formalArgs = supportOf(k, v, revId, scope).entries.filter((e) => ["formal_proof", "machine_checked"].includes(e.argument_kind ?? ""));
  return {
    formal_statement: content?.payload?.formal ?? null,
    formal_representations: formalReps,
    relations: rels,
    formal_arguments: formalArgs.map((a) => {
      const c = k.revContent(a.rev);
      return { rev: a.rev, title: a.title, kind: a.argument_kind, environment: c.payload.formal?.environment?.rev ? { rev: c.payload.formal.environment.rev, title: titleOf(k, v, c.payload.formal.environment.rev) } : null, kernel_dependencies: c.payload.formal?.kernel_dependencies ?? "not_extracted" };
    }),
    formalization: status.dimensions.formalization,
    fidelity: status.dimensions.fidelity,
    note: "Formal check and fidelity are separate questions; a passing check never sets fidelity.",
  };
}

export function reproducibility(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  const c = k.revContent(revId);
  const status = statusVector(k, v, revId, scope);
  const env = c?.payload?.formal?.environment?.rev ?? (k.revContent(k.revRow(revId)!.context_rev)?.payload?.execution ? k.revRow(revId)!.context_rev : null);
  return {
    protocol: c?.payload?.protocol ?? (c?.payload?.attempt ? { description: c.payload.attempt.protocol, range: c.payload.attempt.failure?.range } : null),
    execution_context: env ? { rev: env, title: titleOf(k, v, env), execution: k.revContent(env)?.payload?.execution } : null,
    artifacts: c?.payload?.attempt?.artifacts ?? [],
    artifacts_missing_reason: c?.payload?.attempt?.artifacts_missing_reason ?? null,
    reproducibility: status.dimensions.reproducibility,
    sources: (c?.provenance?.sources ?? [])
      .filter((s: any) => v.canSeeRev(s.source.rev))
      .map((s: any) => {
        const sc = k.revContent(s.source.rev);
        return { rev: s.source.rev, title: titleOf(k, v, s.source.rev), locator: s.locator, availability: sc?.payload?.availability, revision_identity: sc?.payload?.revision_identity };
      }),
    note: "A finite computation supports only its stated range/protocol; it is not a universal proof.",
  };
}

// ------------------------------------------------------------------ manifests (Q25), contributions (Q18)

export function manifest(k: Kernel, v: Viewer, revId: string) {
  const c = k.revContent(revId);
  if (!c || c.kind !== "collection") return null;
  return {
    purpose: c.payload.purpose,
    items: c.payload.manifest.map((m: any) => ({
      ...m,
      ref: undefined,
      rev: v.canSeeRev(m.ref.rev) ? m.ref.rev : null,
      title: titleOf(k, v, m.ref.rev),
      kind: v.canSeeRev(m.ref.rev) ? k.revRow(m.ref.rev)?.kind : null,
      seq: v.canSeeRev(m.ref.rev) ? k.revRow(m.ref.rev)?.seq : null,
      relation_class: ["has_part", "contains", "summarizes", "references"].includes(m.relation) ? "editorial" : "logical/interpretive",
    })),
    narrative: c.payload.narrative.map((b: any) =>
      b.type === "transclusion" && b.ref
        ? (() => {
            const ok = v.canSeeRev(b.ref.rev);
            const tc = ok ? k.revContent(b.ref.rev) : null;
            return { ...b, ref: undefined, rev: ok ? b.ref.rev : null, title: ok ? tc.title : null, kind: ok ? tc.kind : null, text: ok ? (tc.payload.statement ?? tc.payload.description ?? tc.payload.goal ?? tc.payload.interpretation ?? tc.payload.summary ?? tc.representations?.[0]?.content) : null, seq: ok ? k.revRow(b.ref.rev)?.seq : null };
          })()
        : b,
    ),
    external_requirements: c.payload.external_requirements,
    bundle: c.payload.bundle,
  };
}

export function contributions(k: Kernel, v: Viewer, entityId: string) {
  const rows: any[] = [];
  for (const r of k.revisionsOf(entityId)) {
    if (!v.canSeeRev(r.id)) continue;
    const c = pj(r.content);
    for (const x of c.contributions ?? [])
      rows.push({ rev: r.id, seq: r.seq, agent: x.agent ? desc(k, x.agent) : null, descriptor: x.descriptor, roles: x.roles, scope: x.scope, character: x.character, evidence: x.evidence });
    rows.push({
      rev: r.id,
      seq: r.seq,
      activity: "seal",
      agent: desc(k, r.sealed_by),
      roles: [],
      note: `Sealed (${c.provenance?.acquisition}); sealing is not authorship.`,
      original_attribution: c.provenance?.original_attribution,
      origin: c.provenance?.origin,
      ai_run: c.provenance?.ai_run,
    });
  }
  const disputes = k
    .events("kind = 'governance' and subject_entity = ?", entityId)
    .filter((e) => v.canSeeEvent(e) && e.payload.case_kind === "priority")
    .map((e) => ({ case_id: e.payload.case_id, action: e.payload.action, reason: e.payload.reason, actor: desc(k, e.actor_id)?.name, at: e.recorded_at }));
  return { contributions: rows, priority_disputes: disputes, note: "Roles and evidence only; no score is computed." };
}

// ------------------------------------------------------------------ AI-generated (Q10), timeline (Q12)

export function aiGenerated(k: Kernel, v: Viewer, ws: string) {
  if (!v.member(ws)) throw notFound();
  return k.db
    .all("select r.*, e.namespace from revisions r join entities e on e.id = r.entity_id where r.workspace_id = ? order by r.sealed_at", ws)
    .filter((r) => v.canSeeRev(r.id))
    .map((r) => ({ r, c: pj(r.content) }))
    .filter(({ c }) => ["ai", "human_ai"].includes(c.provenance?.origin) || c.provenance?.derived_from_candidate)
    .map(({ r, c }) => ({
      rev: r.id,
      entity: r.entity_id,
      title: r.title,
      namespace: r.namespace,
      origin: c.provenance.origin,
      acquisition: c.provenance.acquisition,
      ai_run: c.provenance.ai_run ?? null,
      original_attribution: c.provenance.original_attribution ?? null,
      derived_from_candidate: c.provenance.derived_from_candidate && v.canSeeRev(c.provenance.derived_from_candidate.rev) ? c.provenance.derived_from_candidate : null,
      sealed_by: desc(k, r.sealed_by),
    }));
}

/** Q12: what was recorded (recorded_at ≤ t) about an entity; occurred_at shown separately and never backdated. */
export function asOf(k: Kernel, v: Viewer, entityId: string, cut: string, scope: QueryScope = {}) {
  const ent = k.entityRow(entityId);
  if (!ent || !v.canSeeEntity(entityId) || ent.created_at > cut) throw notFound();
  const view = entityView(k, v, entityId, { ...scope, cut });
  const events = timeline(k, v, entityId).filter((e) => e.recorded_at <= cut);
  return { cut, interpretation: "Reconstructed from what was recorded by the cut; events that occurred earlier but were recorded later are excluded.", view, events };
}

export function timeline(k: Kernel, v: Viewer, entityId: string) {
  if (!v.canSeeEntity(entityId)) throw notFound();
  const revIds = k.revisionsOf(entityId).map((r) => r.id);
  const evs = k
    .events(`subject_entity = ? or subject_rev in (${revIds.map(() => "?").join(",") || "''"})`, entityId, ...revIds)
    .filter((e) => v.canSeeEvent(e));
  const seals = k.revisionsOf(entityId).filter((r) => v.canSeeRev(r.id)).map((r) => ({ id: r.seal_event, kind: "sealed", rev: r.id, seq: r.seq, actor: desc(k, r.sealed_by), recorded_at: r.sealed_at, occurred_at: null, payload: {} }));
  const pubs = publicationsFor(k, v).filter((p) => p.revs.some((x: any) => revIds.includes(x.rev)) && p.published_at).map((p) => ({ id: p.id, kind: "published", rev: null, actor: p.issuer, recorded_at: p.published_at!, occurred_at: null, payload: { audience: p.audience, license: p.license } }));
  const reviews = revIds.flatMap((r) =>
    v.canSeeRev(r)
      ? positionsOn(k, v, r, { include_candidates: false }).map((p) => ({ id: p.assessment_rev, kind: `assessment:${p.dimension}`, rev: r, actor: p.assessor, recorded_at: p.recorded_at, occurred_at: null, payload: { value: p.value, scope: p.scope } }))
      : [],
  );
  return [
    ...seals,
    ...pubs,
    ...reviews,
    ...evs.filter((e) => !["sealed"].includes(e.kind)).map((e) => ({ id: e.id, kind: e.kind, rev: e.subject_rev, actor: desc(k, e.actor_id), recorded_at: e.recorded_at, occurred_at: e.occurred_at, payload: e.payload })),
  ].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

// ------------------------------------------------------------------ search, workspace, graph

export function search(k: Kernel, v: Viewer, q: { text?: string; workspace_id?: string; kind?: string; include_candidates?: boolean; limit?: number }) {
  const text = (q.text ?? "").toLowerCase().trim();
  const params: any[] = [];
  let where = "1=1";
  if (q.workspace_id) {
    where += " and e.workspace_id = ?";
    params.push(q.workspace_id);
  }
  if (q.kind) {
    where += " and e.kind = ?";
    params.push(q.kind);
  }
  if (!q.include_candidates) where += " and e.namespace = 'curated'";
  const rows = k.db.all(`select e.* from entities e where ${where} order by e.created_at`, ...params);
  const out: any[] = [];
  for (const e of rows) {
    if (!v.canSeeEntity(e.id)) continue;
    const revs = k.revisionsOf(e.id).filter((r) => v.canSeeRev(r.id));
    const last = revs.at(-1);
    const hay = `${e.title} ${last ? pj(last.content).payload?.statement ?? "" : ""} ${last ? pj(last.content).payload?.description ?? "" : ""}`.toLowerCase();
    if (text && !hay.includes(text) && e.id !== text && !revs.some((r) => r.id === text)) continue;
    out.push({
      entity_id: e.id,
      title: e.title,
      kind: e.kind,
      namespace: e.namespace,
      fixture_label: e.fixture_label,
      revisions: revs.map((r) => ({ id: r.id, seq: r.seq })),
      has_draft: !revs.length,
      role: last ? pj(last.content).payload?.role ?? pj(last.content).payload?.editorial_roles?.join(",") : undefined,
    });
    if (out.length >= (q.limit ?? 200)) break;
  }
  return { results: out, filters: { text: q.text, kind: q.kind, namespace: q.include_candidates ? "curated+candidates" : "curated" }, note: "Only records visible to you were searched." };
}

/** Local graph: bounded neighborhood. Relations are hyper-nodes so n-ary roles are never flattened. */
export function localGraph(k: Kernel, v: Viewer, revId: string, opts: { depth?: number; max?: number; include_citations?: boolean } = {}) {
  if (!v.canSeeRev(revId)) throw notFound();
  const depth = opts.depth ?? 1;
  const max = opts.max ?? 60;
  const nodes = new Map<string, any>();
  const edges: any[] = [];
  let truncated = false;
  const addNode = (rev: string) => {
    if (nodes.has(rev)) return true;
    if (nodes.size >= max) {
      truncated = true;
      return false;
    }
    const r = k.revRow(rev)!;
    const c = pj(r.content);
    nodes.set(rev, { id: rev, entity: r.entity_id, title: r.title, kind: r.kind, contract: c.payload?.contract?.id, role: c.payload?.role ?? c.payload?.editorial_roles?.[0], seq: r.seq });
    return true;
  };
  addNode(revId);
  let frontier = [revId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const out = k.db.all("select * from refs where rev_id = ? and via not in ('parent','provenance','context')", cur);
      const inc = k.db.all("select * from refs where target_rev = ? and via not in ('parent','provenance','context')", cur);
      for (const e of [...out, ...inc]) {
        const other = e.rev_id === cur ? e.target_rev : e.rev_id;
        if (!k.revRow(other) || !v.canSeeRev(other)) continue;
        if (k.entityRow(k.revRow(other)!.entity_id)!.namespace === "candidate") continue;
        if (!opts.include_citations && e.dep_kind && NON_LOGICAL_DEPS.has(e.dep_kind)) continue;
        if (!addNode(other)) continue;
        edges.push({ from: e.rev_id, to: e.target_rev, via: e.via, role: e.role, slot: e.slot, dep_kind: e.dep_kind });
        next.push(other);
      }
    }
    frontier = next;
  }
  const uniq = new Map(edges.map((e) => [`${e.from}|${e.to}|${e.via}|${e.slot}`, e]));
  return { center: revId, nodes: [...nodes.values()], edges: [...uniq.values()], truncated, depth, note: truncated ? `Showing ${max} nodes; expand from a node to see more.` : undefined };
}

export function workspaceOverview(k: Kernel, v: Viewer, ws: string) {
  const w = k.db.get("select * from workspaces where id = ?", ws);
  if (!w || !v.member(ws)) throw notFound();
  const counts = k.db
    .all("select kind, namespace, count(*) as n from entities where workspace_id = ? group by kind, namespace", ws)
    .map((r) => ({ kind: r.kind, namespace: r.namespace, n: r.n }));
  const members = k.db
    .all("select * from memberships where workspace_id = ?", ws)
    .map((m) => ({ agent: desc(k, m.agent_id), roles: pj(m.roles), active: !!m.active, since: m.since }));
  const recent = k
    .events("workspace_id = ?", ws)
    .filter((e) => v.canSeeEvent(e))
    .slice(-40)
    .reverse()
    .map((e) => ({ id: e.id, kind: e.kind, actor: desc(k, e.actor_id)?.name, subject_entity: e.subject_entity && v.canSeeEntity(e.subject_entity) ? e.subject_entity : null, subject_title: e.subject_entity && v.canSeeEntity(e.subject_entity) ? k.entityRow(e.subject_entity)?.title : null, recorded_at: e.recorded_at, payload: summarizePayload(e.payload) }));
  return {
    workspace: { id: w.id, name: w.name, description: w.description, root_context_rev: w.root_context_rev, created_at: w.created_at },
    my_roles: v.roles(ws),
    counts,
    members,
    recent,
  };
}

function summarizePayload(p: any) {
  const out: any = {};
  for (const key of ["action", "to", "from", "reason", "scope", "dimension", "case_kind", "publication"]) if (p?.[key] !== undefined) out[key] = p[key];
  return out;
}

export function notifications(k: Kernel, v: Viewer) {
  if (!v.id) return [];
  return k.db
    .all("select * from notifications where agent_id = ? order by created_at desc limit 100", v.id)
    .map((n) => ({ ...n, payload: pj(n.payload) }))
    .filter((n) => !n.payload.new_rev || v.canSeeRev(n.payload.new_rev));
}

export { summarize };
