// Research cockpit queries (§14, §15; Q07, Q08, Q15, Q16). Plans are first-class
// `decomposes_into` relations whose parts each carry one modality; AND/OR is local to the
// plan. Blocking is only ever the attributed result of an applicability evaluation.
import { pj } from "./db.ts";
import type { Kernel, Viewer } from "./kernel.ts";
import { workStateOf } from "./state.ts";
import { positionsOn, summarize, type QueryScope } from "./status.ts";

function visibleRelRevs(k: Kernel, v: Viewer, sql: string, params: any[], scope: QueryScope) {
  return k.db
    .all(sql, ...params)
    .filter((r) => v.canSeeRev(r.rev_id) && (!scope.cut || k.revRow(r.rev_id)!.sealed_at <= scope.cut))
    .filter((r) => scope.include_candidates || k.entityRow(k.revRow(r.rev_id)!.entity_id)!.namespace === "curated");
}

/** Applicability evaluations recorded against any revision of the route's entity. */
export function routeStatus(k: Kernel, v: Viewer, entityId: string, scope: QueryScope = {}) {
  const ws = workStateOf(k, entityId, scope.cut);
  const barriers: any[] = [];
  for (const rev of k.revisionsOf(entityId)) {
    if (!v.canSeeRev(rev.id)) continue;
    const pos = positionsOn(k, v, rev.id, scope).filter((p) => p.dimension === "barrier_applicability");
    const byBarrier = new Map<string, typeof pos>();
    for (const p of pos) {
      const c = k.revContent(p.assessment_rev);
      const b = c.payload.barrier?.rev as string;
      byBarrier.set(b, [...(byBarrier.get(b) ?? []), p]);
    }
    for (const [barrier, ps] of byBarrier) {
      const view = summarize(k, v, rev.id, "barrier_applicability", ps, scope, "undetermined");
      barriers.push({
        route_rev: rev.id,
        barrier: { rev: barrier, title: v.canSeeRev(barrier) ? k.revRow(barrier)?.title : null },
        applicability: view.summary,
        conflicting: view.conflicting,
        positions: ps.map((p) => ({ value: p.value, predicate: p.reason, scope: p.scope, assessor: p.assessor.name, assessment_rev: p.assessment_rev })),
      });
    }
  }
  const failed = failedAttempts(k, v, entityId, scope).length;
  let liveness: string;
  if (ws.state === "abandoned") liveness = "abandoned";
  else if (ws.state === "completed") liveness = "completed";
  else if (barriers.some((b) => b.applicability === "applies" && !b.conflicting)) liveness = "blocked_in_evaluated_scope";
  else if (barriers.some((b) => ["undetermined", "disputed", "conflicting"].includes(b.applicability) || b.conflicting))
    liveness = "possibly_blocked_unknown";
  else liveness = "live_no_applicable_barrier_recorded";
  return {
    entity: entityId,
    work_state: ws.state,
    liveness,
    barriers,
    failed_attempts: failed,
    note: "Liveness reflects recorded evaluations only; it is not a claim that the listed routes exhaust the problem.",
  };
}

export interface PlanNode {
  plan_rev: string;
  plan_title: string;
  plan_mode: string;
  whole_rev: string;
  parts: {
    slot: string;
    modality: string;
    rev: string;
    entity: string;
    title: string;
    kind: string;
    role?: string;
    route: ReturnType<typeof routeStatus> | null;
    closure: any;
    plans: PlanNode[];
  }[];
}

/** Q07: plans decomposing an objective, recursively, with visited set (cycles terminate). */
export function plansFor(k: Kernel, v: Viewer, entityId: string, scope: QueryScope = {}, visited = new Set<string>()): PlanNode[] {
  if (visited.has(entityId)) return [];
  visited.add(entityId);
  const rows = visibleRelRevs(
    k,
    v,
    `select x.rev_id, x.target_rev from refs x join revisions r on r.id = x.rev_id
     where x.target_entity = ? and x.via = 'participant' and x.role = 'whole'`,
    [entityId],
    scope,
  );
  const plans: PlanNode[] = [];
  for (const row of rows) {
    const rel = pj(k.revRow(row.rev_id)!.content);
    if (rel.payload.contract.id !== "decomposes_into") continue;
    const parts = rel.payload.slots
      .filter((s: any) => s.role === "part")
      .filter((s: any) => v.canSeeRev(s.ref.rev))
      .map((s: any) => {
        const pr = k.revRow(s.ref.rev)!;
        const pc = pj(pr.content);
        const isResearch = pr.kind === "research";
        const ws = isResearch ? workStateOf(k, pr.entity_id, scope.cut) : null;
        return {
          slot: s.slot,
          modality: s.modality,
          rev: pr.id,
          entity: pr.entity_id,
          title: pr.title,
          kind: pr.kind,
          role: pc.payload?.role,
          route: isResearch || pr.kind === "method" ? routeStatus(k, v, pr.entity_id, scope) : null,
          closure: ws ? { state: ws.state, accepted: ws.closures.filter((c: any) => c.decision?.accepted) } : null,
          plans: plansFor(k, v, pr.entity_id, scope, visited),
        };
      });
    plans.push({ plan_rev: row.rev_id, plan_title: rel.title, plan_mode: rel.payload.fields.plan_mode, whole_rev: row.target_rev, parts });
  }
  return plans;
}

/** Q07 flattening: what remains open under each plan, with modality and local AND/OR. */
export function blockingObligations(k: Kernel, v: Viewer, entityId: string, scope: QueryScope = {}) {
  const plans = plansFor(k, v, entityId, scope);
  return plans.map((p) => ({
    plan_rev: p.plan_rev,
    plan_title: p.plan_title,
    plan_mode: p.plan_mode,
    meaning:
      p.plan_mode === "AND"
        ? "All listed local criteria are required by this plan (not by every possible proof)."
        : "Any listed alternative can satisfy this plan; the list is not claimed exhaustive.",
    open: p.parts.filter((x) => x.closure && x.closure.state !== "completed").map((x) => ({ title: x.title, rev: x.rev, modality: x.modality, state: x.closure.state, liveness: x.route?.liveness })),
    satisfied: p.parts.filter((x) => x.closure?.state === "completed").map((x) => ({ title: x.title, rev: x.rev, modality: x.modality })),
  }));
}

/** Q15: failed attempts on a target with their bounded conclusions. */
export function failedAttempts(k: Kernel, v: Viewer, targetEntity: string, scope: QueryScope = {}) {
  const rows = k.db.all(
    `select distinct x.rev_id from refs x join revisions r on r.id = x.rev_id
     where x.target_entity = ? and x.via = 'target' and r.kind = 'research'`,
    targetEntity,
  );
  return rows
    .filter((r) => v.canSeeRev(r.rev_id) && (!scope.cut || k.revRow(r.rev_id)!.sealed_at <= scope.cut))
    .map((r) => ({ row: k.revRow(r.rev_id)!, c: k.revContent(r.rev_id) }))
    .filter(({ c }) => c.payload.attempt?.result === "failed")
    .map(({ row, c }) => ({
      rev: row.id,
      entity: row.entity_id,
      title: row.title,
      strategy: c.payload.attempt.strategy,
      failure: c.payload.attempt.failure,
      artifacts: c.payload.attempt.artifacts,
      artifacts_missing_reason: c.payload.attempt.artifacts_missing_reason,
      note: "A failed attempt bounds what this strategy established; impossibility would require a separate claim and argument.",
    }));
}

/** Q16: techniques/routes a barrier was evaluated against, and what stays uncovered. */
export function barrierApplicability(k: Kernel, v: Viewer, barrierRev: string, scope: QueryScope = {}) {
  const decl = k.revContent(barrierRev);
  const rows = k.db.all(
    `select x.rev_id from refs x join revisions r on r.id = x.rev_id
     where x.target_rev = ? and x.via = 'barrier' and r.kind = 'evaluation'`,
    barrierRev,
  );
  const evaluations = rows
    .filter((r) => v.canSeeRev(r.rev_id) && (!scope.cut || k.revRow(r.rev_id)!.sealed_at <= scope.cut))
    .map((r) => {
      const c = k.revContent(r.rev_id);
      const subj = c.payload.subject.rev;
      return {
        assessment_rev: r.rev_id,
        subject: { rev: subj, title: v.canSeeRev(subj) ? k.revRow(subj)?.title : null },
        value: c.payload.value,
        predicate: c.payload.predicate,
        scope: c.payload.scope,
        assessor: k.agentDescriptor(c.payload.assessor?.agent ?? k.revRow(r.rev_id)!.sealed_by)?.name ?? c.payload.assessor?.descriptor,
      };
    });
  return {
    barrier: { rev: barrierRev, title: k.revRow(barrierRev)?.title, predicate: decl?.payload?.barrier?.predicate, conditions: decl?.payload?.barrier?.conditions ?? [], restricts: decl?.payload?.barrier?.restricts },
    applies_to: evaluations.filter((e) => e.value === "applies"),
    does_not_apply_to: evaluations.filter((e) => e.value === "does_not_apply"),
    undetermined: evaluations.filter((e) => e.value === "undetermined" || e.value === "disputed"),
    note: "Techniques not listed were not evaluated against this barrier; the barrier blocks only where applicability was shown.",
  };
}

/** Workspace cockpit: research items by role with work state and liveness. */
export function cockpit(k: Kernel, v: Viewer, ws: string, scope: QueryScope = {}) {
  const items = k.db
    .all("select * from entities where workspace_id = ? and kind = 'research' and namespace = 'curated' order by created_at", ws)
    .filter((e) => v.canSeeEntity(e.id))
    .map((e) => {
      const rev = k.revisionsOf(e.id).filter((r) => v.canSeeRev(r.id)).at(-1);
      const c = rev ? pj(rev.content) : null;
      const st = workStateOf(k, e.id, scope.cut);
      return {
        entity: e.id,
        rev: rev?.id ?? null,
        title: e.title,
        role: c?.payload?.role ?? "draft",
        goal: c?.payload?.goal,
        responsible: c?.payload?.responsible ? k.agentDescriptor(c.payload.responsible)?.name : null,
        work_state: st.state,
        result: c?.payload?.attempt?.result,
        sealed: !!rev,
        access: pj(e.access).mode,
      };
    });
  const objectives = items.filter((i) => ["objective", "problem", "program"].includes(i.role) && i.rev);
  return {
    items,
    objectives: objectives.map((o) => ({ ...o, plans: plansFor(k, v, o.entity, scope) })),
  };
}
