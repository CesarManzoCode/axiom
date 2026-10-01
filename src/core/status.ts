// Epistemic status as a reproducible view (§13): attributed assessments on an exact revision,
// summarized under a declared policy and time cut. Nothing here mutates content and no
// dimension is ever collapsed into a global "verified" badge (I14–I17, I48).
import { pj } from "./db.ts";
import type { Kernel, Viewer } from "./kernel.ts";
import { validityOf } from "./state.ts";
import { ARGUMENT_EVIDENCE, STATUS_DEFAULT, STATUS_DIMENSIONS, type StatusDimension } from "./vocab.ts";

export const POLICIES = {
  "workspace_curator_selection@1": {
    id: "workspace_curator_selection",
    version: 1,
    description:
      "Shows author and published assessments; adopts the assessment selected by an authorized curator as workspace summary, linking the selection event; opposition stays visible as conflicting. Without selection, attributed positions are shown and no majority is invented.",
  },
  "attributed_positions@1": {
    id: "attributed_positions",
    version: 1,
    description: "Never summarizes: every attributed position is listed as is.",
  },
  "author_only@1": {
    id: "author_only",
    version: 1,
    description: "Only assessments sealed by the subject's own author(s).",
  },
} as const;
export type PolicyKey = keyof typeof POLICIES;
export const DEFAULT_POLICY: PolicyKey = "workspace_curator_selection@1";

export interface QueryScope {
  policy?: PolicyKey;
  cut?: string;
  include_candidates?: boolean;
}

export interface Position {
  dimension: string;
  value: string;
  assessment_rev: string;
  assessment_entity: string;
  eval_kind: string;
  assessor: { id?: string; name?: string; kind?: string; descriptor?: string };
  scope: string;
  locator?: string;
  reason?: string;
  source_verdict?: string;
  evidence: string[];
  recorded_at: string;
  namespace: string;
}

const STATUS_FROM_FINDING: Record<string, StatusDimension> = {
  fidelity: "fidelity",
  novelty: "novelty",
  reproducibility: "reproducibility",
  formalization: "formalization",
};

/**
 * Collect assessment positions on an exact revision. For each evaluation entity the most recent
 * visible revision sealed before the cut represents its assessor's position; retracted
 * assessments are excluded from summaries but remain in history.
 */
export function positionsOn(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}): Position[] {
  const rows = k.db.all(
    `select r.* , e.namespace from refs x join revisions r on r.id = x.rev_id join entities e on e.id = r.entity_id
     where x.target_rev = ? and x.via = 'subject' and r.kind = 'evaluation' order by r.sealed_at`,
    revId,
  );
  const latest = new Map<string, any>();
  for (const r of rows) {
    if (scope.cut && r.sealed_at > scope.cut) continue;
    if (r.namespace === "candidate" && !scope.include_candidates) continue;
    if (!v.canSeeRev(r.id)) continue;
    latest.set(r.entity_id, r);
  }
  const out: Position[] = [];
  for (const r of latest.values()) {
    if (validityOf(k, v, r.id, scope.cut).values.includes("retracted")) continue;
    const c = pj(r.content);
    const p = c.payload;
    if (p.subject?.rev !== revId) continue;
    const assessorAgent = p.assessor?.agent ?? r.sealed_by;
    const a = k.agentDescriptor(assessorAgent);
    const base = {
      assessment_rev: r.id,
      assessment_entity: r.entity_id,
      eval_kind: p.eval_kind,
      assessor: { id: a?.id, name: a?.name, kind: a?.kind, descriptor: p.assessor?.descriptor },
      scope: p.scope,
      locator: p.locator,
      reason: p.reason,
      evidence: (p.evidence ?? []).map((e: any) => e.rev),
      recorded_at: r.sealed_at,
      namespace: r.namespace,
    };
    if (p.eval_kind === "review")
      for (const f of p.findings)
        out.push({ ...base, dimension: f.dimension, value: f.value, locator: f.locator ?? p.locator, reason: f.text ?? p.reason, source_verdict: f.source_verdict });
    else if (p.eval_kind === "applicability")
      out.push({ ...base, dimension: "barrier_applicability", value: p.value, reason: p.predicate });
    else if (p.eval_kind === "consistency") out.push({ ...base, dimension: "context_consistency", value: p.value });
    else if (p.eval_kind === "assessment")
      out.push({ ...base, dimension: p.dimension, value: p.value, source_verdict: p.source_verdict });
  }
  return out;
}

export interface DimensionView {
  dimension: string;
  summary: string;
  mode: "selected" | "agreed" | "conflicting" | "positions" | "default" | "derived";
  attributed_to: string[];
  conflicting: boolean;
  selection?: { assessment_rev: string; curator: string | undefined; reason: string; event_id: string; recorded_at: string };
  positions: Position[];
  note?: string;
}

function selectionFor(k: Kernel, v: Viewer, revId: string, dimension: string, cut?: string) {
  const sel = k
    .events("kind = 'assessment_selected' and subject_rev = ?", revId)
    .filter((e) => (!cut || e.recorded_at <= cut) && e.payload.dimension === dimension && v.canSeeEvent(e));
  return sel.at(-1);
}

export function summarize(
  k: Kernel,
  v: Viewer,
  revId: string,
  dimension: string,
  positions: Position[],
  scope: QueryScope,
  fallback: string,
): DimensionView {
  const policy = scope.policy ?? DEFAULT_POLICY;
  let ps = positions.filter((p) => p.dimension === dimension);
  if (policy === "author_only@1") {
    const author = k.revRow(revId)?.sealed_by;
    ps = ps.filter((p) => p.assessor.id === author);
  }
  const names = (xs: Position[]) => [...new Set(xs.map((p) => p.assessor.name ?? p.assessor.descriptor ?? "unknown"))];
  if (policy === "attributed_positions@1")
    return { dimension, summary: ps.length ? "see_positions" : fallback, mode: ps.length ? "positions" : "default", attributed_to: names(ps), conflicting: new Set(ps.map((p) => p.value)).size > 1, positions: ps };
  if (policy === "workspace_curator_selection@1") {
    const sel = selectionFor(k, v, revId, dimension, scope.cut);
    const chosen = sel && ps.find((p) => p.assessment_rev === sel.payload.assessment_rev);
    if (sel && chosen) {
      const opposed = ps.filter((p) => p.value !== chosen.value);
      return {
        dimension,
        summary: chosen.value,
        mode: "selected",
        attributed_to: names([chosen]),
        conflicting: opposed.length > 0,
        selection: { assessment_rev: chosen.assessment_rev, curator: k.agentDescriptor(sel.actor_id)?.name, reason: sel.payload.reason, event_id: sel.id, recorded_at: sel.recorded_at },
        positions: ps,
      };
    }
  }
  if (!ps.length) return { dimension, summary: fallback, mode: "default", attributed_to: [], conflicting: false, positions: [] };
  const values = new Set(ps.map((p) => p.value));
  if (values.size === 1) return { dimension, summary: ps[0].value, mode: "agreed", attributed_to: names(ps), conflicting: false, positions: ps };
  return { dimension, summary: "conflicting", mode: "conflicting", attributed_to: names(ps), conflicting: true, positions: ps, note: "Attributed positions disagree; no majority is computed." };
}

/** The ten-dimension status vector of an exact revision (Q01/Q04, AC52, AC56). */
export function statusVector(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  const rev = k.revRow(revId)!;
  const content = pj(rev.content);
  const positions = positionsOn(k, v, revId, scope);
  // Review findings feed their own status axes; correctness/completeness stay review namespaces.
  const lifted = positions.map((p) =>
    p.eval_kind === "review" && STATUS_FROM_FINDING[p.dimension] ? { ...p, dimension: STATUS_FROM_FINDING[p.dimension] } : p,
  );
  const dims: Record<string, DimensionView> = {};
  for (const d of STATUS_DIMENSIONS) dims[d] = summarize(k, v, revId, d, lifted, scope, STATUS_DEFAULT[d]);

  const support = supportOf(k, v, revId, scope);
  // Evidence is a set of modalities with links, not one value.
  const modalities = new Set<string>();
  for (const s of support.entries) modalities.add(s.evidence_modality);
  for (const p of dims.evidence.positions) modalities.add(p.value);
  if (content.provenance?.sources?.length && content.kind !== "source") modalities.add("citation");
  if (modalities.size) {
    dims.evidence = {
      ...dims.evidence,
      summary: modalities.size > 1 ? "mixed" : [...modalities][0],
      mode: "derived",
      note: `Modalities: ${[...modalities].join(", ")}`,
    };
  }
  // Review axis derived from who reviewed this exact revision.
  const reviews = positions.filter((p) => p.eval_kind === "review");
  if (reviews.length && dims.review.mode === "default") {
    const kinds = new Set<string>();
    for (const r of reviews) {
      if (r.assessor.id === rev.sealed_by) kinds.add("author_checked");
      else if (r.assessor.id && k.isMember(rev.workspace_id, r.assessor.id)) kinds.add("team_reviewed");
      else kinds.add("external_reviewed");
    }
    const correctness = new Set(reviews.filter((r) => r.dimension === "correctness").map((r) => r.value));
    dims.review = {
      ...dims.review,
      summary: correctness.size > 1 ? "conflicting" : [...kinds].join("+"),
      mode: "derived",
      conflicting: correctness.size > 1,
      attributed_to: [...new Set(reviews.map((r) => r.assessor.name ?? "unknown"))],
      positions: reviews,
    };
  }
  if (dims.provenance.mode === "default") {
    const prov = content.provenance ?? {};
    const unresolvedSource = (prov.sources ?? []).some((s: any) => {
      const sc = "rev" in s.source ? k.revContent(s.source.rev) : undefined;
      return sc?.payload?.revision_identity?.status === "unknown";
    });
    const value =
      ["import", "extraction"].includes(prov.acquisition) && !prov.sources?.length
        ? "source_unresolved"
        : unresolvedSource
          ? "partial"
          : "recorded_complete_for_scope";
    dims.provenance = { ...dims.provenance, summary: value, mode: "derived", note: `origin=${prov.origin}, acquisition=${prov.acquisition}` };
  }
  const validity = validityOf(k, v, revId, scope.cut);
  dims.validity = { ...dims.validity, summary: validity.values.join("+"), mode: "derived", note: validity.events.map((e) => `${e.action} (${e.scope})`).join("; ") || undefined };
  const disputes = k
    .events("kind = 'governance' and subject_rev = ?", revId)
    .filter((e) => e.payload.case_kind === "dispute" && (!scope.cut || e.recorded_at <= scope.cut) && v.canSeeEvent(e));
  if (disputes.length) {
    const last = disputes.at(-1)!.payload.action as string;
    const map: Record<string, string> = { opened: "open", assessed: "open", decided_for_policy: "resolved_for_policy", appealed: "appealed", reassessed: "open" };
    const cases = new Set(disputes.map((d) => d.payload.case_id));
    dims.disputes = { ...dims.disputes, summary: cases.size > 1 ? "multiple_conflicts" : (map[last] ?? "open"), mode: "derived" };
  } else if (dims.logical.conflicting) dims.disputes = { ...dims.disputes, summary: "open", mode: "derived", note: "Logical positions conflict." };

  const findings = ["correctness", "completeness", "references", "clarity", "context_consistency", "barrier_applicability"].map((d) =>
    summarize(k, v, revId, d, positions, scope, "not_evaluated"),
  );
  return {
    subject: { rev: revId, entity: rev.entity_id, seq: rev.seq, title: rev.title },
    policy: { key: scope.policy ?? DEFAULT_POLICY, ...POLICIES[scope.policy ?? DEFAULT_POLICY] },
    cut: scope.cut ?? k.now(),
    scope: scope.include_candidates ? "curated+candidates" : "curated",
    dimensions: dims,
    findings: findings.filter((f) => f.positions.length),
    support: support.summary,
  };
}

// ------------------------------------------------------------------ support sets (Q04, Q14)

export interface SupportEntry {
  via: "argument" | "relation";
  rev: string;
  entity: string;
  title: string;
  contract?: string;
  argument_kind?: string;
  evidence_modality: string;
  completeness?: string;
  status: "accepted" | "defective" | "contested" | "unevaluated";
  correctness: DimensionView;
  validity: string[];
  dependency_sets: any[];
  gaps: any[];
  evidence_revs: string[];
}

function supportStatus(correctness: DimensionView, validity: string[]): SupportEntry["status"] {
  if (validity.includes("retracted")) return "defective";
  if (correctness.conflicting) return "contested";
  if (correctness.summary === "defect_found") return "defective";
  if (correctness.summary === "supported_in_scope") return "accepted";
  return "unevaluated";
}

/**
 * Alternative supports of an exact revision. Each argument is its own OR-branch; losing one
 * branch never refutes the target (I18, I19, AC03).
 */
export function supportOf(k: Kernel, v: Viewer, revId: string, scope: QueryScope = {}) {
  const entries: SupportEntry[] = [];
  const counter: any[] = [];
  const seen = new Set<string>();
  const inbound = k.db.all(
    `select x.rev_id, x.via, x.role, r.kind, r.sealed_at, e.namespace from refs x join revisions r on r.id = x.rev_id
     join entities e on e.id = r.entity_id where x.target_rev = ? and x.via in ('target','participant')`,
    revId,
  );
  const visible = (r: any) =>
    (!scope.cut || r.sealed_at <= scope.cut) && (r.namespace !== "candidate" || scope.include_candidates) && v.canSeeRev(r.rev_id);

  const argEntry = (argRev: string): SupportEntry => {
    const row = k.revRow(argRev)!;
    const c = pj(row.content);
    const pos = positionsOn(k, v, argRev, scope);
    const correctness = summarize(k, v, argRev, "correctness", pos, scope, "not_evaluated");
    const validity = validityOf(k, v, argRev, scope.cut).values;
    return {
      via: "argument",
      rev: argRev,
      entity: row.entity_id,
      title: row.title,
      argument_kind: c.payload.argument_kind,
      evidence_modality: ARGUMENT_EVIDENCE[c.payload.argument_kind as keyof typeof ARGUMENT_EVIDENCE] ?? "mixed",
      completeness: c.payload.completeness,
      status: supportStatus(correctness, validity),
      correctness,
      validity,
      dependency_sets: c.payload.dependency_sets ?? [],
      gaps: c.payload.gaps ?? [],
      evidence_revs: [],
    };
  };

  for (const r of inbound) {
    if (!visible(r)) continue;
    if (r.kind === "argument" && r.via === "target" && !seen.has(r.rev_id)) {
      seen.add(r.rev_id);
      entries.push(argEntry(r.rev_id));
    }
    if (r.kind === "relation" && r.via === "participant" && r.role === "target") {
      const c = pj(k.revRow(r.rev_id)!.content);
      const contract = c.payload.contract.id;
      const evidence = c.payload.slots.filter((s: any) => s.role === "evidence").map((s: any) => s.ref.rev);
      const relPos = positionsOn(k, v, r.rev_id, scope);
      const relCorrect = summarize(k, v, r.rev_id, "correctness", relPos, scope, "not_evaluated");
      const relValidity = validityOf(k, v, r.rev_id, scope.cut).values;
      if (contract === "proves" || contract === "supports") {
        // The relation is its own citable support claim; its evidence argument's status matters too.
        const evStatuses = evidence.filter((e: string) => v.canSeeRev(e)).map((e: string) => (k.revRow(e)?.kind === "argument" ? argEntry(e).status : "unevaluated"));
        let status = supportStatus(relCorrect, relValidity);
        if (status === "unevaluated" && evStatuses.length) status = evStatuses.includes("accepted") ? "accepted" : evStatuses.every((s: string) => s === "defective") ? "defective" : "unevaluated";
        if (status === "accepted" && evStatuses.length && evStatuses.every((s: string) => s === "defective")) status = "defective";
        entries.push({
          via: "relation",
          rev: r.rev_id,
          entity: k.revRow(r.rev_id)!.entity_id,
          title: k.revRow(r.rev_id)!.title,
          contract,
          evidence_modality: contract === "proves" ? "informal_proof" : "mixed",
          status,
          correctness: relCorrect,
          validity: relValidity,
          dependency_sets: [],
          gaps: [],
          evidence_revs: evidence.filter((e: string) => v.canSeeRev(e)),
        });
      }
      if (contract === "refutes" || contract === "challenges")
        counter.push({
          rev: r.rev_id,
          title: k.revRow(r.rev_id)!.title,
          contract,
          negated: c.payload.fields?.negated,
          evidence: evidence.filter((e: string) => v.canSeeRev(e)),
          correctness: relCorrect.summary,
          positions: relPos,
        });
    }
  }
  const accepted = entries.filter((e) => e.status === "accepted");
  const summary = !entries.length
    ? "none_recorded"
    : accepted.length
      ? "accepted_support_known"
      : entries.some((e) => e.status === "unevaluated" || e.status === "contested")
        ? "claimed_support_not_accepted"
        : "no_accepted_support_known";
  return {
    subject: revId,
    summary,
    note:
      summary === "no_accepted_support_known"
        ? "Every recorded support has a defect or was retracted. This does not make the statement false."
        : undefined,
    entries,
    counter_evidence: counter,
  };
}
