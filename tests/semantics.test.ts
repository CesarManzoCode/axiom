// Epistemic semantics over the §29 corpus: support sets, critiques, equivalence, n-ary
// relations, typed dependencies, impact, barriers, plans, failures, policies
// (AC03–08, 10, 13–20, 51–54, 56 and the twenty mandatory cases of §29).
import { beforeAll, describe, expect, it } from "vitest";
import { codeOf, makeWorld, type World } from "./helpers.ts";

let w: World;
const R = (k: string) => w.fx!.rev(k);
const E = (k: string) => w.fx!.entity(k);

beforeAll(() => {
  w = makeWorld({ fixture: "pvnp" });
});

describe("§29 corpus loads through the candidate gate", () => {
  it("every literature row is curated, attributed to its source, and keeps its AI transcription origin", () => {
    const p30 = w.call(w.ana, "revision", { rev: R("P30") });
    expect(p30.namespace).toBe("curated");
    expect(p30.content.provenance.origin).toBe("ai");
    expect(p30.content.provenance.derived_from_candidate.mapping).toBe("whole");
    expect(p30.content.provenance.original_attribution).toMatch(/Furst|Håstad|Hastad/);
    const st = w.call(w.ana, "status", { rev: R("P30") });
    expect(st.dimensions.logical.summary).toBe("supported_derivation");
    expect(st.dimensions.logical.attributed_to[0]).toMatch(/via M0/);
    // Synthetic scenarios stay labelled.
    expect(w.call(w.ana, "revision", { rev: R("FA01") }).fixture_label).toBe("synthetic_product_fixture");
  });
});

describe("support, critique and refutation", () => {
  it("case 5 / AC03: P30 has two alternative arguments; invalidating one keeps the other and never makes P30 false", () => {
    w.review(w.rita, R("P31"), [{ dimension: "correctness", value: "supported_in_scope" }]);
    w.review(w.rita, R("P32"), [{ dimension: "correctness", value: "supported_in_scope" }]);
    let sup = w.call(w.ana, "support", { rev: R("P30") });
    expect(sup.entries.filter((e: any) => e.via === "argument").map((e: any) => e.rev).sort()).toEqual([R("P31"), R("P32")].sort());
    w.review(w.ben, R("P32"), [{ dimension: "correctness", value: "defect_found", locator: "switching lemma step", text: "hypothetical defect (not historical)" }]);
    // Ben disagrees with Rita: contested, not silently resolved.
    sup = w.call(w.ana, "support", { rev: R("P30") });
    expect(sup.entries.find((e: any) => e.rev === R("P32")).status).toBe("contested");
    w.call(w.rita, "recordValidity", { rev: R("P32"), action: "retracted", scope: "hypothetical error scenario (not historical)", reason: "test scenario" });
    sup = w.call(w.ana, "support", { rev: R("P30") });
    expect(sup.entries.find((e: any) => e.rev === R("P32")).status).toBe("defective");
    expect(sup.entries.find((e: any) => e.rev === R("P31")).status).toBe("accepted");
    expect(sup.summary).toBe("accepted_support_known");
    const st = w.call(w.ana, "status", { rev: R("P30") });
    expect(st.dimensions.logical.summary).not.toBe("refuted");
    // Propagation (§29 manual run 1): RP01 loses evidence, P29 asks re-evaluation, P30 keeps P31.
    const imp = w.call(w.ana, "impact", { rev: R("P32"), change: "retracted" });
    const def = imp.definitely_affected.map((r: any) => `${r.target.rev}|${r.dimension}`);
    expect(def).toContain(`${R("RP01")}|evidence`);
    expect(def).toContain(`${R("P30")}|support set`);
    expect(def).toContain(`${R("P29")}|support set`);
    expect(imp.evaluated_unaffected.some((r: any) => r.target.rev === R("P30") && /P31/.test(r.reason))).toBe(true);
    const p29 = imp.definitely_affected.find((r: any) => r.target.rev === R("P29"));
    expect(p29.reason).toMatch(/not a refutation|Not refuted/i);
    for (const rec of [...imp.definitely_affected, ...imp.possibly_affected]) {
      expect(rec.route.length).toBeGreaterThan(0);
      expect(rec.reason).toBeTruthy();
      expect(rec.reason).not.toMatch(/\bis false\b/);
    }
    // Citation to M05 only yields a source alert, never logical propagation.
    w.call(w.rita, "recordValidity", { rev: R("P32"), action: "restored", restores: "retracted", scope: "end of scenario", reason: "restore" });
  });

  it("case 6 / AC04: FA01's invalid step is critiqued on the proof; P≠NP is not refuted and no refutation of it is created", () => {
    const rv = w.call(w.ana, "revision", { rev: R("RV01") });
    expect(rv.content.payload.subject.rev).toBe(R("FA01"));
    expect(rv.content.payload.findings.find((f: any) => f.dimension === "correctness").locator).toMatch(/s3/);
    const sup = w.call(w.ana, "support", { rev: R("S_P_NEQ_NP") });
    expect(sup.counter_evidence).toHaveLength(0);
    expect(sup.entries.find((e: any) => e.rev === R("FA01")).status).toBe("defective");
    expect(["no_accepted_support_known", "claimed_support_not_accepted"]).toContain(sup.summary);
    const st = w.call(w.ana, "status", { rev: R("S_P_NEQ_NP") });
    expect(st.dimensions.logical.summary).not.toBe("refuted");
    // The refutation CE01 targets the inference step of FA01, not the statement.
    const ce = w.call(w.ana, "revision", { rev: R("R_CE01_REFUTES_STEP") });
    expect(ce.content.payload.slots.find((s: any) => s.role === "target").ref.rev).toBe(R("FA01"));
    expect(ce.content.payload.fields.negated).toMatch(/step/i);
    // O01 stays open.
    expect(w.call(w.ana, "entity", { entity_id: E("O01") }).work.state).not.toBe("completed");
  });

  it("case 7 / AC20: a failed attempt bounds its conclusion; finite searches must state their range; no impossibility is derived", () => {
    const fl = w.call(w.ana, "failedAttempts", { entity_id: E("O02") });
    const f = fl.find((x: any) => x.rev === R("FL01"));
    expect(f.failure.non_conclusions).toEqual(expect.arrayContaining(["SAT ∈ P"]));
    expect(f.failure.allowed_negative_conclusion).toMatch(/lower bound/);
    const base = {
      role: "attempt",
      goal: "search for a small witness",
      target: { rev: R("O03") },
      attempt: {
        strategy: "exhaustive search",
        result: "failed",
        artifacts: [],
        artifacts_missing_reason: "scratch computation",
        failure: { kind: "finite_search_no_hit", defect_locator: "n ≤ 12", observed: "no object found", allowed_negative_conclusion: "No object with parameters p up to N=12", non_conclusions: ["the object does not exist", "no variant of this technique works", "the problem is independent"], barrier_applicability: { status: "not_evaluated" }, successors: "none_recorded", evaluator: "Ana", evaluated_at: "2026-10-01" },
      },
    };
    const mk = (payload: any) => w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "research", title: "finite search", content: { context: { rev: R("C0") }, payload, provenance: { origin: "human", acquisition: "computation", original_attribution: "Ana" } } });
    expect(codeOf(() => mk(base))).toBe("contract_violation"); // range missing
    const ok = mk({ ...base, attempt: { ...base.attempt, failure: { ...base.attempt.failure, range: "all candidates up to N = 12 with parameters p" } } });
    expect(ok.rev).toBeTruthy();
    const missing = mk.length; // eslint-friendly no-op
    void missing;
    expect(codeOf(() => mk({ ...base, attempt: { ...base.attempt, failure: { ...base.attempt.failure, range: "x", non_conclusions: [] } } }))).toBe("contract_violation");
    // No impossibility statement appears: O03's target support/counter-evidence is unchanged.
    expect(w.call(w.ana, "support", { rev: R("S_SAT_NOT_IN_PPOLY") }).counter_evidence).toHaveLength(0);
  });

  it("AC10: opposite reviews of one revision both stay visible; a curator preference names curator and policy", () => {
    const a = w.review(w.ben, R("P58"), [{ dimension: "correctness", value: "supported_in_scope" }]);
    w.review(w.ana, R("P58"), [{ dimension: "correctness", value: "defect_found", locator: "step 2" }]);
    let st = w.call(w.carl === "" ? w.ana : w.ana, "status", { rev: R("P58") });
    const corr = st.findings.find((f: any) => f.dimension === "correctness");
    expect(corr.summary).toBe("conflicting");
    expect(corr.positions).toHaveLength(2);
    expect(st.dimensions.review.conflicting).toBe(true);
    w.call(w.rita, "selectAssessment", { subject_rev: R("P58"), dimension: "correctness", assessment_rev: a.rev, reason: "argument checked against source" });
    st = w.call(w.ana, "status", { rev: R("P58") });
    const c2 = st.findings.find((f: any) => f.dimension === "correctness");
    expect(c2.summary).toBe("supported_in_scope");
    expect(c2.selection.curator).toBe("Rita");
    expect(c2.conflicting).toBe(true);
    expect(c2.positions).toHaveLength(2);
    expect(st.policy.key).toBe("workspace_curator_selection@1");
    // A selection by a non-curator is refused.
    expect(codeOf(() => w.call(w.ben, "selectAssessment", { subject_rev: R("P58"), dimension: "correctness", assessment_rev: a.rev, reason: "x" }))).toBe("insufficient_permission");
  });

  it("AC52: switching assessment policy changes the summary without mutating evidence", () => {
    const sel = w.call(w.ana, "status", { rev: R("P58"), policy: "workspace_curator_selection@1" });
    const pos = w.call(w.ana, "status", { rev: R("P58"), policy: "attributed_positions@1" });
    expect(sel.findings.find((f: any) => f.dimension === "correctness").summary).toBe("supported_in_scope");
    expect(pos.findings.find((f: any) => f.dimension === "correctness").summary).toBe("see_positions");
    expect(pos.findings.find((f: any) => f.dimension === "correctness").positions).toHaveLength(2);
    expect(pos.policy.key).toBe("attributed_positions@1");
    expect(sel.dimensions.evidence.summary).toBe(pos.dimensions.evidence.summary);
  });

  it("AC56: a fresh statement shows explicit unknown values per axis, never a badge or false", () => {
    const d = w.decl(w.ana, "Fresh", "Every widget is a gadget");
    const st = w.call(w.ana, "status", { rev: d.rev });
    expect(Object.keys(st.dimensions)).toHaveLength(10);
    expect(st.dimensions.logical.summary).toBe("not_evaluated");
    expect(st.dimensions.fidelity.summary).toBe("not_evaluated");
    expect(st.dimensions.reproducibility.summary).toBe("not_evaluated");
    expect(st.dimensions.novelty.summary).toBe("not_searched");
    expect(st.dimensions.logical.mode).toBe("default");
    expect(JSON.stringify(st)).not.toMatch(/verified/);
  });
});

describe("relations as entities", () => {
  it("case 3/11: equivalence is a relation entity; P06 and P07 keep their own anchors", () => {
    const eq = w.call(w.ana, "equivalences", { rev: R("P06") });
    expect(eq.claims.some((c: any) => c.rev === R("P08") && c.contract.id === "equivalent_under")).toBe(true);
    expect(E("P06")).not.toBe(E("P07"));
    expect(w.call(w.ana, "support", { rev: R("P08") }).entries.some((e: any) => e.rev === R("P09"))).toBe(true);
  });

  it("AC05: same expression and high similarity never fuse identities without an overlay decision", () => {
    const a = w.decl(w.ana, "Twin A", "Every finite group of prime order is cyclic");
    const b = w.decl(w.ben, "Twin B", "Every finite group of prime order is cyclic");
    const eq = w.call(w.ana, "equivalences", { rev: a.rev });
    const cand = eq.lexical_candidates.find((c: any) => c.rev === b.rev);
    expect(cand.same_expression).toBe(true);
    expect(w.call(w.ana, "identityRecords", { entity_id: a.entity_id })).toHaveLength(0);
    const { overlay } = w.call(w.rita, "decideAlias", { workspace_id: w.ws, entities: [a.entity_id, b.entity_id], reason: "duplicate records of the same textbook statement" });
    const recs = w.call(w.ana, "identityRecords", { entity_id: b.entity_id });
    expect(recs[0].active).toBe(true);
    expect(w.call(w.ana, "revision", { rev: b.rev }).entity_id).toBe(b.entity_id); // IDs still resolve to their own content
    w.call(w.rita, "reverseAlias", { workspace_id: w.ws, overlay, reason: "different intended contexts" });
    expect(w.call(w.ana, "identityRecords", { entity_id: b.entity_id }).find((r: any) => r.action === "alias").active).toBe(false);
  });

  it("AC06: equivalent_under with proof under H is citable with H visible; without H no unconditional equivalence answers", () => {
    const a = w.decl(w.ana, "A(n)", "A(n) holds");
    const b = w.decl(w.ana, "B(n)", "B(n) holds");
    const eqv = w.rel(w.ana, "A ⇔ B under H", "equivalent_under", [["a", "side", a.rev], ["b", "side", b.rev]], { hypotheses: [{ id: "H", text: "n is odd" }] });
    const pr = w.arg(w.ana, "Proof of A ⇔ B under H", [eqv.rev]);
    w.review(w.rita, pr.rev, [{ dimension: "correctness", value: "supported_in_scope" }]);
    const eq = w.call(w.ana, "equivalences", { rev: a.rev });
    expect(eq.claims).toHaveLength(1);
    expect(eq.claims[0].conditions.map((h: any) => h.text)).toEqual(["n is odd"]);
    expect(eq.claims[0].note).toMatch(/only under/);
    expect(w.call(w.ana, "support", { rev: eqv.rev }).summary).toBe("accepted_support_known");
  });

  it("case 9 / AC07: P20 keeps an AND-grouped premise structure with roles; FN01 lists its exact premises and rules", () => {
    const p20 = w.call(w.ana, "revision", { rev: R("P20") });
    const premises = p20.content.payload.slots.filter((s: any) => s.role === "premise");
    expect(premises.length).toBeGreaterThanOrEqual(3);
    expect(p20.content.payload.grouping.premise.op).toBe("AND");
    expect(p20.content.payload.grouping.premise.items.sort()).toEqual(premises.map((s: any) => s.slot).sort());
    expect(p20.content.payload.slots.some((s: any) => s.role === "conclusion")).toBe(true);
    const used = w.call(w.ana, "usedBy", { rev: R("S_L_NPC") });
    expect(used.by_kind.relation_participant.some((e: any) => e.rev === R("P20") && e.role === "premise")).toBe(true);
    const deps = w.call(w.ana, "dependsOn", { rev: R("P20") });
    const fn = deps.alternative_support_sets.find((a: any) => a.argument.rev === R("FN01"));
    expect(fn.dependency_sets[0].members).toHaveLength(4);
    expect(fn.dependency_sets[0].rules).toEqual(expect.arrayContaining(["∀intro"]));
    expect(fn.dependency_sets[0].completeness).toBe("exact_for_this_derivation");
    // A multi-premise entailment without grouping is refused (no flattening into binary arrows).
    expect(codeOf(() => w.rel(w.ana, "flat", "entails", [["p1", "premise", R("S_L_NPC")], ["p2", "premise", R("S_L_IN_P")], ["c", "conclusion", R("S_P_EQ_NP")]], { context: R("C0") }))).toBe("contract_violation");
  });

  it("case 10 / AC08: relations about relations are first-class and traversable", () => {
    const rr = w.call(w.ana, "revision", { rev: R("RR01") });
    expect(rr.content.payload.slots.find((s: any) => s.role === "target").ref.rev).toBe(R("R_FA01_PROVES"));
    const rv = w.review(w.rita, R("RR01"), [{ dimension: "correctness", value: "supported_in_scope" }]);
    const used = w.call(w.ana, "usedBy", { rev: R("R_FA01_PROVES") });
    expect(Object.values(used.by_kind).flat().some((e: any) => e.rev === R("RR01") && e.role === "target")).toBe(true);
    expect(w.call(w.ana, "usedBy", { rev: R("RR01") }).total).toBeGreaterThan(0);
    expect(w.call(w.ana, "revision", { rev: rv.rev }).content.payload.subject.rev).toBe(R("RR01"));
    const p73 = w.call(w.ana, "revision", { rev: R("P73") });
    expect(p73.content.payload.slots.find((s: any) => s.role === "target").ref.rev).toBe(R("P72"));
    expect(w.call(w.ana, "revision", { rev: R("R_FA01_PROVES") }).content_hash).toBeTruthy(); // target unchanged
  });

  it("AC54: unknown contracts are refused; extension contracts keep their version and carry no inference", () => {
    expect(codeOf(() => w.rel(w.ana, "x", "blocks", [["a", "x", R("P71")]]))).toBe("contract_violation");
    expect(w.call(w.ana, "revision", { rev: R("P73") }).content.payload.contract).toEqual({ id: "limits_scope", version: "fixture-1" });
    w.call(w.rita, "registerContract", { workspace_id: w.ws, id: "limits_scope", version: "fixture-2", roles: [{ role: "limit", card: { min: 1, max: null } }, { role: "target", card: { min: 1, max: 1 } }], description: "v2" });
    expect(w.call(w.ana, "revision", { rev: R("P73") }).content.payload.contract.version).toBe("fixture-1");
    expect(codeOf(() => w.call(w.rita, "registerContract", { workspace_id: w.ws, id: "limits_scope", version: "fixture-2", roles: [{ role: "x", card: { min: 1, max: null } }], description: "changed" }))).toBe("invalid_transition");
    const imp = w.call(w.ana, "impact", { rev: R("P69"), change: "refuted" });
    expect([...imp.definitely_affected, ...imp.possibly_affected].some((r: any) => r.target.rev === R("P72"))).toBe(false);
  });
});

describe("typed dependencies and impact", () => {
  it("AC13: formal, explicit informal, inferred, citation and influence are queried separately; inferred never formal", () => {
    const z = w.decl(w.ana, "Z", "z");
    const f = w.decl(w.ana, "F", "f");
    const i = w.decl(w.ana, "I", "i");
    const c = w.decl(w.ana, "C", "c");
    const m = w.decl(w.ana, "M", "m");
    const x = w.call(w.ana, "createAndSeal", {
      workspace_id: w.ws,
      kind: "declaration",
      title: "Consumer",
      content: {
        context: { rev: w.root },
        payload: { category: "propositional", statement: "consumer" },
        references: [
          { ref: { rev: f.rev }, purpose: "formal", origin: "formal" },
          { ref: { rev: z.rev }, purpose: "explicit_informal" },
          { ref: { rev: i.rev }, purpose: "inferred", origin: "inferred", inference: { method: "lexical proximity", reason: "shared notation" }, accepted: true },
          { ref: { rev: c.rev }, purpose: "citation" },
          { ref: { rev: m.rev }, purpose: "conceptual_influence" },
        ],
        provenance: { origin: "human", acquisition: "authorship" },
      },
    });
    const deps = w.call(w.ana, "dependsOn", { rev: x.rev }).by_kind;
    expect(deps.formal.map((e: any) => e.rev)).toEqual([f.rev]);
    expect(deps.explicit_informal.map((e: any) => e.rev)).toEqual([z.rev]);
    expect(deps.inferred.map((e: any) => e.rev)).toEqual([i.rev]);
    expect(deps.citation.map((e: any) => e.rev)).toEqual([c.rev]);
    expect(deps.conceptual_influence.map((e: any) => e.rev)).toEqual([m.rev]);
    expect(deps.formal.some((e: any) => e.rev === i.rev)).toBe(false);
    // Impact through an inferred dependency is possible only.
    const imp = w.call(w.ana, "impact", { rev: i.rev, change: "refuted" });
    expect(imp.definitely_affected.some((r: any) => r.target.rev === x.rev)).toBe(false);
    expect(imp.possibly_affected.find((r: any) => r.target.rev === x.rev).rule).toBe("R-INFERRED");
  });

  it("AC14: retracting an input of proof A affects A's derivation and X's support set, while proof B keeps X standing", () => {
    const x = w.decl(w.ana, "X", "x is true");
    const l = w.decl(w.ana, "L", "lemma L");
    const mm = w.decl(w.ana, "M2", "lemma M");
    const a = w.arg(w.ana, "Proof A of X", [x.rev], { uses: [l.rev] });
    const b = w.arg(w.ana, "Proof B of X", [x.rev], { uses: [mm.rev] });
    w.review(w.rita, a.rev, [{ dimension: "correctness", value: "supported_in_scope" }]);
    w.review(w.rita, b.rev, [{ dimension: "correctness", value: "supported_in_scope" }]);
    const user = w.arg(w.ben, "Uses X", [w.decl(w.ben, "Y", "y").rev], { uses: [x.rev] });
    const imp = w.call(w.ana, "impact", { rev: l.rev, change: "retracted" });
    const def = imp.definitely_affected;
    expect(def.find((r: any) => r.target.rev === a.rev).dimension).toBe("derivation");
    expect(def.find((r: any) => r.target.rev === x.rev).dimension).toBe("support set");
    expect(def.some((r: any) => r.target.rev === b.rev)).toBe(false);
    expect(imp.evaluated_unaffected.find((r: any) => r.target.rev === x.rev).reason).toMatch(/Proof B/);
    expect([...def, ...imp.possibly_affected].some((r: any) => r.target.rev === user.rev)).toBe(false);
    // Without B, X loses accepted support (not refuted) and its users become possibly affected.
    w.call(w.ana, "recordValidity", { rev: b.rev, action: "retracted", scope: "test", reason: "test" });
    const imp2 = w.call(w.ana, "impact", { rev: l.rev, change: "retracted" });
    expect(imp2.definitely_affected.find((r: any) => r.target.rev === x.rev).reason).toMatch(/not a refutation/);
    expect(imp2.possibly_affected.find((r: any) => r.target.rev === user.rev).dimension).toBe("derivation");
  });

  it("AC15: a mere citation of a refuted item gives a source alert and does not traverse citation chains", () => {
    const z = w.decl(w.ana, "Zr", "z refuted later");
    const mk = (title: string, rev: string) =>
      w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title, content: { context: { rev: w.root }, payload: { category: "propositional", statement: title }, references: [{ ref: { rev }, purpose: "citation" }], provenance: { origin: "human", acquisition: "authorship" } } });
    const c1 = mk("cites Z", z.rev);
    const c2 = mk("cites C1", c1.rev);
    const imp = w.call(w.ana, "impact", { rev: z.rev, change: "refuted" });
    expect(imp.definitely_affected).toHaveLength(0);
    const alert = imp.possibly_affected.find((r: any) => r.target.rev === c1.rev);
    expect(alert.rule).toBe("R-CITE");
    expect(alert.dimension).toMatch(/source alert/);
    expect([...imp.possibly_affected, ...imp.unknown].some((r: any) => r.target.rev === c2.rev)).toBe(false);
  });

  it("AC51: impact over a partially evaluated subgraph shows unknown boundaries and a route + reason for every entry", () => {
    let prev = w.decl(w.ana, "chain-0", "c0").rev;
    const first = prev;
    for (let n = 1; n <= 6; n++) prev = w.arg(w.ana, `chain-${n}`, [w.decl(w.ana, `t${n}`, `t${n}`).rev], { uses: [prev] }).rev;
    const imp = w.call(w.ana, "impact", { rev: first, change: "defect", budget: 2 });
    expect(imp.unknown.length + imp.coverage.stops.length).toBeGreaterThan(0);
    expect(imp.coverage.stops.some((s: any) => /budget/i.test(s.reason))).toBe(true);
    for (const r of [...imp.definitely_affected, ...imp.possibly_affected, ...imp.unknown]) {
      expect(r.route.length).toBeGreaterThan(0);
      expect(r.rule).toMatch(/^R-/);
    }
    expect(imp.coverage.limitations.join(" ")).toMatch(/not a universal/);
  });

  it("AC53: a declared minimum dependency set without certificate is a delimited assertion, never 'necessary for every proof'", () => {
    const t = w.decl(w.ana, "Tm", "tm");
    const h = w.decl(w.ana, "Hm", "hm");
    const a = w.call(w.ana, "createAndSeal", {
      workspace_id: w.ws,
      kind: "argument",
      title: "Argument with claimed minimal set",
      content: { context: { rev: w.root }, payload: { targets: [{ rev: t.rev }], argument_kind: "sketch", completeness: "sketch", dependency_sets: [{ id: "D1", members: [{ rev: h.rev }], scope: "this sketch", minimality: "cardinal_minimum" }] }, provenance: { origin: "human", acquisition: "authorship" } },
    });
    const deps = w.call(w.ana, "dependsOn", { rev: t.rev });
    const set = deps.alternative_support_sets.find((x: any) => x.argument.rev === a.rev).dependency_sets[0];
    expect(set.minimality_note).toMatch(/without certificate/);
    expect(set.minimality_note).toMatch(/this derivation only/);
  });

  it("case 12: an inferred dependency proposal stays a rejected candidate and is absent from curated answers", () => {
    const q = w.call(w.rita, "candidateQueue", { workspace_id: w.ws });
    const inf = q.find((c: any) => c.title.includes("P36") && c.kind === "relation" && c.gate.state === "rejected");
    expect(inf).toBeTruthy();
    expect(Object.values(w.call(w.ana, "usedBy", { rev: R("P33") }).by_kind).flat().some((e: any) => e.rev === inf.rev)).toBe(false);
  });
});

describe("barriers, routes and plans", () => {
  it("cases 1, 2: barriers keep their parameters and block only where applicability was shown", () => {
    const p57 = w.call(w.ana, "revision", { rev: R("P57") }).content.payload.barrier;
    expect(p57.predicate).toBeTruthy();
    expect(JSON.stringify(p57)).toMatch(/2\^\(k\^o\(1\)\)|2\^\(k\^\{o\(1\)\}\)|k\^o\(1\)/);
    expect(w.call(w.ana, "barrierApplicability", { rev: R("P45") }).does_not_apply_to.map((x: any) => x.subject.rev)).toContain(R("P50"));
    expect(w.call(w.ana, "barrierApplicability", { rev: R("P51") }).applies_to.map((x: any) => x.subject.rev)).toContain(R("P50"));
    expect(w.call(w.ana, "barrierApplicability", { rev: R("P57") }).does_not_apply_to.map((x: any) => x.subject.rev)).toContain(R("P59"));
  });

  it("cases 18, 19 / AC17: P71 blocks only the occurrence route; the multiplicity route stays live", () => {
    expect(w.call(w.ana, "routeStatus", { entity_id: E("R_OCC") }).liveness).toBe("blocked_in_evaluated_scope");
    expect(w.call(w.ana, "routeStatus", { entity_id: E("R_MULT") }).liveness).toBe("live_no_applicable_barrier_recorded");
    const plans = w.call(w.ana, "plans", { entity_id: E("O07") });
    expect(plans.plans[0].plan_mode).toBe("OR");
    expect(plans.plans[0].parts.map((p: any) => p.route.liveness).sort()).toEqual(["blocked_in_evaluated_scope", "live_no_applicable_barrier_recorded"]);
    // P71 is not turned into a refutation of the GCT program P64.
    expect(w.call(w.ana, "status", { rev: R("P64") }).dimensions.logical.summary).not.toBe("refuted");
    expect(w.call(w.ana, "status", { rev: R("P70") }).dimensions.logical.summary).toBe("refuted");
  });

  it("AC16: an undetermined barrier applicability makes a route possibly blocked, never definitely", () => {
    const route = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "research", title: "New route", content: { context: { rev: R("C0") }, payload: { role: "approach", goal: "try a counting technique" }, provenance: { origin: "human", acquisition: "authorship" } } });
    w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "evaluation", title: "Does P57 apply?", content: { context: { rev: R("C0") }, payload: { eval_kind: "applicability", subject: { rev: route.rev }, barrier: { rev: R("P57") }, predicate: "is the property constructive and large?", value: "undetermined", scope: "only resemblance observed" }, provenance: { origin: "human", acquisition: "authorship" } } });
    const st = w.call(w.ana, "routeStatus", { entity_id: route.entity_id });
    expect(st.liveness).toBe("possibly_blocked_unknown");
    expect(codeOf(() => w.call(w.ana, "transitionWork", { entity_id: route.entity_id, to: "blocked", reason: "looks similar" }))).toBe("invalid_transition");
  });

  it("case 17 / AC18 / AC19: plans keep modalities; satisfying O06 shows for both consumers without completing them", () => {
    const o1 = w.call(w.ana, "plans", { entity_id: E("O01") });
    const mods = o1.plans[0].parts.map((p: any) => p.modality);
    expect(mods).toEqual(expect.arrayContaining(["proven_sufficient", "candidate_route"]));
    expect(mods.every((m: string) => m === "proven_necessary")).toBe(false);
    expect(o1.blocking[0].meaning).toMatch(/not claimed exhaustive|not by every possible proof/);
    const diag = w.decl(w.ana, "Applicability diagnosis", "The analyzed argument relativizes (P42) but does not algebrize");
    w.call(w.ana, "transitionWork", { entity_id: E("O06"), to: "active", reason: "start" });
    const prop = w.call(w.ben, "proposeClosure", { entity_id: E("O06"), artifact: diag.rev, criterion: "applicability assessment with evidence" });
    expect(w.call(w.ana, "entity", { entity_id: E("O06") }).work.state).toBe("completion_claimed");
    expect(codeOf(() => w.call(w.ben, "decideClosure", { entity_id: E("O06"), proposal: prop.id, accepted: true, reason: "ok" }))).toBe("insufficient_permission");
    w.call(w.rita, "decideClosure", { entity_id: E("O06"), proposal: prop.id, accepted: true, reason: "criterion met" });
    for (const o of ["O02", "O03"]) {
      const pl = w.call(w.ana, "plans", { entity_id: E(o) });
      expect(pl.plans[0].parts[0].closure.state).toBe("completed");
      expect(w.call(w.ana, "entity", { entity_id: E(o) }).work.state).not.toBe("completed");
    }
    expect(w.call(w.ana, "entity", { entity_id: E("O01") }).work.state).not.toBe("completed");
    // Reopen keeps the earlier closure on record (I29).
    w.call(w.rita, "reopen", { entity_id: E("O06"), reason: "context changed" });
    const work = w.call(w.ana, "entity", { entity_id: E("O06") }).work;
    expect(work.state).toBe("active");
    expect(work.closures[0].decision.accepted).toBe(true);
  });

  it("cases 8, 14, 15, 16: candidates, scoped supersession, own correction and status-without-edit", () => {
    // 8: N01 is quarantined, outside curated search.
    expect(w.call(w.ana, "search", { text: "dispersion", workspace_id: w.ws }).results).toHaveLength(0);
    expect(w.call(w.ana, "search", { text: "dispersion", workspace_id: w.ws, include_candidates: true }).results.length).toBeGreaterThan(0);
    // 14: P28 superseded in scope by P29, still valid and not refuted.
    const st28 = w.call(w.ana, "status", { rev: R("P28") });
    expect(st28.dimensions.validity.summary).toContain("superseded_in_scope");
    expect(st28.dimensions.logical.summary).toBe("supported_derivation");
    // 15: SD01 r1 preserved, corrected by r2 with a classified comparison.
    const sd = w.call(w.ana, "entity", { entity_id: E("SD01"), rev: R("SD01") });
    expect(sd.revisions).toHaveLength(2);
    expect(sd.revision.content.payload.statement).toMatch(/polynomial in n\b|polynomial in n /);
    expect(sd.status.dimensions.validity.summary).toContain("corrected");
    const cmp = w.call(w.ana, "compare", { old: R("SD01"), new: R("SD01r2") });
    expect(cmp.recorded_classifications[0].changes.map((c: any) => c.class)).toContain("changed_resource_parameter");
    // 16: ST01 gains support by assessment without a new revision.
    const before = w.call(w.ana, "entity", { entity_id: E("ST01") }).revisions.length;
    const pf = w.arg(w.ana, "Proof of ST01 (scenario, after P31)", [R("ST01")], { uses: [R("P31")] });
    w.review(w.rita, pf.rev, [{ dimension: "correctness", value: "supported_in_scope" }]);
    w.assess(w.rita, R("ST01"), "logical", "supported_derivation", { evidence: [pf.rev] });
    expect(w.call(w.ana, "entity", { entity_id: E("ST01") }).revisions.length).toBe(before);
    expect(w.call(w.ana, "support", { rev: R("ST01") }).summary).toBe("accepted_support_known");
  });

  it("case 20 / AC41: the O06 bundle closes mandatory context and is segmented, not truncated, when over budget", () => {
    const b = w.call(w.ana, "bundle", { rev: R("O06"), profile: "ai" });
    const mandatory = b.items.filter((i: any) => i.partition === "mandatory").map((i: any) => i.rev);
    expect(mandatory).toContain(R("O06"));
    expect(mandatory).toContain(w.call(w.ana, "revision", { rev: R("O06") }).context.rev);
    expect(b.profile_extras.candidate_boundary).toMatch(/candidate/);
    expect(["complete_for_declared_dependencies", "partial_informal", "source_missing"]).toContain(b.coverage);
    const small = w.call(w.ana, "bundle", { rev: R("O06"), profile: "mathematician", budget: 50 });
    expect(small.ready).toBe(false);
    expect(small.segments.length).toBeGreaterThan(1);
    const segRevs = small.segments.flatMap((s: any) => s.items);
    expect(new Set(segRevs)).toEqual(new Set(small.items.filter((i: any) => i.partition === "mandatory").map((i: any) => i.rev)));
    expect(small.omissions.every((o: any) => o.reason && o.expansion)).toBe(true);
    const sealed = w.call(w.ana, "sealBundle", { rev: R("O06"), profile: "ai" });
    const coll = w.call(w.ana, "revision", { rev: sealed.rev });
    expect(coll.content.payload.purpose).toBe("bundle");
    expect(coll.content.payload.bundle.coverage).toBe(b.coverage);
  });
});
