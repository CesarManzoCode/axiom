// Semantic comparison (§24; Q13; AC21, AC22). Automatic detection only *suggests* change
// classes; classification with authority is a recorded comparison evaluation. Lexical
// distance never decides strengthening or equivalence.
import { pj } from "./db.ts";
import { notFound, type Kernel, type Viewer } from "./kernel.ts";
import { contextClosure } from "./validate.ts";

type Token = { t: string; op: "same" | "add" | "del" };

function tokenize(s: string) {
  return s.split(/(\s+|[(),.;:])/).filter((x) => x && !/^\s+$/.test(x));
}

/** Word-level LCS diff; texts in this product are statements, so quadratic is acceptable. */
export function wordDiff(a: string, b: string): Token[] {
  const x = tokenize(a);
  const y = tokenize(b);
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Token[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ t: x[i], op: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: x[i++], op: "del" });
    else out.push({ t: y[j++], op: "add" });
  }
  while (i < x.length) out.push({ t: x[i++], op: "del" });
  while (j < y.length) out.push({ t: y[j++], op: "add" });
  return out;
}

const QUANT = /(∀|∃|for all|for every|for each|there exists|there is|almost every(?:where)?|a\.e\.|infinitely many|eventually)/gi;
function quantifierSequence(s: string) {
  return (s.match(QUANT) ?? []).map((q) => q.toLowerCase().replace("for every", "for all").replace("for each", "for all"));
}

function mainText(c: any): string {
  const p = c.payload ?? {};
  return p.statement ?? p.description ?? p.goal ?? p.interpretation ?? p.summary ?? p.foundations ?? c.representations?.[0]?.content ?? c.title;
}

export interface Suggestion {
  class: string;
  status: "suggested";
  detection: string;
}

export function compareRevisions(k: Kernel, v: Viewer, oldRev: string, newRev: string) {
  if (!v.canSeeRev(oldRev) || !v.canSeeRev(newRev)) throw notFound();
  const a = k.revContent(oldRev);
  const b = k.revContent(newRev);
  const ra = k.revRow(oldRev)!;
  const rb = k.revRow(newRev)!;
  const ta = mainText(a);
  const tb = mainText(b);
  const suggestions: Suggestion[] = [];
  const structural: string[] = [];

  // Context alignment precedes comparison.
  const ctxA = ra.context_rev;
  const ctxB = rb.context_rev;
  const lookup = (id: string) => {
    const r = k.revRow(id);
    return r ? { id, entity_id: r.entity_id, workspace_id: r.workspace_id, kind: r.kind, namespace: "curated", content: pj(r.content) } : undefined;
  };
  let alignment: "same_context" | "nested_context" | "different_context";
  if (ctxA === ctxB) alignment = "same_context";
  else if (contextClosure(lookup, ctxB).has(ctxA) || contextClosure(lookup, ctxA).has(ctxB)) alignment = "nested_context";
  else alignment = "different_context";
  if (alignment !== "same_context") {
    suggestions.push({ class: "changed_foundation_import", status: "suggested", detection: `Context changed (${k.revRow(ctxA)?.title} → ${k.revRow(ctxB)?.title}).` });
    structural.push("Context differs: meaning may differ even for identical text; transport needs a mapping.");
  }

  const tokens = wordDiff(ta, tb);
  const changed = tokens.filter((t) => t.op !== "same");
  const onlyCosmetic = changed.every((t) => /^[\s,.;:()]+$/.test(t.t)) && changed.length > 0;
  if (onlyCosmetic) suggestions.push({ class: "typo_editorial", status: "suggested", detection: "Only punctuation/spacing changed. Editorial class still needs author declaration." });
  const qa = quantifierSequence(ta);
  const qb = quantifierSequence(tb);
  if (qa.join("|") !== qb.join("|"))
    suggestions.push({ class: "changed_quantifier", status: "suggested", detection: `Quantifier sequence ${qa.join(" ") || "∅"} → ${qb.join(" ") || "∅"}. Equivalence unknown without evidence.` });

  const asA: any[] = a.payload?.assumptions ?? [];
  const asB: any[] = b.payload?.assumptions ?? [];
  const exprA = new Map(asA.map((x) => [x.id, x.expr]));
  const exprB = new Map(asB.map((x) => [x.id, x.expr]));
  for (const [id, e] of exprB) if (!exprA.has(id)) suggestions.push({ class: "added_assumption", status: "suggested", detection: `Assumption ${id} added: ${e}` });
  for (const [id, e] of exprA) if (!exprB.has(id)) suggestions.push({ class: "removed_assumption", status: "suggested", detection: `Assumption ${id} removed: ${e}` });
  for (const [id, e] of exprB)
    if (exprA.has(id) && exprA.get(id) !== e)
      suggestions.push({ class: "strengthened_assumption", status: "suggested", detection: `Assumption ${id} changed (${exprA.get(id)} → ${e}); direction (strengthened/weakened) requires a mapping or proof.` });

  const varsA = new Map<string, any>((a.payload?.variables ?? []).map((x: any) => [x.name, x]));
  const varsB = new Map<string, any>((b.payload?.variables ?? []).map((x: any) => [x.name, x]));
  for (const [n, x] of varsB) {
    const y = varsA.get(n);
    if (y && y.domain !== x.domain) suggestions.push({ class: "changed_domain", status: "suggested", detection: `Domain of ${n}: ${y.domain} → ${x.domain}` });
  }
  const orderA = [...varsA.values()].map((x: any) => `${x.binder ?? "free"}:${x.name}`).join(",");
  const orderB = [...varsB.values()].map((x: any) => `${x.binder ?? "free"}:${x.name}`).join(",");
  if (varsA.size && varsB.size && orderA !== orderB && !suggestions.some((s) => s.class === "changed_quantifier"))
    suggestions.push({ class: "changed_quantifier", status: "suggested", detection: `Binder order ${orderA} → ${orderB}` });

  // Symbol-only substitutions: notation or resource/parameter change — needs review either way.
  const dels = changed.filter((t) => t.op === "del").map((t) => t.t);
  const adds = changed.filter((t) => t.op === "add").map((t) => t.t);
  if (dels.length && dels.length === adds.length && dels.every((d) => d.length <= 3) && adds.every((x) => x.length <= 3) && !onlyCosmetic)
    suggestions.push({ class: "changed_resource_parameter", status: "suggested", detection: `Symbols ${dels.join(",")} → ${adds.join(",")}: notation-only or a parameter change; review required.` });

  if (a.kind === "relation" && b.kind === "relation") {
    const pa = a.payload.slots.map((s: any) => `${s.role}:${s.ref.rev}`).sort().join(" ");
    const pb = b.payload.slots.map((s: any) => `${s.role}:${s.ref.rev}`).sort().join(" ");
    if (pa !== pb) structural.push("Participants or roles changed.");
    if (a.payload.contract.id !== b.payload.contract.id) structural.push(`Contract changed ${a.payload.contract.id} → ${b.payload.contract.id}.`);
  }
  if (ta === tb && alignment === "same_context" && ra.entity_id === rb.entity_id)
    structural.push("Statement text and context are identical; differences (if any) are in representations or metadata.");

  const recorded = k.db
    .all(
      `select distinct x.rev_id from refs x where x.target_rev in (?, ?) and x.via = 'compared'`,
      oldRev,
      newRev,
    )
    .filter((r) => v.canSeeRev(r.rev_id))
    .map((r) => ({ rev: r.rev_id, row: k.revRow(r.rev_id)!, c: k.revContent(r.rev_id) }))
    .filter(({ c }) => c.payload.comparison?.old?.rev === oldRev && c.payload.comparison?.new?.rev === newRev)
    .map(({ rev, row, c }) => ({
      rev,
      assessor: k.agentDescriptor(c.payload.assessor?.agent ?? row.sealed_by)?.name,
      verdict: c.payload.comparison.verdict,
      context_mapping: c.payload.comparison.context_mapping,
      changes: c.payload.comparison.changes,
      evidence: c.payload.evidence,
      recorded_at: row.sealed_at,
    }));

  return {
    old: { rev: oldRev, title: ra.title, seq: ra.seq, entity: ra.entity_id, text: ta },
    new: { rev: newRev, title: rb.title, seq: rb.seq, entity: rb.entity_id, text: tb },
    alignment,
    text_diff: tokens,
    suggestions,
    structural,
    recorded_classifications: recorded,
    verdict_note: "Suggestions are candidates. Only a recorded comparison with an assessor classifies the change; 'equivalent' is never inferred from text.",
  };
}
