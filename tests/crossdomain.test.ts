// §30 cross-domain fixtures through the same contracts (AC21–AC25, AC43–AC45).
import { beforeAll, describe, expect, it } from "vitest";
import { makeWorld, type World } from "./helpers.ts";

let w: World;
const R = (k: string) => w.fx!.rev(k);
const E = (k: string) => w.fx!.entity(k);

beforeAll(() => {
  w = makeWorld({ fixture: "cross" });
});

describe("§30 cross-domain", () => {
  it("AC43 (A): the isomorphism keeps witness and orientation; the commuting square keeps faces and its equation as a claim", () => {
    const a04 = w.call(w.ana, "revision", { rev: R("A04") });
    expect(a04.content.payload.contract.id).toBe("isomorphic_to");
    const witness = a04.content.payload.slots.find((s: any) => s.role === "witness");
    expect(witness.ref.rev).toBe(R("A03"));
    expect(a04.content.payload.slots.filter((s: any) => s.role === "side").every((s: any) => typeof s.order === "number")).toBe(true);
    const a05 = w.call(w.ana, "revision", { rev: R("A05") });
    const diag = a05.content.representations.find((r: any) => r.diagram)?.diagram;
    expect(diag.vertices).toHaveLength(4);
    expect(diag.arrows).toHaveLength(4);
    expect(diag.faces.length).toBeGreaterThan(0);
    expect(diag.equations[0]).toMatch(/β/);
    // Isomorphism is not identity: anchors differ and no equivalence/identity record merges them.
    const sides = a04.content.payload.slots.filter((s: any) => s.role === "side").map((s: any) => w.call(w.ana, "revision", { rev: s.ref.rev }).entity_id);
    expect(new Set(sides).size).toBe(2);
    expect(w.call(w.ana, "identityRecords", { entity_id: sides[0] })).toHaveLength(0);
  });

  it("AC21 (B): B03→B04 is a classified correction with an assessor, never an automatic editorial change", () => {
    const cmp = w.call(w.ana, "compare", { old: R("B03"), new: R("B04") });
    expect(cmp.suggestions.some((s: any) => s.class === "typo_editorial")).toBe(false);
    const rec = cmp.recorded_classifications[0];
    expect(rec.assessor).toBeTruthy();
    expect(rec.changes.map((c: any) => c.class)).toEqual(expect.arrayContaining(["strengthened_assumption", "corrected_statement"]));
    expect(w.call(w.ana, "status", { rev: R("B03") }).dimensions.validity.summary).toContain("corrected");
    expect(w.call(w.ana, "status", { rev: R("B03") }).dimensions.logical.summary).toBe("refuted");
    expect(w.call(w.ana, "entity", { entity_id: E("B03"), rev: R("B03") }).revision.content.payload.statement).toMatch(/continuous/);
  });

  it("AC22 (B07): swapping ∀a a.e.x into a.e.x ∀a is flagged as a quantifier change; never 'equivalent' without evidence", () => {
    const r1 = w.decl(w.ana, "Each a, a.e. x", "For every a in [0,1], for almost every x in [0,1], g_a(x) = 0");
    const { draft_id } = w.call(w.ana, "draftFromRevision", { revs: [r1.rev] });
    const d = w.call(w.ana, "draft", { draft_id });
    w.call(w.ana, "saveDraft", { draft_id, generation: d.generation, content: { ...d.content, payload: { ...d.content.payload, statement: "For almost every x in [0,1], for every a in [0,1], g_a(x) = 0" } } });
    const r2 = w.call(w.ana, "seal", { drafts: [draft_id] }).revisions[0];
    const cmp = w.call(w.ana, "compare", { old: r1.rev, new: r2 });
    const q = cmp.suggestions.find((s: any) => s.class === "changed_quantifier");
    expect(q.status).toBe("suggested");
    expect(JSON.stringify(cmp)).not.toMatch(/"equivalent"/);
    // The fixture records the counterexample family B07 separately.
    expect(w.call(w.ana, "revision", { rev: R("S_B07_NO_COMMON") }).content.payload.statement).toMatch(/null set|common/i);
  });

  it("AC44 (C): a dataset of odd-prime decompositions is not a Goldbach counterexample nor an exact formal dependency", () => {
    const c04 = w.call(w.ana, "revision", { rev: R("C04") });
    expect(c04.content.payload.revision_identity.status).toBe("unknown");
    expect(c04.content.payload.revision_identity.reason).toBeTruthy();
    const c01 = w.call(w.ana, "status", { rev: R("C01") });
    expect(c01.dimensions.logical.summary).toBe("open");
    expect(w.call(w.ana, "support", { rev: R("C01") }).counter_evidence).toHaveLength(0);
    const deps = w.call(w.ana, "dependsOn", { rev: R("C02") }).by_kind;
    expect((deps.formal ?? []).some((e: any) => e.rev === R("C04"))).toBe(false);
    const c05 = w.call(w.ana, "revision", { rev: R("C05") });
    expect(c05.content.payload.contract.id).toBe("supports");
    const rep = w.call(w.ana, "entity", { entity_id: E("S_C02_COMPUTATION") }).reproducibility;
    expect(rep.note).toMatch(/finite/);
  });

  it("AC45 (D): CH answers are contextual; relative independence keeps Con(ZFC) visible and no global truth value", () => {
    const d01 = w.call(w.ana, "status", { rev: R("D01") });
    expect(d01.dimensions.logical.summary).toBe("relative_independence");
    const d04 = w.call(w.ana, "revision", { rev: R("D04") });
    expect(d04.content.payload.contract.id).toBe("entails");
    expect(d04.content.payload.grouping.premise.op).toBe("AND");
    const condition = d04.content.payload.slots.find((s: any) => s.role === "condition");
    expect(w.call(w.ana, "revision", { rev: condition.ref.rev }).content.payload.statement).toMatch(/Con\(ZFC\)/);
    const plus = w.call(w.ana, "revision", { rev: R("S_D05_PLUS") });
    const minus = w.call(w.ana, "revision", { rev: R("S_D05_MINUS") });
    expect(plus.context.rev).not.toBe(minus.context.rev);
    expect(w.call(w.ana, "revision", { rev: plus.context.rev }).content.payload.assumptions.length + w.call(w.ana, "revision", { rev: plus.context.rev }).content.payload.axioms.length).toBeGreaterThan(0);
  });

  it("AC24/AC25 (E): an imported formal artifact is check_pass_reported, not reproduced; fidelity stays separate and unevaluated", () => {
    const f = w.call(w.ana, "entity", { entity_id: E("E02") }).formalization;
    expect(f.formal_statement.system).toMatch(/Isabelle/);
    expect(f.fidelity.summary).toBe("not_evaluated");
    const e03 = w.call(w.ana, "status", { rev: R("E03") });
    expect(e03.dimensions.formalization.summary).toBe("check_pass_reported");
    expect(f.formal_arguments.find((a: any) => a.rev === R("E03")).kernel_dependencies).toBe("not_extracted");
    // A later reproduced check is evidence only: fidelity untouched, nothing becomes 'verified'.
    w.assess(w.rita, R("E03"), "formalization", "check_pass_reproduced", { scope: "replayed in Isabelle2021 on our machine" });
    const after = w.call(w.ana, "entity", { entity_id: E("E02") }).formalization;
    expect(after.fidelity.summary).toBe("not_evaluated");
    expect(JSON.stringify(w.call(w.ana, "status", { rev: R("E02") }))).not.toMatch(/verified/);
  });

  it("AC23 (E): a library/context update creates new revisions and check scope; old assessments are not transferred", () => {
    const { draft_id } = w.call(w.rita, "draftFromRevision", { revs: [R("E06")] });
    const d = w.call(w.rita, "draft", { draft_id });
    w.call(w.rita, "saveDraft", { draft_id, generation: d.generation, content: { ...d.content, payload: { ...d.content.payload, execution: { ...d.content.payload.execution, kernel: "Isabelle2024 HOL" } }, change_summary: "library update" } });
    const e06b = w.call(w.rita, "seal", { drafts: [draft_id] }).revisions[0];
    expect(w.call(w.ana, "revision", { rev: R("E03") }).content.payload.formal.environment.rev).toBe(R("E06"));
    const d2 = w.call(w.rita, "draftFromRevision", { revs: [R("E03")] });
    const dd = w.call(w.rita, "draft", { draft_id: d2.draft_id });
    w.call(w.rita, "saveDraft", { draft_id: d2.draft_id, generation: dd.generation, content: { ...dd.content, payload: { ...dd.content.payload, formal: { ...dd.content.payload.formal, environment: { rev: e06b } } } } });
    const e03b = w.call(w.rita, "seal", { drafts: [d2.draft_id] }).revisions[0];
    expect(w.call(w.ana, "status", { rev: e03b }).dimensions.formalization.summary).toBe("none_known");
    expect(w.call(w.ana, "status", { rev: R("E03") }).dimensions.formalization.summary).not.toBe("none_known");
    const imp = w.call(w.ana, "impact", { rev: R("E06"), change: "new_revision", new_rev: e06b });
    expect(imp.update_notices.some((n: any) => n.consumer.rev === R("E03"))).toBe(true);
  });
});
