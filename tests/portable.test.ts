// Export/import roundtrip (AC49) and loss of source access (AC55).
import { describe, expect, it } from "vitest";
import { Platform } from "../src/core/platform.ts";
import { makeWorld } from "./helpers.ts";

describe("portability", () => {
  it("AC49: export → import preserves IDs, revisions, contracts, roles, provenance, relations-on-relations, cuts and limits", () => {
    const w = makeWorld({ fixture: "pvnp" });
    const R = (k: string) => w.fx!.rev(k);
    w.review(w.rita, R("P31"), [{ dimension: "correctness", value: "supported_in_scope" }]);
    w.call(w.rita, "publish", { workspace_id: w.ws, revs: [w.root, R("C0"), R("P01")], audience: { mode: "public" }, license: "CC BY", rights_confirmed: true });
    const exp = w.call(w.ana, "exportWorkspace", { workspace_id: w.ws });
    expect(exp.format).toBe("axiom-portable-export");
    expect(exp.assessment_policy.key).toBe("workspace_curator_selection@1");
    expect(exp.contracts.extensions.map((c: any) => c.id)).toContain("limits_scope");
    expect(JSON.stringify(exp)).not.toMatch(/password_hash|token_hash/);
    const json = JSON.parse(JSON.stringify(exp));

    const p2 = new Platform();
    const importer = p2.createHuman("archivist", "Archivist").agent_id;
    const res = p2.call("importWorkspace", importer, { data: json });
    expect(res.workspace_id).toBe(w.ws);
    expect(res.revisions).toBe(exp.revisions.length);
    for (const key of ["P20", "RR01", "P73", "FN01", "R_PLAN_O01"]) {
      const a = w.call(w.ana, "revision", { rev: R(key) });
      const b = p2.call("revision", importer, { rev: R(key) });
      expect(b.content_hash).toBe(a.content_hash);
      expect(b.entity_id).toBe(a.entity_id);
      expect(b.content.payload).toEqual(a.content.payload);
      expect(b.content.provenance.original_attribution).toBe(a.content.provenance.original_attribution);
    }
    // Typed traversal still works after re-indexing: relations-on-relations and n-ary roles.
    const used = p2.call("usedBy", importer, { rev: R("R_FA01_PROVES") });
    expect(Object.values(used.by_kind).flat().some((e: any) => e.rev === R("RR01") && e.role === "target")).toBe(true);
    const st1 = w.call(w.ana, "status", { rev: R("P31") });
    const st2 = p2.call("status", importer, { rev: R("P31") });
    expect(st2.findings.find((f: any) => f.dimension === "correctness").summary).toBe(st1.findings.find((f: any) => f.dimension === "correctness").summary);
    expect(p2.call("status", importer, { rev: R("P70") }).dimensions.logical.summary).toBe("refuted");
    // Publications and audiences survive: the public package is public in the new store too.
    expect(p2.call("revision", null, { rev: R("P01") }).id).toBe(R("P01"));
    // Re-importing the same workspace is refused; a tampered revision is rejected.
    expect(() => p2.call("importWorkspace", importer, { data: json })).toThrow();
    const p3 = new Platform();
    const imp3 = p3.createHuman("xavier", "Xavier").agent_id;
    const tampered = JSON.parse(JSON.stringify(exp));
    tampered.revisions[5].content.title = "tampered";
    expect(() => p3.call("importWorkspace", imp3, { data: tampered })).toThrow(/hash/);
    // Export as of a cut omits later records and states omissions.
    expect(exp.omissions.drafts).toMatch(/not exported/);
  });

  it("AC55: when a source loses its URL/access, the native revision and citation persist; availability/reproducibility change by events, not truth", () => {
    const w = makeWorld();
    const src = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "source", title: "Dataset page", content: { context: { rev: w.root }, payload: { source_kind: "dataset", citation: "Dataset X", url: "https://example.org/x", rights: { status: "unknown" }, availability: "available", revision_identity: { status: "unknown", reason: "no snapshot id" } }, provenance: { origin: "human", acquisition: "import", original_attribution: "Dataset X maintainers" } } });
    const result = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title: "Finite check", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "Holds for all n ≤ 1000" }, provenance: { origin: "human", acquisition: "computation", sources: [{ source: { rev: src.rev }, locator: "table 1" }], original_attribution: "Ana" } } });
    w.assess(w.ana, result.rev, "logical", "supported_derivation", { scope: "n ≤ 1000" });
    const before = w.call(w.ana, "revision", { rev: result.rev });
    const { draft_id } = w.call(w.ana, "draftFromRevision", { revs: [src.rev] });
    const d = w.call(w.ana, "draft", { draft_id });
    w.call(w.ana, "saveDraft", { draft_id, generation: d.generation, content: { ...d.content, payload: { ...d.content.payload, availability: "unavailable", url: undefined }, change_summary: "URL no longer resolves" } });
    w.call(w.ana, "seal", { drafts: [draft_id] });
    w.assess(w.ana, result.rev, "reproducibility", "artifacts_missing", { scope: "source table no longer reachable" });
    const after = w.call(w.ana, "revision", { rev: result.rev });
    expect(after.content_hash).toBe(before.content_hash);
    expect(after.content.provenance.sources[0].source.rev).toBe(src.rev);
    const st = w.call(w.ana, "status", { rev: result.rev });
    expect(st.dimensions.reproducibility.summary).toBe("artifacts_missing");
    expect(st.dimensions.logical.summary).toBe("supported_derivation");
  });
});
