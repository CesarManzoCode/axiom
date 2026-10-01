// Identity, drafts, sealing, exact references, ancestry/containment, concurrency, idempotency,
// reconstruction and context bootstrap (§6–§10, §34E; AC01, 02, 09, 11, 12, 31, 32, 46–48, 57).
import { describe, expect, it } from "vitest";
import { codeOf, makeWorld } from "./helpers.ts";

describe("revisions and identity", () => {
  it("AC57: a new workspace gets a self-describing root context; the first object resolves without cycles or consistency claims", () => {
    const w = makeWorld();
    const root = w.call(w.ana, "revision", { rev: w.root });
    expect(root.context.self).toBe(true);
    expect(root.content.payload.root).toBe(true);
    expect(root.content.payload.foundations).toMatch(/no consistency claim/);
    const st = w.call(w.ana, "status", { rev: w.root });
    expect(st.dimensions.logical.summary).toBe("not_evaluated");
    const d = w.decl(w.ana, "First", "1 + 1 = 2");
    expect(w.call(w.ana, "revision", { rev: d.rev }).context.rev).toBe(w.root);
    // Only a root context may be its own context.
    const e = w.call(w.ana, "createEntity", { workspace_id: w.ws, kind: "context", title: "Bad", content: { context: { self: true }, payload: { foundations: "x" } } });
    expect(codeOf(() => w.call(w.ana, "seal", { drafts: [e.draft_id] }))).toBe("contract_violation");
  });

  it("AC01: editing a published revision creates a new draft/revision; the original and its citation stay identical", () => {
    const w = makeWorld();
    const d = w.decl(w.ana, "Lemma A", "For all n, n < n + 1");
    w.call(w.rita, "publish", { workspace_id: w.ws, revs: [w.root, d.rev], audience: { mode: "public" }, license: "CC BY" });
    const before = w.call(null, "revision", { rev: d.rev });
    const { draft_id } = w.call(w.ben, "draftFromRevision", { revs: [d.rev] });
    const draft = w.call(w.ben, "draft", { draft_id });
    w.call(w.ben, "saveDraft", { draft_id, content: { ...draft.content, payload: { ...draft.content.payload, statement: "For all natural n, n < n + 1" } }, generation: draft.generation });
    const r2 = w.call(w.ben, "seal", { drafts: [draft_id] }).revisions[0];
    expect(r2).not.toBe(d.rev);
    const after = w.call(null, "revision", { rev: d.rev });
    expect(after.content_hash).toBe(before.content_hash);
    expect(after.content.payload.statement).toBe("For all n, n < n + 1");
    expect(w.call(w.ana, "revision", { rev: r2 }).parents).toEqual([d.rev]);
    // Same entity, new revision; entity ID unchanged (I02).
    expect(w.call(w.ana, "revision", { rev: r2 }).entity_id).toBe(d.entity_id);
    // Publication still cites r1.
    const pubs = w.call(null, "publications", {});
    expect(pubs[0].revs.map((x: any) => x.rev)).toContain(d.rev);
    expect(pubs[0].revs.map((x: any) => x.rev)).not.toContain(r2);
  });

  it("AC02/AC16: a conjecture receives a proof and new assessment with identical text; before/after is reconstructible", () => {
    const w = makeWorld();
    const c = w.decl(w.ana, "Conj", "Every even n ≥ 4 is a sum of two primes in this toy model", { roles: ["conjecture"] });
    w.assess(w.ana, c.rev, "logical", "open");
    w.tick(10_000);
    const t0 = w.now();
    w.tick(10_000);
    const a = w.arg(w.ana, "Proof", [c.rev]);
    w.review(w.rita, a.rev, [{ dimension: "correctness", value: "supported_in_scope" }]);
    w.assess(w.rita, c.rev, "logical", "supported_derivation", { evidence: [a.rev] });
    const revs = w.call(w.ana, "entity", { entity_id: c.entity_id }).revisions;
    expect(revs).toHaveLength(1); // statement revision untouched
    const before = w.call(w.ana, "status", { rev: c.rev, cut: t0 });
    const now = w.call(w.ana, "status", { rev: c.rev });
    expect(before.dimensions.logical.summary).toBe("open");
    expect(before.support).toBe("none_recorded");
    expect(now.support).toBe("accepted_support_known");
    expect(now.dimensions.logical.conflicting).toBe(true); // open (ana) vs supported (rita): no majority
    w.call(w.rita, "selectAssessment", { subject_rev: c.rev, dimension: "logical", assessment_rev: now.dimensions.logical.positions.find((p: any) => p.value === "supported_derivation").assessment_rev, reason: "proof reviewed" });
    const selected = w.call(w.ana, "status", { rev: c.rev });
    expect(selected.dimensions.logical.summary).toBe("supported_derivation");
    expect(selected.dimensions.logical.mode).toBe("selected");
    expect(selected.dimensions.logical.conflicting).toBe(true); // opposition remains visible
  });

  it("AC09: a review of r stays on r; r′ does not inherit it", () => {
    const w = makeWorld();
    const d = w.decl(w.ana, "S", "x = x");
    w.review(w.rita, d.rev, [{ dimension: "correctness", value: "supported_in_scope" }, { dimension: "fidelity", value: "reviewed_match" }]);
    const { draft_id } = w.call(w.ana, "draftFromRevision", { revs: [d.rev] });
    const r2 = w.call(w.ana, "seal", { drafts: [draft_id] }).revisions[0];
    expect(w.call(w.ana, "status", { rev: d.rev }).dimensions.fidelity.summary).toBe("reviewed_match");
    const s2 = w.call(w.ana, "status", { rev: r2 });
    expect(s2.dimensions.fidelity.summary).toBe("not_evaluated");
    expect(s2.dimensions.review.summary).toBe("unreviewed");
  });

  it("AC11: a draft referring to 'latest' cannot be sealed until resolved explicitly", () => {
    const w = makeWorld();
    const y = w.decl(w.ana, "Y", "y holds");
    const e = w.call(w.ana, "createEntity", {
      workspace_id: w.ws,
      kind: "argument",
      title: "uses Y",
      content: { context: { rev: w.root }, payload: { targets: [{ rev: y.rev }], argument_kind: "sketch", completeness: "sketch", steps: [{ id: "s1", text: "by Y", uses: [{ entity: y.entity_id, selector: "latest" }] }] } },
    });
    expect(codeOf(() => w.call(w.ana, "seal", { drafts: [e.draft_id] }))).toBe("reference_unresolved");
    const res = w.call(w.ana, "resolveSelectors", { draft_id: e.draft_id });
    expect(res.resolutions[0].rev).toBe(y.rev);
    expect(res.resolutions[0].basis).toMatch(/most recent sealed/);
    const rev = w.call(w.ana, "seal", { drafts: [e.draft_id] }).revisions[0];
    expect(w.call(w.ana, "revisionUsed", { rev, entity_id: y.entity_id })[0].rev).toBe(y.rev);
  });

  it("AC12: publishing r′ of Y keeps a consumer pinned to r and notifies it with an explanation", () => {
    const w = makeWorld();
    const y = w.decl(w.ana, "Y", "y holds", { assumptions: [{ id: "H1", expr: "n > 0", scope: "local" }] });
    const x = w.decl(w.ben, "X", "x holds");
    const proof = w.arg(w.ben, "X from Y", [x.rev], { uses: [y.rev] });
    const { draft_id } = w.call(w.ana, "draftFromRevision", { revs: [y.rev] });
    const d = w.call(w.ana, "draft", { draft_id });
    w.call(w.ana, "saveDraft", { draft_id, generation: d.generation, content: { ...d.content, payload: { ...d.content.payload, assumptions: [{ id: "H1", expr: "n > 0", scope: "local" }, { id: "H2", expr: "n even", scope: "local" }] } } });
    const y2 = w.call(w.ana, "seal", { drafts: [draft_id] }).revisions[0];
    expect(w.call(w.ben, "revisionUsed", { rev: proof.rev, entity_id: y.entity_id })[0].rev).toBe(y.rev);
    const notes = w.call(w.ben, "notifications", {});
    expect(notes.some((n: any) => n.kind === "update_available" && n.payload.pinned_rev === y.rev && n.payload.new_rev === y2)).toBe(true);
    const imp = w.call(w.ben, "impact", { rev: y.rev, change: "new_revision", new_rev: y2 });
    expect(imp.definitely_affected).toHaveLength(0);
    expect(imp.update_notices[0].consumer.rev).toBe(proof.rev);
    expect(imp.update_notices[0].migration_obligations[0]).toMatch(/n even/);
  });

  it("AC31: ancestry/structural cycles are rejected; reference cycles over relations are allowed and traversal terminates", () => {
    const w = makeWorld();
    const a = w.decl(w.ana, "A", "a");
    const coll = (title: string, parts: string[]) =>
      w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "collection", title, content: { context: { rev: w.root }, payload: { purpose: "collection", manifest: parts.map((p, i) => ({ slot: `m${i}`, ref: { rev: p }, relation: "contains" })) }, provenance: { origin: "human", acquisition: "authorship" } } });
    const c1 = coll("C1", [a.rev]);
    const c2 = coll("C2", [c1.rev]);
    // A has_part relation making C1 contain C2 would close a structural cycle C2 ⊃ C1 ⊃ C2.
    expect(codeOf(() => w.rel(w.ana, "C1 has C2", "has_part", [["w", "whole", c1.rev], ["p", "part", c2.rev]]))).toBe("cycle");
    // Reference cycles: relation R1 supports A; R2 challenges R1; R3 supports R2 citing R1.
    const r1 = w.rel(w.ana, "R1", "supports", [["e", "evidence", a.rev], ["t", "target", c1.rev]]);
    const r2 = w.rel(w.ana, "R2", "challenges", [["e", "evidence", r1.rev], ["t", "target", r1.rev]]);
    const r3 = w.rel(w.ana, "R3", "supports", [["e", "evidence", r2.rev], ["t", "target", r1.rev]]);
    const g = w.call(w.ana, "localGraph", { rev: r1.rev, depth: 3 });
    expect(g.nodes.map((n: any) => n.id)).toEqual(expect.arrayContaining([r1.rev, r2.rev, r3.rev]));
    const imp = w.call(w.ana, "impact", { rev: a.rev, change: "retracted", budget: 20 });
    expect(imp.coverage.visited).toBeGreaterThan(0);
    // Context import cycles are impossible to seal; a joint snapshot attempting one is rejected atomically.
    const ctxA = w.call(w.ana, "createEntity", { workspace_id: w.ws, kind: "context", title: "CA", content: { context: { rev: w.root }, payload: { foundations: "f" } } });
    const ctxB = w.call(w.ana, "createEntity", { workspace_id: w.ws, kind: "context", title: "CB", content: { context: { rev: w.root }, payload: { foundations: "f", imports: [{ draft: ctxA.draft_id }] } } });
    const da = w.call(w.ana, "draft", { draft_id: ctxA.draft_id });
    w.call(w.ana, "saveDraft", { draft_id: ctxA.draft_id, generation: da.generation, content: { ...da.content, payload: { foundations: "f", imports: [{ draft: ctxB.draft_id }] } } });
    expect(codeOf(() => w.call(w.ana, "seal", { drafts: [ctxA.draft_id, ctxB.draft_id] }))).toBe("cycle");
    expect(w.call(w.ana, "draft", { draft_id: ctxA.draft_id }).status).toBe("editing");
  });

  it("AC32: a joint snapshot of mutually referencing drafts publishes all coherent or none", () => {
    const w = makeWorld();
    const mk = (title: string) => w.call(w.ana, "createEntity", { workspace_id: w.ws, kind: "declaration", title, content: { context: { rev: w.root }, payload: { category: "propositional", statement: title } } });
    const a = mk("A");
    const b = mk("B");
    const setRefs = (id: string, other: string) => {
      const d = w.call(w.ana, "draft", { draft_id: id });
      w.call(w.ana, "saveDraft", { draft_id: id, generation: d.generation, content: { ...d.content, references: [{ ref: { draft: other }, purpose: "explicit_informal" }] } });
    };
    setRefs(a.draft_id, b.draft_id);
    setRefs(b.draft_id, a.draft_id);
    // Sealing one alone cannot resolve the other's reserved ID.
    expect(codeOf(() => w.call(w.ana, "seal", { drafts: [a.draft_id] }))).toBe("reference_unresolved");
    // Break B so that the cohort fails: nothing is sealed.
    const bd = w.call(w.ana, "draft", { draft_id: b.draft_id });
    w.call(w.ana, "saveDraft", { draft_id: b.draft_id, generation: bd.generation, content: { ...bd.content, payload: { category: "nonsense" } } });
    const before = w.p.k.db.get("select count(*) as n from revisions")!.n;
    expect(codeOf(() => w.call(w.ana, "seal", { drafts: [a.draft_id, b.draft_id] }))).toBe("contract_violation");
    expect(w.p.k.db.get("select count(*) as n from revisions")!.n).toBe(before);
    const bd2 = w.call(w.ana, "draft", { draft_id: b.draft_id });
    w.call(w.ana, "saveDraft", { draft_id: b.draft_id, generation: bd2.generation, content: { ...bd2.content, payload: { category: "propositional", statement: "B" } } });
    const sealed = w.call(w.ana, "seal", { drafts: [a.draft_id, b.draft_id] }).revisions;
    const ra = w.call(w.ana, "revision", { rev: sealed[0] });
    expect(ra.content.references[0].ref.rev).toBe(sealed[1]);
    const rb = w.call(w.ana, "revision", { rev: sealed[1] });
    expect(rb.content.references[0].ref.rev).toBe(sealed[0]);
  });

  it("AC46: reconstruction at t does not include knowledge recorded after t even if backdated", () => {
    const w = makeWorld();
    const d = w.decl(w.ana, "T", "t");
    w.tick(60_000);
    const t = w.now();
    w.tick(60_000);
    // A historical source found later claims an earlier discovery date (occurred_at in the past).
    w.call(w.ana, "createAndSeal", {
      workspace_id: w.ws,
      kind: "evaluation",
      title: "Historical review found later",
      content: { context: { rev: w.root }, payload: { eval_kind: "assessment", subject: { rev: d.rev }, dimension: "novelty", value: "prior_art_found", scope: "found in 1970 archive" }, provenance: { origin: "human", acquisition: "import", original_attribution: "archive", dates: { discovery_claimed_at: "1970" } } },
    });
    const past = w.call(w.ana, "asOf", { entity_id: d.entity_id, cut: t });
    expect(past.view.status.dimensions.novelty.summary).toBe("not_searched");
    const nowView = w.call(w.ana, "entity", { entity_id: d.entity_id });
    expect(nowView.status.dimensions.novelty.summary).toBe("prior_art_found");
  });

  it("AC47: two editors saving against the same baseline get a conflict, not a silent overwrite; both versions survive", () => {
    const w = makeWorld();
    const d = w.decl(w.ana, "Shared", "original");
    const { draft_id } = w.call(w.ana, "draftFromRevision", { revs: [d.rev] });
    const a = w.call(w.ana, "draft", { draft_id });
    const b = w.call(w.ben, "draft", { draft_id });
    w.call(w.ana, "saveDraft", { draft_id, generation: a.generation, content: { ...a.content, payload: { ...a.content.payload, statement: "ana's edit" } } });
    expect(codeOf(() => w.call(w.ben, "saveDraft", { draft_id, generation: b.generation, content: { ...b.content, payload: { ...b.content.payload, statement: "ben's edit" } } }))).toBe("stale_draft");
    const alt = w.call(w.ben, "saveAsAlternativeDraft", { draft_id, content: { ...b.content, payload: { ...b.content.payload, statement: "ben's edit" } } });
    const s1 = w.call(w.ana, "seal", { drafts: [draft_id] }).revisions[0];
    const s2 = w.call(w.ben, "seal", { drafts: [alt.draft_id] }).revisions[0];
    expect(w.call(w.ana, "revision", { rev: s1 }).content.payload.statement).toBe("ana's edit");
    expect(w.call(w.ana, "revision", { rev: s2 }).content.payload.statement).toBe("ben's edit");
    expect(w.call(w.ana, "revision", { rev: s2 }).parents).toEqual([d.rev]); // siblings, no global head
    expect(w.call(w.ana, "revision", { rev: d.rev }).content.payload.statement).toBe("original");
  });

  it("AC48: retrying a publication/gate/seal with the same activity id does not duplicate; different content conflicts", () => {
    const w = makeWorld();
    const d = w.decl(w.ana, "P", "p");
    const args = { workspace_id: w.ws, revs: [w.root, d.rev], audience: { mode: "public" }, license: "CC0", idem_key: "act-1" };
    const p1 = w.call(w.rita, "publish", args);
    const p2 = w.call(w.rita, "publish", args);
    expect(p2.publication_id).toBe(p1.publication_id);
    expect(p2.replayed).toBe(true);
    expect(w.call(w.rita, "publications", { workspace_id: w.ws })).toHaveLength(1);
    expect(codeOf(() => w.call(w.rita, "publish", { ...args, license: "CC BY" }))).toBe("idempotency_conflict");
    const s1 = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title: "Q", idem_key: "seal-1", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "q" }, provenance: { origin: "human", acquisition: "authorship" } } });
    const s2 = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title: "Q", idem_key: "seal-1", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "q" }, provenance: { origin: "human", acquisition: "authorship" } } });
    expect(s2.rev).toBe(s1.rev);
    const cand = w.call(w.ai, "submitCandidate", { workspace_id: w.ws, kind: "declaration", title: "C", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "c" }, provenance: { origin: "ai", acquisition: "extraction", original_attribution: "x" } } });
    const g1 = w.call(w.rita, "promote", { candidate_rev: cand.rev, scope: "faithful", decision: "admit", idem_key: "gate-1" });
    const g2 = w.call(w.rita, "promote", { candidate_rev: cand.rev, scope: "faithful", decision: "admit", idem_key: "gate-1" });
    expect(g2.curated_rev).toBe(g1.curated_rev);
    expect(w.p.k.db.get("select count(*) as n from entities where namespace = 'curated' and title = 'C'")!.n).toBe(1);
  });

  it("I34/I32: conflicting inherited contexts need an explicit resolution; equal symbols do not silently merge", () => {
    const w = makeWorld();
    const ctx = (title: string, notation: any[], imports: string[] = [], resolutions: any[] = []) =>
      w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "context", title, content: { context: { rev: w.root }, payload: { foundations: "classical", notation, imports: imports.map((rev) => ({ rev })), resolutions }, provenance: { origin: "human", acquisition: "authorship" } } });
    const c1 = ctx("C1", [{ symbol: "P", meaning: "polynomial time" }]);
    const c2 = ctx("C2", [{ symbol: "P", meaning: "a fixed prime" }]);
    expect(codeOf(() => ctx("C3", [], [c1.rev, c2.rev]))).toBe("context_conflict");
    const ok = ctx("C3", [], [c1.rev, c2.rev], [{ symbol: "P", choice: "rename C2's P to p" }]);
    expect(ok.rev).toBeTruthy();
    // A relation between statements interpreted in unrelated contexts needs a map or 'unresolved'.
    const a = w.decl(w.ana, "A in C1", "P is closed under complement", { context: c1.rev });
    const b = w.decl(w.ana, "B in C2", "P is odd", { context: c2.rev });
    expect(codeOf(() => w.rel(w.ana, "A ⇔ B", "equivalent_under", [["a", "side", a.rev], ["b", "side", b.rev]], { context: c1.rev }))).toBe("contract_violation");
    expect(w.rel(w.ana, "A ⇔ B?", "equivalent_under", [["a", "side", a.rev], ["b", "side", b.rev]], { context: c1.rev, fields: { context_comparison: "unresolved" } }).rev).toBeTruthy();
  });
});
