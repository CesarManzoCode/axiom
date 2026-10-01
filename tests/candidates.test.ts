// Candidate/curated boundary (§21, §34H; AC26–AC29).
import { describe, expect, it } from "vitest";
import { codeOf, makeWorld } from "./helpers.ts";

function submit(w: ReturnType<typeof makeWorld>, actor: string, kind: string, title: string, payload: any, extra: any = {}) {
  return w.call(actor, "submitCandidate", {
    workspace_id: w.ws,
    kind,
    title,
    content: { context: { rev: w.root }, payload, provenance: { origin: "ai", acquisition: "authorship", ai_run: { model: "test-model", provider: "test", version: "1" }, ...extra.provenance } },
  });
}

describe("candidate boundary", () => {
  it("AC26: an AI candidate statement/proof/relation stays out of curated answers, support and impact by default", () => {
    const w = makeWorld();
    const x = w.decl(w.ana, "X", "x holds");
    const cs = submit(w, w.ai, "declaration", "AI lemma", { category: "propositional", statement: "AI lemma statement" });
    const cp = submit(w, w.ai, "argument", "AI proof of X", { targets: [{ rev: x.rev }], argument_kind: "natural_language_proof", completeness: "complete", steps: [{ id: "s1", text: "by the AI lemma", uses: [{ rev: cs.rev }] }] });
    const cr = submit(w, w.ai, "relation", "AI: lemma supports X", { contract: { id: "supports", version: "core@1" }, slots: [{ slot: "e", role: "evidence", ref: { rev: cs.rev } }, { slot: "t", role: "target", ref: { rev: x.rev } }], modality: "heuristic", interpretation: "suggested" });
    expect(w.call(w.ana, "support", { rev: x.rev }).entries).toHaveLength(0);
    expect(w.call(w.ana, "support", { rev: x.rev, include_candidates: true }).entries.map((e: any) => e.rev).sort()).toEqual([cp.rev, cr.rev].sort());
    expect(w.call(w.ana, "search", { text: "AI lemma", workspace_id: w.ws }).results).toHaveLength(0);
    expect(w.call(w.ana, "usedBy", { rev: x.rev }).total).toBe(0);
    const imp = w.call(w.ana, "impact", { rev: cs.rev, change: "refuted" });
    expect(imp.definitely_affected.length + imp.possibly_affected.length).toBe(0);
    // Curated content cannot adopt a candidate as a premise.
    expect(codeOf(() => w.arg(w.ana, "uses candidate", [x.rev], { uses: [cs.rev] }))).toBe("gate_missing");
    // A curated review may target a candidate without promoting it.
    w.review(w.rita, cp.rev, [{ dimension: "correctness", value: "undetermined", text: "lemma unverified" }]);
    expect(w.call(w.rita, "candidateQueue", { workspace_id: w.ws }).find((c: any) => c.rev === cp.rev).gate.state).toBe("proposed");
  });

  it("AC27: an agent cannot gate (or self-promote); an authorized human decides scope and origin is preserved", () => {
    const w = makeWorld();
    const c = submit(w, w.ai, "declaration", "Candidate thm", { category: "propositional", statement: "every foo is bar" });
    expect(codeOf(() => w.call(w.ai, "promote", { candidate_rev: c.rev, scope: "x", decision: "self" }))).toBe("gate_missing");
    expect(codeOf(() => w.call(w.ai, "gateTransition", { entity_id: c.entity_id, to: "under_review", reason: "" }))).toBe("gate_missing");
    // A human candidate producer cannot gate their own candidate either.
    const own = submit(w, w.ben, "declaration", "Ben's candidate", { category: "propositional", statement: "b" }, { provenance: { origin: "human", original_attribution: "Ben" } });
    expect(codeOf(() => w.call(w.ben, "promote", { candidate_rev: own.rev, scope: "x", decision: "self" }))).toBe("insufficient_permission");
    // Readers cannot gate.
    expect(codeOf(() => w.call(w.carl, "promote", { candidate_rev: c.rev, scope: "x", decision: "y" }))).toBe("not_found");
    const r = w.call(w.ana, "promote", { candidate_rev: c.rev, scope: "useful relation; proof claimed by its author", decision: "admit" });
    const cur = w.call(w.ana, "revision", { rev: r.curated_rev });
    expect(cur.namespace).toBe("curated");
    expect(cur.content.provenance.origin).toBe("ai");
    expect(cur.content.provenance.ai_run.model).toBe("test-model");
    expect(cur.content.provenance.derived_from_candidate.rev).toBe(c.rev);
    const gate = w.call(w.ana, "candidateQueue", { workspace_id: w.ws }).find((x: any) => x.rev === c.rev).gate;
    expect(gate.state).toBe("promoted");
    const decision = gate.history.find((h: any) => h.action === "promoted");
    expect(decision.scope).toMatch(/useful relation/);
    // Ana operates the agent: the record says so honestly.
    expect(decision.independence).toMatch(/operator/);
    // Promotion is not truth.
    expect(w.call(w.ana, "status", { rev: r.curated_rev }).dimensions.logical.summary).toBe("not_evaluated");
    // Q10: AI-generated content is listed with its candidate map.
    expect(w.call(w.ana, "aiGenerated", { workspace_id: w.ws }).some((x: any) => x.rev === r.curated_rev && x.derived_from_candidate)).toBe(true);
  });

  it("AC28: accepting only a fragment creates a new object with a mapping; the rest is not marked approved", () => {
    const w = makeWorld();
    const c = submit(w, w.ai, "declaration", "Two claims", { category: "propositional", statement: "Claim one holds. Claim two holds." });
    const r = w.call(w.rita, "promote", {
      candidate_rev: c.rev,
      scope: "first sentence is a faithful extraction",
      decision: "partial admission",
      fragment: { locator: "sentence 1", content: { title: "Claim one", payload: { category: "propositional", statement: "Claim one holds." } } },
    });
    const cur = w.call(w.ana, "revision", { rev: r.curated_rev });
    expect(cur.content.payload.statement).toBe("Claim one holds.");
    expect(cur.content.provenance.derived_from_candidate).toMatchObject({ rev: c.rev, mapping: "fragment", locator: "sentence 1" });
    expect(cur.content.provenance.origin).toBe("human_ai");
    const q = w.call(w.rita, "candidateQueue", { workspace_id: w.ws }).find((x: any) => x.rev === c.rev);
    expect(q.gate.state).toBe("under_review");
    expect(q.gate.history.some((h: any) => h.action === "fragment_promoted")).toBe(true);
  });

  it("AC29: a human source imported with AI extraction distinguishes original author, importer and agent; no discovery credit to the importer", () => {
    const w = makeWorld();
    const src = w.call(w.ana, "createAndSeal", {
      workspace_id: w.ws,
      kind: "source",
      title: "Cook 1971",
      content: { context: { rev: w.root }, payload: { source_kind: "paper", citation: "S. Cook, The Complexity of Theorem-Proving Procedures, STOC 1971", rights: { status: "unknown" }, availability: "available", revision_identity: { status: "exact", value: "STOC 1971 pp.151–158" } }, provenance: { origin: "human", acquisition: "import", original_attribution: "bibliographic record" } },
    });
    const c = w.call(w.ai, "submitCandidate", {
      workspace_id: w.ws,
      kind: "declaration",
      title: "Cook's Theorem 1",
      content: { context: { rev: w.root }, payload: { category: "propositional", statement: "Every NP language is poly-time query-reducible to tautologies" }, provenance: { origin: "ai", acquisition: "extraction", sources: [{ source: { rev: src.rev }, locator: "Theorem 1" }], original_attribution: "Stephen Cook", dates: { discovery_claimed_at: "unknown" } }, contributions: [{ descriptor: "Stephen Cook", roles: ["discovery", "statement", "proof"], character: "acknowledged" }] },
    });
    const r = w.call(w.ben === "" ? w.ana : w.rita, "promote", { candidate_rev: c.rev, scope: "faithful extraction", decision: "admit" });
    const credit = w.call(w.ana, "contributions", { entity_id: w.call(w.ana, "revision", { rev: r.curated_rev }).entity_id });
    const roles = credit.contributions.filter((x: any) => x.roles?.length);
    expect(roles.find((x: any) => x.descriptor === "Stephen Cook").roles).toContain("discovery");
    const rita = roles.find((x: any) => x.agent?.name === "Rita");
    expect(rita.roles).toEqual(["curation"]);
    expect(roles.some((x: any) => x.agent?.name === "Agent" && x.roles.includes("discovery"))).toBe(false);
    const seal = credit.contributions.find((x: any) => x.activity === "seal");
    expect(seal.original_attribution).toBe("Stephen Cook");
    expect(seal.origin).toBe("ai");
    const rev = w.call(w.ana, "revision", { rev: r.curated_rev });
    expect(rev.content.provenance.dates.discovery_claimed_at).toBe("unknown"); // never filled with import date
    expect(rev.sealed_by.name).toBe("Rita");
  });

  it("quarantine and rejection keep reasons and can return to review by a reasoned event", () => {
    const w = makeWorld();
    const c = submit(w, w.ai, "declaration", "Sludge", { category: "propositional", statement: "spam" });
    expect(codeOf(() => w.call(w.rita, "gateTransition", { entity_id: c.entity_id, to: "quarantined", reason: "" }))).toBe("invalid_input");
    w.call(w.rita, "gateTransition", { entity_id: c.entity_id, to: "quarantined", reason: "unsourced" });
    expect(codeOf(() => w.call(w.rita, "promote", { candidate_rev: c.rev, scope: "x", decision: "y" }))).toBe("invalid_transition");
    w.call(w.rita, "gateTransition", { entity_id: c.entity_id, to: "under_review", reason: "source supplied" });
    w.call(w.rita, "gateTransition", { entity_id: c.entity_id, to: "rejected", reason: "still unsupported" });
    const h = w.call(w.rita, "candidateQueue", { workspace_id: w.ws }).find((x: any) => x.rev === c.rev).gate.history;
    expect(h.map((x: any) => x.to)).toEqual(["proposed", "quarantined", "under_review", "rejected"]);
  });
});
