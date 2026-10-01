// Typed, bounded impact analysis (§25; Q06; AC14, AC15, AC51). Every reported consumer has
// a route of exact edges, a propagation rule and a reason. Reachability alone never yields
// falsehood; citations never carry logical invalidity; unknown is reported, not hidden.
import { pj } from "./db.ts";
import type { Kernel, Viewer } from "./kernel.ts";
import { supportOf, type QueryScope } from "./status.ts";
import { lookupContract } from "./validate.ts";
import { NON_LOGICAL_DEPS } from "./vocab.ts";

export type ChangeKind = "defect" | "refuted" | "retracted" | "new_revision" | "context_changed";
export type Bucket = "definitely_affected" | "possibly_affected" | "unknown" | "evaluated_unaffected";

export interface Hop {
  from: string;
  to: string;
  via: string;
  role?: string | null;
  contract?: string;
  dep_kind?: string | null;
}
export interface ImpactRecord {
  target: { rev: string; title: string; kind: string; entity: string };
  bucket: Bucket;
  dimension: string;
  rule: string;
  reason: string;
  route: Hop[];
  limitations: string[];
}

interface Frontier {
  rev: string;
  strength: "definite" | "possible";
  route: Hop[];
}

export interface ImpactInput extends QueryScope {
  rev: string;
  change: ChangeKind;
  new_rev?: string;
  budget?: number;
}

export function impact(k: Kernel, v: Viewer, input: ImpactInput) {
  const budget = input.budget ?? 6;
  const records: ImpactRecord[] = [];
  const notices: any[] = [];
  const stops: { at: string; reason: string }[] = [];
  const visited = new Set<string>([input.rev]);
  const affectedArgs = new Set<string>();
  const pendingTargets = new Map<string, Frontier>();
  const queue: Frontier[] = [{ rev: input.rev, strength: "definite", route: [] }];
  const info = (rev: string) => {
    const r = k.revRow(rev)!;
    return { rev, title: r.title, kind: r.kind, entity: r.entity_id };
  };
  const add = (rec: Omit<ImpactRecord, "target" | "limitations"> & { rev: string; limitations?: string[] }) => {
    const key = `${rec.rev}|${rec.bucket}|${rec.dimension}`;
    if (records.some((r) => `${r.target.rev}|${r.bucket}|${r.dimension}` === key)) return;
    records.push({ target: info(rec.rev), bucket: rec.bucket, dimension: rec.dimension, rule: rec.rule, reason: rec.reason, route: rec.route, limitations: rec.limitations ?? [] });
  };
  const usable = (rev: string) => {
    const row = k.revRow(rev);
    if (!row) return false;
    if (input.cut && row.sealed_at > input.cut) return false;
    if (!input.include_candidates && k.entityRow(row.entity_id)!.namespace === "candidate") return false;
    return v.canSeeRev(rev);
  };
  const enqueue = (f: Frontier) => {
    if (f.route.length >= budget) {
      stops.push({ at: f.rev, reason: `Depth budget ${budget} reached; consumers beyond this point were not examined.` });
      add({ rev: f.rev, bucket: "unknown", dimension: "downstream", rule: "R-BUDGET", reason: "Traversal budget exhausted here.", route: f.route });
      return;
    }
    if (visited.has(f.rev)) return;
    visited.add(f.rev);
    queue.push(f);
  };

  if (input.change === "new_revision") {
    const diff = input.new_rev ? assumptionDelta(k, input.rev, input.new_rev) : { added: [], removed: [] };
    for (const e of k.db.all("select * from refs where target_rev = ? and via not in ('parent','provenance','subject')", input.rev)) {
      if (!usable(e.rev_id)) continue;
      notices.push({
        consumer: info(e.rev_id),
        pinned: input.rev,
        new_rev: input.new_rev,
        via: e.via,
        role: e.role,
        effect: "No change: the consumer keeps using the pinned revision. Compare and migrate explicitly if wanted.",
        migration_obligations: diff.added.map((a: string) => `Prove added assumption in the consumer's context: ${a}`),
        migration_notes: diff.removed.map((a: string) => `Removed assumption may widen applicability: ${a}`),
      });
    }
    return finish();
  }

  // The changed item may itself be a support: its own targets lose that branch.
  const start = k.revRow(input.rev);
  if (start && input.change !== "context_changed") {
    const sc = pj(start.content);
    const targets: string[] =
      start.kind === "argument"
        ? (sc.payload.targets ?? []).map((t: any) => t.rev)
        : start.kind === "relation" && ["proves", "supports"].includes(sc.payload.contract.id)
          ? sc.payload.slots.filter((s: any) => s.role === "target").map((s: any) => s.ref.rev)
          : [];
    if (targets.length) affectedArgs.add(input.rev);
    for (const t of targets)
      if (usable(t)) pendingTargets.set(t, { rev: t, strength: "definite", route: [{ from: input.rev, to: t, via: "target" }] });
  }

  while (queue.length || pendingTargets.size) {
    while (queue.length) {
      const cur = queue.shift()!;
      expand(cur);
    }
    // Support-loss evaluation once every affected argument in reach is known.
    const batch = [...pendingTargets.values()];
    pendingTargets.clear();
    for (const t of batch) evaluateSupportLoss(t);
  }
  return finish();

  function expand(cur: Frontier) {
    const edges = k.db.all("select * from refs where target_rev = ?", cur.rev);
    for (const e of edges) {
      if (["parent", "provenance", "subject", "compared", "structural_relation"].includes(e.via)) continue;
      if (e.rev_id === cur.rev) continue;
      if (!usable(e.rev_id)) continue;
      const consumer = k.revRow(e.rev_id)!;
      const hop: Hop = { from: cur.rev, to: e.rev_id, via: e.via, role: e.role, dep_kind: e.dep_kind };
      const route = [...cur.route, hop];
      const definite = cur.strength === "definite";
      const depKind: string | null = e.dep_kind;

      if (e.via === "participant") {
        const c = pj(consumer.content);
        const contractId = c.payload.contract.id;
        hop.contract = contractId;
        const contract = lookupContract(k, contractId, c.payload.contract.version);
        const relDep = c.payload.fields?.dependency_kind as string | undefined;
        if (!contract || contract.inference === "none" || contract.inference === "history") {
          if (contractId === "cites" || contractId === "motivates")
            add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "bibliographic/source alert", rule: "R-CITE", reason: "Citation or motivation of a changed item: a source alert only; no logical propagation.", route });
          else if (["formalizes", "faithfully_expresses"].includes(contractId))
            add({ rev: e.rev_id, bucket: "possibly_affected", dimension: e.role === "meaning" ? "fidelity" : "formalization", rule: "R-FORMAL", reason: "A formalization relation involves the changed item; fidelity/formalization should be re-examined.", route });
          else if (["generalizes", "specializes", "reformulates", "translates", "instance_of", "isomorphic_to", "reduces_to", "constructs", "characterizes"].includes(contractId))
            add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "correspondence", rule: "R-CORRESP", reason: `The '${contractId}' relation has the changed item as ${e.role}; its scope may need re-evaluation.`, route });
          else if (contractId === "decomposes_into")
            add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "plan", rule: "R-PLAN", reason: "A research plan includes the changed item as a route/part.", route });
          else if (contract && contract.inference === "none" && !["challenges"].includes(contractId) && contract.family === "extension")
            stops.push({ at: e.rev_id, reason: `Contract '${contractId}' declares no inference rule; navigation only.` });
          continue;
        }
        if (contract.inference === "structural") {
          add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "composition (editorial)", rule: "R-STRUCT", reason: "A composition contains the changed item; membership is editorial and transmits no validity.", route });
          continue;
        }
        if (contract.inference === "equivalence") {
          if (input.change !== "refuted") continue;
          const supported = supportOf(k, v, e.rev_id, input).summary === "accepted_support_known";
          for (const s of c.payload.slots.filter((s: any) => s.role === "side" && s.ref.rev !== cur.rev && usable(s.ref.rev)))
            add({
              rev: s.ref.rev,
              bucket: supported ? "possibly_affected" : "unknown",
              dimension: "logical (via equivalence)",
              rule: "R-EQUIV",
              reason: supported
                ? `Refutation may transfer through a supported equivalence only if its conditions hold: ${c.payload.hypotheses.map((h: any) => h.text).join("; ") || "none stated"}.`
                : "Equivalence is only claimed; transfer of refutation is not evaluated.",
              route: [...route, { from: e.rev_id, to: s.ref.rev, via: "participant", role: "side", contract: contractId }],
            });
          continue;
        }
        if (contract.inference === "refutation") {
          if (e.role === "evidence")
            add({ rev: e.rev_id, bucket: definite ? "definitely_affected" : "possibly_affected", dimension: "evidence", rule: "R-EVIDENCE", reason: "The refutation's evidence changed.", route });
          continue;
        }
        if (contract.inference === "support") {
          if (e.role === "evidence") {
            add({ rev: e.rev_id, bucket: definite ? "definitely_affected" : "possibly_affected", dimension: "evidence", rule: "R-EVIDENCE", reason: "This support relation's evidence changed; the relation itself is not refuted.", route });
            if (definite) affectedArgs.add(e.rev_id);
            for (const s of c.payload.slots.filter((s: any) => s.role === "target" && usable(s.ref.rev)))
              pendingTargets.set(s.ref.rev, { rev: s.ref.rev, strength: cur.strength, route: [...route, { from: e.rev_id, to: s.ref.rev, via: "participant", role: "target", contract: contractId }] });
          } else if (e.role === "target" && ["refuted", "retracted"].includes(input.change))
            add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "validity assessment", rule: "R-SUPPORT-TARGET", reason: "This relation claims support for an item that was refuted/retracted; re-examine it.", route });
          continue;
        }
        // Dependency contracts: entails, depends_on, uses, imports.
        const kind = contractId === "depends_on" ? relDep : contractId === "entails" ? "explicit_informal" : contractId === "imports" ? "explicit_informal" : "proof_local_use";
        if (kind && NON_LOGICAL_DEPS.has(kind)) {
          add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "bibliographic/source alert", rule: "R-CITE", reason: "Typed as citation/influence: no logical propagation.", route });
          continue;
        }
        if (contractId === "entails" && e.role === "conclusion") {
          if (input.change === "refuted")
            add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "validity assessment", rule: "R-ENTAIL-CONCL", reason: "An entailment concludes a refuted statement; some premise or the entailment needs re-examination.", route });
          continue;
        }
        const inferred = kind === "inferred";
        const bucket: Bucket = definite && !inferred ? "definitely_affected" : "possibly_affected";
        add({
          rev: e.rev_id,
          bucket,
          dimension: contractId === "imports" ? "environment" : "derivation",
          rule: inferred ? "R-INFERRED" : "R-DEP",
          reason: inferred
            ? "Inferred dependency: possible effect only; never treated as formal or certain."
            : `Exact ${kind} dependency (${e.role}) on the changed item; this registered condition changed. Its conclusion is not thereby false.`,
          route,
        });
        enqueue({ rev: e.rev_id, strength: bucket === "definitely_affected" ? "definite" : "possible", route });
        continue;
      }

      if (depKind && NON_LOGICAL_DEPS.has(depKind)) {
        add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "bibliographic/source alert", rule: "R-CITE", reason: "Cited/influenced by a changed item: source alert only; citation chains are not followed.", route });
        continue;
      }
      if (["context", "context_import", "context_parent", "context_definition", "environment"].includes(e.via)) {
        add({ rev: e.rev_id, bucket: definite ? "definitely_affected" : "possibly_affected", dimension: "interpretation/environment", rule: "R-CONTEXT", reason: "Interpreted in, or importing, the changed context/definition.", route });
        enqueue({ rev: e.rev_id, strength: "possible", route });
        continue;
      }
      if (["step_use", "dependency_set", "analyzes"].includes(e.via) || (e.via === "reference" && depKind && depKind !== "background")) {
        const inferred = depKind === "inferred" || e.origin === "inferred";
        const bucket: Bucket = definite && !inferred ? "definitely_affected" : "possibly_affected";
        add({
          rev: e.rev_id,
          bucket,
          dimension: "derivation",
          rule: inferred ? "R-INFERRED" : "R-DEP",
          reason: inferred
            ? "Inferred dependency: possible effect only."
            : `Uses the changed item exactly (${depKind ?? e.via}${e.locator ? ` at ${e.locator}` : ""}).`,
          route,
          limitations: depKind === "explicit_informal" || depKind === "proof_local_use" ? ["Informal capture; completeness of dependencies not guaranteed."] : [],
        });
        if (consumer.kind === "argument") {
          if (bucket === "definitely_affected") affectedArgs.add(e.rev_id);
          for (const t of pj(consumer.content).payload.targets ?? [])
            if (usable(t.rev)) pendingTargets.set(t.rev, { rev: t.rev, strength: bucket === "definitely_affected" ? "definite" : "possible", route: [...route, { from: e.rev_id, to: t.rev, via: "target" }] });
        } else enqueue({ rev: e.rev_id, strength: bucket === "definitely_affected" ? "definite" : "possible", route });
        continue;
      }
      if (e.via === "target" && consumer.kind === "argument") {
        if (["refuted", "retracted", "defect"].includes(input.change))
          add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "validity assessment", rule: "R-ARG-TARGET", reason: "This argument targets the changed statement; its derivation should be re-examined.", route });
        continue;
      }
      if (e.via === "target" && consumer.kind === "research") {
        add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "research target", rule: "R-RESEARCH", reason: "A research item targets the changed revision; reconsider its plan.", route });
        continue;
      }
      if (e.via === "evidence") {
        add({ rev: e.rev_id, bucket: definite ? "definitely_affected" : "possibly_affected", dimension: "evidence", rule: "R-EVIDENCE", reason: "An evaluation cites the changed item as evidence.", route });
        continue;
      }
      if (e.via === "barrier") {
        add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "applicability", rule: "R-BARRIER", reason: "An applicability evaluation relies on the changed barrier.", route });
        continue;
      }
      if (["manifest", "transclusion", "selection"].includes(e.via)) {
        add({ rev: e.rev_id, bucket: "possibly_affected", dimension: "composition (editorial)", rule: "R-STRUCT", reason: "A collection/narrative/inquiry line includes the changed item; its publication stays fixed.", route });
        continue;
      }
      if (["output", "artifact", "successor", "hypothesis", "assumption_source", "diagram"].includes(e.via)) {
        add({ rev: e.rev_id, bucket: "possibly_affected", dimension: e.via, rule: "R-RECORD", reason: `Referenced as ${e.via}.`, route });
        continue;
      }
    }
  }

  function evaluateSupportLoss(t: Frontier) {
    const sup = supportOf(k, v, t.rev, input);
    const remaining = sup.entries.filter((s) => !affectedArgs.has(s.rev) && !s.evidence_revs.some((x) => affectedArgs.has(x)));
    const lost = sup.entries.filter((s) => !remaining.includes(s));
    if (!lost.length && t.strength === "possible") {
      add({ rev: t.rev, bucket: "possibly_affected", dimension: "support set", rule: "R-SUPPORT", reason: "A support of this item is possibly affected.", route: t.route });
      return;
    }
    const acceptedLeft = remaining.filter((s) => s.status === "accepted");
    if (acceptedLeft.length) {
      add({ rev: t.rev, bucket: t.strength === "definite" ? "definitely_affected" : "possibly_affected", dimension: "support set", rule: "R-SUPPORT", reason: `Loses support from ${lost.map((s) => s.title).join(", ") || "an affected argument"}; retains accepted alternative support. The statement is not refuted.`, route: t.route });
      add({ rev: t.rev, bucket: "evaluated_unaffected", dimension: "statement standing", rule: "R-ALT-SUPPORT", reason: `Accepted alternative support remains: ${acceptedLeft.map((s) => s.title).join(", ")}.`, route: t.route });
      stops.push({ at: t.rev, reason: "Alternative accepted support retained; statement consumers not affected by this change." });
      return;
    }
    add({
      rev: t.rev,
      bucket: t.strength === "definite" ? "definitely_affected" : "possibly_affected",
      dimension: "support set",
      rule: "R-SUPPORT",
      reason: remaining.length
        ? "Loses an affected support; only unevaluated alternatives remain. Not refuted."
        : "No accepted support known after this change. This is not a refutation.",
      route: t.route,
    });
    // Consumers of the statement must re-evaluate; they are possibly affected, never refuted.
    enqueue({ rev: t.rev, strength: "possible", route: t.route });
  }

  function finish() {
    const by = (b: Bucket) => records.filter((r) => r.bucket === b);
    return {
      event: { rev: input.rev, change: input.change, new_rev: input.new_rev, title: k.revRow(input.rev)?.title },
      scope: {
        policy: input.policy ?? "workspace_curator_selection@1",
        cut: input.cut ?? k.now(),
        namespace: input.include_candidates ? "curated+candidates" : "curated",
        budget,
      },
      definitely_affected: by("definitely_affected"),
      possibly_affected: by("possibly_affected"),
      unknown: by("unknown"),
      evaluated_unaffected: by("evaluated_unaffected"),
      update_notices: notices,
      coverage: {
        visited: visited.size,
        stops,
        limitations: [
          "Only records visible to you were examined; records outside your access are neither examined nor reported.",
          "Typed traversal over recorded relations; not a universal mathematical closure.",
          ...(input.include_candidates ? [] : ["Candidates were excluded."]),
        ],
      },
    };
  }
}

function assumptionDelta(k: Kernel, oldRev: string, newRev: string) {
  const a = k.revContent(oldRev)?.payload?.assumptions ?? [];
  const b = k.revContent(newRev)?.payload?.assumptions ?? [];
  const sa = new Set<string>(a.map((x: any) => x.expr));
  const sb = new Set<string>(b.map((x: any) => x.expr));
  return { added: [...sb].filter((x) => !sa.has(x)), removed: [...sa].filter((x) => !sb.has(x)) };
}
