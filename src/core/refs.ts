// Reference walking, classification and resolution. Every reference held inside revision
// content is indexed as a typed edge so that dependency, impact, exposure and inverse
// queries (Q02, Q03, Q05, Q06, Q17, Q19) traverse one structure.
import type { Ref } from "./types.ts";

export type Path = (string | number)[];

export function isRefLike(o: unknown): o is Ref {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const keys = Object.keys(o).filter((k) => (o as any)[k] !== undefined);
  const has = (...ks: string[]) => keys.every((k) => ks.includes(k));
  if (typeof (o as any).rev === "string") return has("rev", "slot");
  if (typeof (o as any).draft === "string") return has("draft", "slot");
  if (typeof (o as any).entity === "string" && typeof (o as any).selector === "string") return has("entity", "selector");
  return false;
}

/** Visit every reference in a content tree, depth-first, with its path. */
export function walkRefs(node: unknown, visit: (ref: Ref, path: Path) => void, path: Path = []): void {
  if (isRefLike(node)) {
    visit(node, path);
    return;
  }
  if (Array.isArray(node)) node.forEach((v, i) => walkRefs(v, visit, [...path, i]));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) walkRefs(v, visit, [...path, k]);
}

/** Return a deep copy with every reference replaced through `fn`. */
export function mapRefs<T>(node: T, fn: (ref: Ref, path: Path) => Ref, path: Path = []): T {
  if (isRefLike(node)) return fn(node, path) as T;
  if (Array.isArray(node)) return node.map((v, i) => mapRefs(v, fn, [...path, i])) as T;
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = mapRefs(v, fn, [...path, k]);
    return out;
  }
  return node;
}

export interface EdgeClass {
  via: string;
  role?: string;
  slot?: string;
  dep_kind?: string;
  origin?: string;
  locator?: string;
  structural?: boolean;
}

/**
 * Edge vias that carry meaning needed to interpret/justify a revision. `parent` (ancestry)
 * and `provenance` (lineage/raw inputs) are deliberately absent: they live in a ledger with
 * its own audience and never force exposure (§22, T30).
 */
export const SEMANTIC_VIAS = new Set([
  "context",
  "context_parent",
  "context_import",
  "context_definition",
  "reference",
  "assumption_source",
  "target",
  "step_use",
  "dependency_set",
  "environment",
  "analyzes",
  "participant",
  "hypothesis",
  "subject",
  "evidence",
  "barrier",
  "compared",
  "manifest",
  "transclusion",
  "selection",
  "output",
  "artifact",
  "successor",
  "diagram",
]);

/** Classify a reference by its location inside content of a given kind. */
export function classify(content: any, path: Path): EdgeClass {
  const [top, a, b, c] = path;
  const payload = content.payload ?? {};
  if (top === "context") return { via: "context", role: "environment" };
  if (top === "parents") return { via: "parent" };
  if (top === "provenance") return { via: "provenance" };
  if (top === "representations") return { via: "diagram" };
  if (top === "references") {
    const use = content.references?.[a as number] ?? {};
    return {
      via: "reference",
      dep_kind: use.purpose,
      role: use.role,
      origin: use.origin ?? "explicit",
      locator: use.locator,
    };
  }
  if (top !== "payload") return { via: "reference" };
  switch (content.kind) {
    case "context":
      if (a === "parent") return { via: "context_parent", role: "environment" };
      if (a === "imports") return { via: "context_import", role: "environment" };
      if (a === "definitions") return { via: "context_definition", role: "definition" };
      if (a === "assumptions") return { via: "assumption_source" };
      break;
    case "declaration":
      if (a === "assumptions") return { via: "assumption_source" };
      break;
    case "argument":
      if (a === "targets") return { via: "target" };
      if (a === "steps")
        return {
          via: "step_use",
          dep_kind: "proof_local_use",
          role: "statement",
          locator: payload.steps?.[b as number]?.id,
        };
      if (a === "dependency_sets")
        return {
          via: "dependency_set",
          dep_kind: "proof_local_use",
          role: "statement",
          locator: payload.dependency_sets?.[b as number]?.id,
        };
      if (a === "formal") return { via: "environment", role: "environment" };
      if (a === "analyzes") return { via: "analyzes", role: "proof" };
      break;
    case "relation":
      if (a === "slots") {
        const s = payload.slots?.[b as number] ?? {};
        return { via: "participant", role: s.role, slot: s.slot, locator: s.modality };
      }
      if (a === "hypotheses") return { via: "hypothesis" };
      break;
    case "evaluation":
      if (a === "subject") return { via: "subject", locator: payload.locator };
      if (a === "evidence") return { via: "evidence" };
      if (a === "barrier") return { via: "barrier" };
      if (a === "comparison") return { via: "compared", role: String(b) };
      break;
    case "collection":
      if (a === "manifest") {
        const m = payload.manifest?.[b as number] ?? {};
        return {
          via: "manifest",
          role: m.role,
          slot: m.slot,
          dep_kind: m.relation,
          locator: m.partition,
          structural: m.relation === "has_part" || m.relation === "contains",
        };
      }
      if (a === "narrative") return { via: "transclusion", locator: payload.narrative?.[b as number]?.id };
      break;
    case "research":
      if (a === "target") return { via: "target" };
      if (a === "selection") return { via: "selection" };
      if (a === "attempt") {
        if (b === "outputs") return { via: "output" };
        if (b === "artifacts") return { via: "artifact" };
        if (b === "failure" && c === "barrier_applicability") return { via: "barrier" };
        if (b === "failure" && c === "successors") return { via: "successor" };
      }
      break;
  }
  void c;
  return { via: "reference" };
}

export function refKey(r: Ref): string {
  if ("rev" in r) return r.slot ? `${r.rev}#${r.slot}` : r.rev;
  if ("draft" in r) return `draft:${r.draft}`;
  return `entity:${r.entity}@${r.selector}`;
}
