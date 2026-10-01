// Seal-time contract validation (§34B/D/E/I). Validation proves well-formedness only;
// a schema-valid relation can still be mathematically false and be marked so by Assessment.
import { DomainError } from "./kernel.ts";
import type { Kernel } from "./kernel.ts";
import { pj } from "./db.ts";
import {
  PAYLOAD_SCHEMAS,
  type Content,
  type ContextP,
  type GroupExpr,
  type RelationP,
} from "./types.ts";
import {
  CONTRACT_INDEX,
  DEP_KINDS,
  FINDING_VALUES,
  allowedValues,
  type RelationContract,
} from "./vocab.ts";

/** Minimal view of a referenced revision, available both for stored and same-cohort revisions. */
export interface RevInfo {
  id: string;
  entity_id: string;
  workspace_id: string;
  kind: string;
  namespace: string;
  content: Content;
}
export type Lookup = (revId: string) => RevInfo | undefined;

export function lookupContract(k: Kernel, id: string, version: string): RelationContract | undefined {
  const core = CONTRACT_INDEX.get(id);
  if (core && core.version === version) return core;
  const ext = k.db.get("select definition from contracts where id = ? and version = ?", id, version);
  return ext ? ({ ...pj(ext.definition), inference: "none" } as RelationContract) : undefined;
}

function violation(msg: string, details?: unknown): never {
  throw new DomainError("contract_violation", msg, details);
}

export function parsePayload(content: Content) {
  const schema = PAYLOAD_SCHEMAS[content.kind];
  const r = schema.safeParse(content.payload);
  if (!r.success)
    violation(`Payload does not satisfy the '${content.kind}' contract.`, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  return r.data as any;
}

/** Context closure: the revision itself plus parents and interpretive imports, transitively. */
export function contextClosure(lookup: Lookup, ctxRev: string): Set<string> {
  const seen = new Set<string>();
  const stack = [ctxRev];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const info = lookup(id);
    if (!info || info.kind !== "context") continue;
    const p = info.content.payload as ContextP;
    if (p.parent && "rev" in p.parent) stack.push(p.parent.rev);
    for (const imp of p.imports ?? []) if ("rev" in imp) stack.push(imp.rev);
  }
  return seen;
}

function contextOf(info: RevInfo): string | undefined {
  const c = info.content.context as any;
  if (c?.self) return info.id;
  return c?.rev;
}

function checkGroup(expr: GroupExpr, allowed: Set<string>, used: Set<string>, role: string) {
  for (const item of expr.items) {
    if (typeof item === "string") {
      if (!allowed.has(item)) violation(`Grouping for '${role}' names unknown slot '${item}'.`);
      if (used.has(item)) violation(`Slot '${item}' appears twice in the '${role}' grouping.`);
      used.add(item);
    } else checkGroup(item, allowed, used, role);
  }
}

export function validateRelation(k: Kernel, lookup: Lookup, rel: RelationP, ownContext: string | undefined) {
  const contract = lookupContract(k, rel.contract.id, rel.contract.version);
  if (!contract)
    violation(
      `Unknown relation contract '${rel.contract.id}@${rel.contract.version}'. Register an extension contract first; names are never inferred.`,
    );
  const slotIds = new Set<string>();
  for (const s of rel.slots) {
    if (slotIds.has(s.slot)) violation(`Duplicate slot id '${s.slot}'.`);
    slotIds.add(s.slot);
  }
  const byRole = new Map<string, typeof rel.slots>();
  for (const s of rel.slots) {
    const spec = contract.roles.find((r) => r.role === s.role);
    if (!spec) violation(`Role '${s.role}' is not defined by contract '${contract.id}'.`);
    byRole.set(s.role, [...(byRole.get(s.role) ?? []), s]);
    if (!("rev" in s.ref)) continue;
    const info = lookup(s.ref.rev);
    if (!info) continue;
    if (spec.kinds && spec.kinds.length && !spec.kinds.includes(info.kind))
      violation(`Participant in role '${s.role}' must be one of: ${spec.kinds.join(", ")} (got ${info.kind}).`);
    if (spec.categories && info.kind === "declaration") {
      const cat = (info.content.payload as any).category;
      if (!spec.categories.includes(cat))
        violation(
          `Role '${s.role}' of '${contract.id}' requires a ${spec.categories.join("/")} declaration; '${info.content.title}' is ${cat}. Introduce objects through a definition or binding.`,
        );
    }
  }
  for (const spec of contract.roles) {
    const count = byRole.get(spec.role)?.length ?? 0;
    if (count < spec.card.min) violation(`Contract '${contract.id}' needs at least ${spec.card.min} '${spec.role}'.`);
    if (spec.card.max !== null && count > spec.card.max)
      violation(`Contract '${contract.id}' allows at most ${spec.card.max} '${spec.role}'.`);
  }
  // Explicit logical grouping (I12, T08): several premises are never an unstructured list.
  for (const role of contract.grouped ?? []) {
    const slots = byRole.get(role) ?? [];
    const expr = rel.grouping?.[role];
    if (slots.length > 1 && !expr && role !== "conclusion")
      violation(`'${contract.id}' with ${slots.length} '${role}' slots needs an explicit AND/OR grouping.`);
    if (expr) {
      const used = new Set<string>();
      checkGroup(expr, new Set(slots.map((s) => s.slot)), used, role);
      if (used.size !== slots.length) violation(`Grouping for '${role}' must cover every '${role}' slot exactly once.`);
    }
  }
  for (const f of contract.required_fields ?? [])
    if (!rel.fields?.[f]) violation(`Contract '${contract.id}' requires field '${f}'.`);
  switch (contract.id) {
    case "depends_on":
      if (!(DEP_KINDS as readonly string[]).includes(rel.fields.dependency_kind))
        violation(`dependency_kind must be one of ${DEP_KINDS.join(", ")}.`);
      break;
    case "isomorphic_to":
      if (!byRole.get("witness")?.length && !rel.witness_not_provided)
        violation("isomorphic_to needs a witness slot or an explicit 'witness not yet provided' flag.");
      break;
    case "reduces_to":
      if (!byRole.get("witness")?.length && !rel.witness_not_provided)
        violation("reduces_to needs a reduction witness or an explicit missing-witness flag.");
      break;
    case "equivalent_under":
      if ((byRole.get("side")?.length ?? 0) > 2 && !rel.pairing)
        violation("Equivalence of three or more sides must declare all_pairs or listed_pairs.");
      break;
    case "decomposes_into":
      if (!["AND", "OR"].includes(rel.fields.plan_mode)) violation("plan_mode must be AND or OR.");
      for (const s of byRole.get("part") ?? [])
        if (!s.modality) violation(`Plan part '${s.slot}' needs one declared modality (§14).`);
      break;
  }
  // Endpoints interpreted in other contexts need an explicit map or an 'unresolved' comparison (§9, I32).
  if (ownContext && !rel.fields?.context_map && rel.fields?.context_comparison !== "unresolved") {
    const closure = contextClosure(lookup, ownContext);
    for (const s of rel.slots) {
      if (!("rev" in s.ref)) continue;
      const info = lookup(s.ref.rev);
      if (!info || info.kind === "context" || info.kind === "source") continue;
      const pc = contextOf(info);
      if (pc && !closure.has(pc))
        violation(
          `Participant '${info.content.title}' is interpreted in a context not included in this relation's context. Provide fields.context_map or set fields.context_comparison = 'unresolved'.`,
        );
    }
  }
  return contract;
}

/** Expanded-context conflicts: symbols, axioms, foundations or versions that differ without explicit resolution (I34). */
export function contextConflicts(lookup: Lookup, ctx: ContextP, selfEntity: string | undefined): string[] {
  const resolved = new Set(ctx.resolutions.map((r) => r.symbol));
  const notation = new Map<string, { meaning: string; from: string }>();
  const axioms = new Map<string, { text: string; from: string }>();
  const versions = new Map<string, string>();
  const foundations = new Map<string, string>();
  const conflicts: string[] = [];
  const absorb = (c: ContextP, from: string) => {
    for (const b of c.notation) {
      const prev = notation.get(b.symbol);
      if (prev && prev.meaning !== b.meaning && !resolved.has(b.symbol))
        conflicts.push(`Symbol '${b.symbol}' means '${prev.meaning}' in ${prev.from} and '${b.meaning}' in ${from}.`);
      if (!prev) notation.set(b.symbol, { meaning: b.meaning, from });
    }
    for (const a of c.axioms) {
      const prev = axioms.get(a.id);
      if (prev && prev.text !== a.text && !resolved.has(a.id))
        conflicts.push(`Axiom '${a.id}' differs between ${prev.from} and ${from}.`);
      if (!prev) axioms.set(a.id, { text: a.text, from });
    }
  };
  const visit = (ref: any, seen: Set<string>) => {
    if (!ref || !("rev" in ref) || seen.has(ref.rev)) return;
    seen.add(ref.rev);
    const info = lookup(ref.rev);
    if (!info || info.kind !== "context") return;
    const prevVersion = versions.get(info.entity_id);
    if (prevVersion && prevVersion !== info.id && !resolved.has(`version:${info.entity_id}`))
      conflicts.push(`Two revisions of context '${info.content.title}' are imported (${prevVersion}, ${info.id}).`);
    versions.set(info.entity_id, info.id);
    const p = info.content.payload as ContextP;
    if (p.foundations && p.foundations !== "unknown") foundations.set(info.id, p.foundations);
    absorb(p, info.content.title);
    visit(p.parent, seen);
    for (const i of p.imports) visit(i, seen);
  };
  const seen = new Set<string>();
  visit(ctx.parent, seen);
  for (const i of ctx.imports) visit(i, seen);
  if (selfEntity && versions.has(selfEntity)) conflicts.push("A context cannot import a revision of itself.");
  // A context's own notation/axioms that redefine inherited ones are explicit deltas only when resolved.
  absorb({ ...ctx, notation: ctx.notation, axioms: ctx.axioms } as ContextP, "this context");
  const distinct = new Set(foundations.values());
  if (distinct.size > 1 && !resolved.has("foundations"))
    conflicts.push(`Inherited foundations differ (${[...distinct].join(" | ")}); choose or map them explicitly.`);
  return conflicts;
}

export function validateEvaluation(lookup: Lookup, p: any) {
  const checkValue = (dimension: string, value: string, where: string) => {
    const allowed = allowedValues(dimension);
    if (!allowed) violation(`${where}: unknown dimension '${dimension}'.`);
    if (!allowed.includes(value))
      violation(
        `${where}: '${value}' is not a value of '${dimension}' (${allowed.join(", ")}). External verdicts are kept in source_verdict and mapped explicitly.`,
      );
  };
  switch (p.eval_kind) {
    case "assessment":
      if (!p.dimension || !p.value) violation("An assessment fixes one dimension and one value.");
      checkValue(p.dimension, p.value, "assessment");
      break;
    case "review":
      if (!p.findings.length) violation("A review evaluates at least one dimension.");
      for (const f of p.findings) checkValue(f.dimension, f.value, "review finding");
      break;
    case "applicability":
      if (!p.barrier) violation("A barrier applicability assessment names the barrier.");
      if (!p.predicate) violation("A barrier applicability assessment states the predicate tested.");
      checkValue("barrier_applicability", p.value ?? "", "applicability");
      break;
    case "consistency": {
      const subj = "rev" in p.subject ? lookup(p.subject.rev) : undefined;
      if (subj && subj.kind !== "context") violation("Consistency is assessed on a Context revision.");
      checkValue("context_consistency", p.value ?? "", "consistency");
      if (["relative_consistency_supported", "known_inconsistency"].includes(p.value) && !p.evidence.length)
        violation("Non-trivial consistency values require evidence and a metacontext.");
      break;
    }
    case "comparison":
      if (!p.comparison) violation("A semantic comparison needs old/new references and classified changes.");
      break;
  }
  void FINDING_VALUES;
}

export function validateResearch(p: any) {
  if (p.role === "obligation" && !p.closure_criterion)
    violation("An obligation needs a closure criterion (§14).");
  if (["attempt", "experiment"].includes(p.role)) {
    if (!p.attempt) violation("An attempt records strategy, protocol/steps, outputs and result.");
    if (!p.target) violation("An attempt names its exact target.");
    const a = p.attempt;
    if (a.result === "failed") {
      if (!a.failure)
        violation(
          "A failed attempt requires the failure contract: defect locator, allowed negative conclusion, non-conclusions, barrier applicability, successors and evaluator (§15).",
        );
      if (!a.artifacts.length && !a.artifacts_missing_reason)
        violation("A failed attempt lists its artifacts or states why they are missing.");
      if (a.failure.kind === "finite_search_no_hit" && !a.failure.range)
        violation("A finite search without a hit must state the searched range/protocol.");
      if (a.failure.barrier_applicability.status === "evaluated" && !a.failure.barrier_applicability.barrier)
        violation("An evaluated barrier applicability names the barrier.");
    }
  }
}

export function validateArgument(lookup: Lookup, p: any) {
  if (p.completeness === "complete" && p.gaps.length)
    violation("An argument declared complete cannot list open gaps; declare it partial.");
  if (p.argument_kind === "machine_checked" && !p.formal?.environment)
    violation("A machine-checked derivation needs its formal system and exact environment (execution context).");
  for (const t of p.targets) {
    if (!("rev" in t)) continue;
    const info = lookup(t.rev);
    if (!info) continue;
    if (info.kind === "declaration" && (info.content.payload as any).category === "interrogative")
      violation("A question has no truth value; argue for an answer statement instead.");
  }
}

export function validateContext(lookup: Lookup, content: Content, p: ContextP, selfEntity: string | undefined) {
  const self = (content.context as any)?.self === true;
  if (p.root) {
    if (!self) violation("A root context declares its own interpretation profile (self-context).");
    if (p.parent || p.imports.length) violation("A root context has no parent or interpretive imports.");
  } else if (self) violation("Only a root context may reference itself as its context (§10 bootstrap).");
  for (const r of [p.parent, ...p.imports]) {
    if (!r || !("rev" in r)) continue;
    const info = lookup(r.rev);
    if (info && info.kind !== "context") violation("Context parents and imports must be Context revisions.");
  }
  const conflicts = contextConflicts(lookup, p, selfEntity);
  if (conflicts.length)
    throw new DomainError(
      "context_conflict",
      "The expanded context has unresolved conflicts. Add explicit resolutions (choice, renaming or mapping).",
      conflicts,
    );
}
