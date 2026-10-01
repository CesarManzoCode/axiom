// Context bundles (§26; Q11; AC41, AC42). A bundle is a sealed Collection revision focused on
// an exact obligation: mandatory closure, recommended/background partitions, omissions with
// reasons, coverage, and audience. Budget overflow segments the bundle instead of truncating.
import { pj } from "./db.ts";
import { DomainError, notFound, type Kernel, type Viewer } from "./kernel.ts";
import { createAndSeal } from "./authoring.ts";
import { barrierApplicability, failedAttempts, plansFor } from "./research.ts";
import { statusVector, type QueryScope } from "./status.ts";

export type BundleProfile = "mathematician" | "collaborator" | "ai";

interface Item {
  rev: string;
  title: string;
  kind: string;
  partition: "mandatory" | "recommended" | "background";
  reason: string;
  tokens: number;
  via: string;
}

const MANDATORY_VIAS = new Set(["context", "context_parent", "context_import", "context_definition", "assumption_source", "step_use", "dependency_set", "environment", "hypothesis"]);

function estimateTokens(k: Kernel, rev: string) {
  return Math.ceil(k.revRow(rev)!.content.length / 4);
}

export function computeBundle(k: Kernel, v: Viewer, obligationRev: string, opts: { profile: BundleProfile; budget?: number } & QueryScope) {
  const row = k.revRow(obligationRev);
  if (!row || !v.canSeeRev(obligationRev)) throw notFound();
  const ob = pj(row.content);
  if (row.kind !== "research") throw new DomainError("invalid_input", "Bundles focus on a research obligation/objective.");
  if (!ob.payload.closure_criterion && !ob.payload.answer_criterion)
    throw new DomainError("incomplete_manifest", "A bundle needs the target's closure criterion.");
  const items = new Map<string, Item>();
  const omissions: { reason: string; expansion?: string; rev?: string; title?: string }[] = [];
  let hiddenMandatory = false;
  let informalBoundary = false;
  let sourceMissing = false;

  const put = (rev: string, partition: Item["partition"], reason: string, via: string) => {
    if (!v.canSeeRev(rev)) {
      if (partition === "mandatory") hiddenMandatory = true;
      return false;
    }
    if (!opts.include_candidates && k.entityRow(k.revRow(rev)!.entity_id)!.namespace === "candidate") return false;
    const prev = items.get(rev);
    const rank = { mandatory: 0, recommended: 1, background: 2 };
    if (prev && rank[prev.partition] <= rank[partition]) return false;
    const r = k.revRow(rev)!;
    items.set(rev, { rev, title: r.title, kind: r.kind, partition, reason, tokens: estimateTokens(k, rev), via });
    return true;
  };

  // Mandatory closure: target, context closure, definitions/assumptions/explicit uses, transitively.
  put(obligationRev, "mandatory", "Bundle target", "target");
  const stack: string[] = [obligationRev];
  if (ob.payload.target?.rev) {
    put(ob.payload.target.rev, "mandatory", "Obligation target", "target");
    stack.push(ob.payload.target.rev);
  }
  const expanded = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (expanded.has(cur)) continue;
    expanded.add(cur);
    for (const e of k.db.all("select * from refs where rev_id = ?", cur)) {
      if (["parent", "provenance", "subject", "compared"].includes(e.via)) continue;
      if (!k.revRow(e.target_rev)) continue;
      const mandatory = MANDATORY_VIAS.has(e.via) || (e.via === "reference" && ["formal", "explicit_informal", "necessary_assumption", "proof_local_use"].includes(e.dep_kind)) || (e.via === "participant" && cur === obligationRev);
      if (e.via === "reference" && e.dep_kind === "inferred") informalBoundary = true;
      if (mandatory) {
        if (e.dep_kind === "explicit_informal" || e.via === "step_use") informalBoundary = true;
        if (put(e.target_rev, "mandatory", `${e.via}${e.dep_kind ? `/${e.dep_kind}` : ""} of ${k.revRow(cur)!.title}`, e.via)) stack.push(e.target_rev);
        else if (!v.canSeeRev(e.target_rev)) hiddenMandatory = true;
      } else if (["citation", "conceptual_influence", "background"].includes(e.dep_kind ?? "")) {
        put(e.target_rev, "background", `cited by ${k.revRow(cur)!.title}`, e.via);
      } else put(e.target_rev, "recommended", `${e.via} of ${k.revRow(cur)!.title}`, e.via);
    }
    // Sources of mandatory items: missing editions lower coverage.
    for (const s of pj(k.revRow(cur)!.content).provenance?.sources ?? []) {
      if (!("rev" in s.source) || !v.canSeeRev(s.source.rev)) continue;
      const sc = k.revContent(s.source.rev);
      if (sc.payload.revision_identity?.status === "unknown" || sc.payload.availability !== "available") sourceMissing = true;
      put(s.source.rev, "recommended", `source of ${k.revRow(cur)!.title} (${s.locator})`, "source");
    }
  }

  // Upstream statements of the target with their supporting arguments.
  const targetRev = ob.payload.target?.rev;
  if (targetRev && v.canSeeRev(targetRev)) {
    for (const e of k.db.all("select rev_id, via from refs where target_rev = ? and via in ('target','participant')", targetRev)) {
      const r = k.revRow(e.rev_id);
      if (!r || !v.canSeeRev(r.id)) continue;
      if (r.kind === "argument") put(r.id, "recommended", "argument about the target", "support");
      if (r.kind === "relation") put(r.id, "recommended", "relation involving the target", "relation");
    }
    for (const f of failedAttempts(k, v, k.revRow(targetRev)!.entity_id, opts)) put(f.rev, "recommended", "failed attempt on the target (bounded conclusions)", "failed_attempt");
  }
  for (const f of failedAttempts(k, v, row.entity_id, opts)) put(f.rev, "recommended", "failed attempt on this obligation", "failed_attempt");

  // Routes, barriers and their applicability reviews.
  for (const plan of plansFor(k, v, row.entity_id, opts)) {
    put(plan.plan_rev, "recommended", "current plan/routes", "plan");
    for (const p of plan.parts) put(p.rev, "recommended", `route (${p.modality})`, "route");
  }
  for (const it of [...items.values()]) {
    const c = k.revContent(it.rev);
    if (c?.payload?.editorial_roles?.includes("barrier")) {
      const app = barrierApplicability(k, v, it.rev, opts);
      for (const a of [...app.applies_to, ...app.does_not_apply_to, ...app.undetermined]) put(a.assessment_rev, "recommended", "barrier applicability review", "applicability");
    }
  }

  // Formalizations / examples linked to mandatory items.
  for (const it of [...items.values()].filter((i) => i.partition === "mandatory")) {
    for (const e of k.db.all("select rev_id from refs where target_rev = ? and via = 'participant'", it.rev)) {
      const r = k.revRow(e.rev_id);
      if (!r || !v.canSeeRev(r.id)) continue;
      const c = pj(r.content);
      if (["formalizes", "faithfully_expresses", "instance_of", "refutes", "challenges"].includes(c.payload.contract.id))
        put(r.id, "recommended", `${c.payload.contract.id} linked to ${it.title}`, "formalization/example");
    }
  }

  // Workspace items not in reach: background with expansion links, never silently dropped.
  const mandatory = [...items.values()].filter((i) => i.partition === "mandatory");
  const recommended = [...items.values()].filter((i) => i.partition === "recommended");
  const background = [...items.values()].filter((i) => i.partition === "background");
  const budget = opts.budget ?? 8000;
  const mandatoryTokens = mandatory.reduce((s, i) => s + i.tokens, 0);
  const segments: Item[][] = [];
  let ready = true;
  if (mandatoryTokens > budget) {
    ready = false;
    let seg: Item[] = [];
    let used = 0;
    for (const it of mandatory) {
      if (used + it.tokens > budget && seg.length) {
        segments.push(seg);
        seg = [];
        used = 0;
      }
      seg.push(it);
      used += it.tokens;
    }
    if (seg.length) segments.push(seg);
  }
  let remaining = Math.max(0, budget - mandatoryTokens);
  const included: Item[] = [...mandatory];
  for (const it of [...recommended, ...background]) {
    if (it.tokens <= remaining) {
      included.push(it);
      remaining -= it.tokens;
    } else omissions.push({ rev: it.rev, title: it.title, reason: `${it.partition} item omitted for budget (${it.tokens} est. tokens)`, expansion: `expand:${it.rev}` });
  }
  const fullAccess = v.member(row.workspace_id);
  const coverage = !fullAccess
    ? "visible_scope_only"
    : hiddenMandatory
      ? "blocked_inaccessible_dependencies"
      : sourceMissing
        ? "source_missing"
        : informalBoundary
          ? "partial_informal"
          : "complete_for_declared_dependencies";
  if (coverage === "blocked_inaccessible_dependencies") ready = false;
  return {
    target: { rev: obligationRev, title: row.title, closure_criterion: ob.payload.closure_criterion ?? ob.payload.answer_criterion, goal: ob.payload.goal },
    profile: opts.profile,
    audience: { viewer: v.id, scope: fullAccess ? "workspace member" : "visible records only" },
    policy: opts.policy ?? "workspace_curator_selection@1",
    cut: opts.cut ?? k.now(),
    ready,
    coverage,
    coverage_note: {
      complete_for_declared_dependencies: "Mandatory closure is complete with respect to the declared dependencies; this is not a universal sufficiency claim.",
      partial_informal: "Mandatory closure follows informal/explicit dependencies whose capture may be incomplete; review the informal boundary.",
      source_missing: "Some sources lack an exact edition or are unavailable.",
      blocked_inaccessible_dependencies: "Some mandatory dependencies are not accessible to this audience: completeness cannot be asserted. Use a self-contained derived object or request access.",
      visible_scope_only: "Computed over records visible to you only; completeness cannot be asserted.",
    }[coverage],
    budget,
    mandatory_tokens: mandatoryTokens,
    segments: segments.map((s, i) => ({ index: i + 1, items: s.map((x) => x.rev), tokens: s.reduce((a, b) => a + b.tokens, 0) })),
    items: included.map((i) => ({ ...i, status: i.kind !== "source" ? summaryChips(k, v, i.rev, opts) : undefined })),
    omissions,
    profile_extras:
      opts.profile === "ai"
        ? {
            contracts: "Relations carry contract ids with roles; do not infer semantics from names. See /api contracts.",
            candidate_boundary: "Any output you produce is a candidate. Reference every input that grounds an output by exact revision; request expansion when premises are missing.",
            output_constraints: ["Cite exact revision ids", "Do not mark anything verified", "State scope and non-conclusions for failures"],
          }
        : opts.profile === "collaborator"
          ? { glossary: glossary(k, included.map((i) => i.rev)), introduction: ob.payload.goal }
          : undefined,
  };
}

function summaryChips(k: Kernel, v: Viewer, rev: string, scope: QueryScope) {
  const s = statusVector(k, v, rev, scope);
  return { logical: s.dimensions.logical.summary, evidence: s.dimensions.evidence.summary, review: s.dimensions.review.summary, validity: s.dimensions.validity.summary };
}

function glossary(k: Kernel, revs: string[]) {
  const out: { symbol: string; meaning: string; from: string }[] = [];
  for (const r of revs) {
    const c = k.revContent(r);
    for (const b of c?.payload?.notation ?? []) out.push({ ...b, from: c.title });
    for (const rep of c?.representations ?? []) for (const b of rep.bindings ?? []) out.push({ ...b, from: c.title });
  }
  return out;
}

/** Fix a computed bundle as a reproducible Collection revision (§26: "Bundle es Collection revision"). */
export function sealBundle(k: Kernel, actor: string, obligationRev: string, opts: { profile: BundleProfile; budget?: number; declared_adequate_for?: string } & QueryScope) {
  const v = k.viewer(actor);
  const b = computeBundle(k, v, obligationRev, opts);
  const row = k.revRow(obligationRev)!;
  const ws = k.db.get("select root_context_rev from workspaces where id = ?", row.workspace_id)!;
  return createAndSeal(k, actor, {
    workspace_id: row.workspace_id,
    kind: "collection",
    title: `Context bundle — ${row.title} (${opts.profile})`,
    facets: ["collection", "bundle"],
    content: {
      context: { rev: row.context_rev ?? ws.root_context_rev },
      payload: {
        purpose: "bundle",
        description: `Bundle for ${row.title}`,
        manifest: b.items.map((i, n) => ({ slot: `m${n + 1}`, ref: { rev: i.rev }, role: i.reason, relation: "references", partition: i.partition })),
        bundle: {
          target: obligationRev,
          profile: opts.profile,
          coverage: b.coverage,
          coverage_note: b.coverage_note,
          ready: b.ready,
          omissions: b.omissions.map((o) => ({ reason: o.reason, expansion: o.expansion })),
          segments: b.segments,
          policy: b.policy,
          cut: b.cut,
          declared_adequate_for: opts.declared_adequate_for,
        },
      },
      provenance: { origin: "deterministic", acquisition: "editorial_transformation", notes: "Bundle computed from typed references; human declaration of adequacy is separate." } as any,
    },
  });
}
