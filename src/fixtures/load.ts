// Load a fixture: transcription agent submits candidates; a human curator gates them in one
// batch decision; post operations (revisions, lifecycle events) are then applied by the human.
import { DomainError } from "../core/kernel.ts";
import type { Platform } from "../core/platform.ts";
import type { Fixture, FixItem } from "./dsl.ts";

const PROFILE: Record<string, { logical?: string; reason: string }> = {
  D: { logical: "not_applicable", reason: "Definition: introduces meaning, no truth value to evaluate." },
  T: { logical: "supported_derivation", reason: "Published derivation attributed to the source authors (as reported by the source)." },
  H: { logical: "open", reason: "Hypothesis/conjecture/open target as stated in the source." },
  M: { logical: "not_applicable", reason: "Method/program description." },
  P: { logical: "proof_claimed", reason: "Proof artifact; completeness as reported by the source." },
  R: { logical: "supported_derivation", reason: "Relation with evaluation attributed to the cited source." },
};

function isKey(o: any): o is { key: string; slot?: string } {
  return o && typeof o === "object" && !Array.isArray(o) && typeof o.key === "string" && Object.keys(o).every((x) => x === "key" || x === "slot");
}

function keysIn(node: any, out: Set<string>) {
  if (isKey(node)) out.add(node.key);
  else if (Array.isArray(node)) node.forEach((n) => keysIn(n, out));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => keysIn(n, out));
}

function resolve(node: any, map: Map<string, string>): any {
  if (isKey(node)) {
    const rev = map.get(node.key);
    if (!rev) throw new DomainError("reference_unresolved", `Fixture key '${node.key}' is not loaded.`);
    return node.slot ? { rev, slot: node.slot } : { rev };
  }
  if (Array.isArray(node)) return node.map((n) => resolve(n, map));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([a, b]) => [a, resolve(b, map)]));
  return node;
}

function profileAssessments(item: FixItem): FixItem[] {
  if (!item.profile || item.profile === "F" || item.kind === "source" || item.kind === "context") return [];
  const out: FixItem[] = [];
  const p = PROFILE[item.profile];
  const attribution = item.attribution ?? "source authors";
  const srcKey = item.sources?.[0]?.key;
  const subject = { key: item.key };
  const base = { kind: "evaluation" as const, context: item.context, label: item.label, sources: item.sources, attribution };
  if (p.logical)
    out.push({
      ...base,
      key: `${item.key}#logical`,
      title: `Logical status of ${item.key} (${p.logical}, per ${srcKey ?? "source"})`,
      payload: { eval_kind: "assessment", subject, dimension: "logical", value: p.logical, scope: "as reported by the cited source; not re-verified in this transcription", reason: p.reason, assessor: { descriptor: `${attribution} — via ${srcKey ?? "source"} (transcribed)` } },
    });
  out.push({
    ...base,
    key: `${item.key}#fidelity`,
    title: `Transcription fidelity of ${item.key}`,
    payload: { eval_kind: "assessment", subject, dimension: "fidelity", value: "claimed", scope: "paraphrase of the cited source by the handoff transcription; no human-formal certification", assessor: { descriptor: "Handoff transcription assistant (AI)" } },
  });
  out.push({
    ...base,
    key: `${item.key}#novelty`,
    title: `Novelty of ${item.key}`,
    payload: { eval_kind: "assessment", subject, dimension: "novelty", value: "prior_art_found", scope: "this sample: content is prior literature, no new discovery claimed", assessor: { descriptor: "Handoff transcription assistant (AI)" } },
  });
  return out;
}

export interface LoadResult {
  candidate: Map<string, string>;
  curated: Map<string, string>;
  /** key → curated rev when promoted, else candidate rev. */
  rev: (key: string) => string;
  entity: (key: string) => string;
}

export function loadFixture(p: Platform, opts: { workspace_id: string; curator: string; agent: string; fixture: Fixture }): LoadResult {
  const { workspace_id, curator, agent, fixture } = opts;
  const k = p.k;
  const ws = k.db.get("select root_context_rev from workspaces where id = ?", workspace_id)!;
  if (!k.isMember(workspace_id, agent)) p.call("addMember", curator, { workspace_id, agent_id: agent, roles: ["reader"], reason: "transcription agent submits candidates" });
  for (const c of fixture.contracts ?? []) {
    if (!k.db.get("select 1 from contracts where id = ? and version = ?", c.id, c.version))
      p.call("registerContract", curator, { workspace_id, ...c });
  }
  const items = fixture.items.flatMap((i) => [i, ...profileAssessments(i)]);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const deps = new Map<string, Set<string>>();
  for (const i of items) {
    const s = new Set<string>();
    keysIn(i.payload, s);
    for (const r of i.references ?? []) s.add(r.key);
    for (const r of i.sources ?? []) s.add(r.key);
    if (i.context && i.context !== "ROOT") s.add(i.context);
    s.delete(i.key);
    for (const d of s) if (!byKey.has(d)) throw new Error(`Fixture item ${i.key} references unknown key ${d}`);
    deps.set(i.key, s);
  }
  // Topological order (Kahn).
  const order: FixItem[] = [];
  const done = new Set<string>();
  while (order.length < items.length) {
    const ready = items.filter((i) => !done.has(i.key) && [...deps.get(i.key)!].every((d) => done.has(d)));
    if (!ready.length) throw new Error(`Fixture has a reference cycle among: ${items.filter((i) => !done.has(i.key)).map((i) => i.key).join(", ")}`);
    for (const r of ready) {
      order.push(r);
      done.add(r.key);
    }
  }

  const candidate = new Map<string, string>([["ROOT", ws.root_context_rev]]);
  const candEntity = new Map<string, string>();
  for (const i of order) {
    const content: any = {
      kind: i.kind,
      title: i.title,
      facets: i.facets ?? [i.kind],
      context: i.kind === "context" && i.payload.root ? { self: true } : resolve({ key: i.context ?? "ROOT" }, candidate),
      payload: resolve(i.payload, candidate),
      references: (i.references ?? []).map((r) => ({ ...r, ref: resolve({ key: r.key }, candidate), key: undefined })),
      representations: i.representations ?? [],
      provenance: {
        origin: "ai",
        acquisition: i.label === "synthetic_product_fixture" ? "authorship" : "extraction",
        sources: (i.sources ?? []).map((s) => ({ source: resolve({ key: s.key }, candidate), locator: s.locator })),
        original_attribution:
          i.attribution ??
          (i.label === "synthetic_product_fixture"
            ? "Handoff product scenario (synthetic, not literature)"
            : i.kind === "source"
              ? `Bibliographic record: ${i.payload.citation}`
              : "Platform concept handoff, §29–30 (transcription)"),
        dates: { discovery_claimed_at: i.dates?.discovery_claimed_at ?? "unknown", source_published_at: i.dates?.source_published_at ?? "unknown", communicated_at: i.dates?.communicated_at },
        ai_run: { model: "unknown", provider: "unknown", version: "unknown", config: "Handoff conceptual transcription (manual, row by row), 1 Oct 2026" },
        notes: i.label === "synthetic_product_fixture" ? "synthetic_product_fixture: product test scenario, not mathematical history" : "Conceptual transcription; not an automated extraction or a re-verification.",
      },
      contributions: i.label === "synthetic_product_fixture" ? [] : [{ descriptor: i.attribution ?? "source authors", roles: i.kind === "argument" ? ["proof"] : ["statement"], scope: "original content", character: "acknowledged" }],
      fixture_label: i.label ?? "literature_transcription",
    };
    for (const r of content.references) delete r.key;
    const res = p.call("submitCandidate", agent, { workspace_id, kind: i.kind, title: i.title, content, proposed_kind: i.kind });
    candidate.set(i.key, res.rev);
    candEntity.set(i.key, res.entity_id);
    k.db.run("update entities set fixture_label = ? where id = ?", i.label ?? "literature_transcription", res.entity_id);
  }

  const toPromote = order.filter((i) => !i.candidate_only).map((i) => candidate.get(i.key)!);
  const batch = p.call("promoteBatch", curator, {
    candidate_revs: toPromote,
    scope: `Fixture '${fixture.name}': faithful transcription (paraphrase) of cited sources; mathematical content not re-verified; logical status remains attributed to sources.`,
    decision: "admit as curated transcription",
  });
  const curated = new Map<string, string>([["ROOT", ws.root_context_rev]]);
  const byCandidate = new Map(batch.promoted.map((x: any) => [x.candidate_rev, x.curated_rev]));
  for (const [key, rev] of candidate) if (byCandidate.has(rev)) curated.set(key, byCandidate.get(rev) as string);
  const rev = (key: string) => curated.get(key) ?? candidate.get(key) ?? (() => { throw new Error(`unknown fixture key ${key}`); })();
  const entity = (key: string) => k.revRow(rev(key))!.entity_id;

  for (const op of fixture.post ?? []) {
    switch (op.op) {
      case "validity":
        p.call("recordValidity", curator, { rev: rev(op.subject), action: op.action, scope: op.scope, reason: op.reason, by_rev: op.by ? rev(op.by) : undefined });
        break;
      case "gate":
        p.call("gateTransition", curator, { entity_id: candEntity.get(op.subject)!, to: op.to, reason: op.reason });
        break;
      case "work_state":
        p.call("transitionWork", curator, { entity_id: entity(op.subject), to: op.to, reason: op.reason, evidence: (op.evidence ?? []).map(rev) });
        break;
      case "preferred":
        p.call("selectPreferred", curator, { rev: rev(op.subject), scope: op.scope });
        break;
      case "revise": {
        const d = p.call("draftFromRevision", curator, { revs: [rev(op.of)], intent: "fixture revision" });
        const draft = p.call("draft", curator, { draft_id: d.draft_id });
        const content = { ...draft.content, title: op.title ?? draft.content.title, payload: { ...draft.content.payload, ...resolve(op.payload, curated) }, change_summary: op.change_summary };
        p.call("saveDraft", curator, { draft_id: d.draft_id, content, generation: draft.generation });
        const sealed = p.call("seal", curator, { drafts: [d.draft_id] });
        const newRev = sealed.revisions[0];
        curated.set(op.key, newRev);
        const ctx = { rev: k.revRow(newRev)!.context_rev };
        if (op.corrects)
          p.call("createAndSeal", curator, {
            workspace_id,
            kind: "relation",
            title: `${op.key} corrects ${op.of}`,
            content: {
              context: ctx,
              payload: { contract: { id: "corrects", version: "core@1" }, slots: [{ slot: "new", role: "new", ref: { rev: newRev } }, { slot: "old", role: "old", ref: { rev: rev(op.of) } }], modality: "editorial", interpretation: op.change_summary, scope: op.corrects.scope, fields: { defect_locator: op.corrects.defect_locator } },
              provenance: { origin: "human", acquisition: "authorship" },
            },
          });
        if (op.comparison)
          p.call("createAndSeal", curator, {
            workspace_id,
            kind: "evaluation",
            title: `Comparison ${op.of} → ${op.key}`,
            content: {
              context: ctx,
              payload: { eval_kind: "comparison", subject: { rev: newRev }, scope: op.comparison.scope, comparison: { old: { rev: rev(op.of) }, new: { rev: newRev }, context_mapping: "same context", changes: op.comparison.changes, verdict: op.comparison.verdict } },
              provenance: { origin: "human", acquisition: "authorship" },
            },
          });
        if (op.corrects) p.call("recordValidity", curator, { rev: rev(op.of), action: "corrected", scope: op.corrects.scope, reason: op.change_summary, by_rev: newRev });
        break;
      }
    }
  }
  return { candidate, curated, rev, entity };
}
