// The fifteen §27 workflows end to end over HTTP (AC50 at the API boundary): users write and
// read; metadata beyond content and inherited context is only asked when sealing/publishing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Platform } from "../src/core/platform.ts";
import { createApp } from "../src/server/app.ts";

let server: Server;
let base = "";
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function rpc(who: string | null, method: string, args: any = {}) {
  const res = await fetch(`${base}/api/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error.message), { code: body.error.code, details: body.error.details, status: res.status });
  return body.result;
}
const human = { origin: "human", acquisition: "authorship" };
async function edit(who: string, draft_id: string, patch: (c: any) => any) {
  const d = await rpc(who, "draft", { draft_id });
  return rpc(who, "saveDraft", { draft_id, generation: d.generation, content: patch(d.content) });
}

beforeAll(async () => {
  const platform = new Platform();
  server = createApp(platform).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [h, n] of [["ana", "Ana"], ["ben", "Ben"], ["rita", "Rita"]]) tokens[h] = (await rpc(null, "register", { handle: h, name: n, password: "secret-pw" })).token;
  ids.ana = (await rpc("ana", "me")).agent.id;
  ids.ben = (await rpc("ben", "me")).agent.id;
  ids.rita = (await rpc("rita", "me")).agent.id;
});
afterAll(() => server.close());

describe("§27 workflows over HTTP", () => {
  it("1 — create research: question/objective, inherited context, narrative and obligation; private by default", async () => {
    const ws = await rpc("ana", "createWorkspace", { name: "Lower bounds", profile: "classical_informal" });
    ids.ws = ws.workspace_id;
    ids.root = ws.root_context_rev;
    await rpc("ana", "addMember", { workspace_id: ids.ws, agent_id: ids.ben, roles: ["editor", "reviewer"] });
    await rpc("ana", "addMember", { workspace_id: ids.ws, agent_id: ids.rita, roles: ["curator", "editor", "publisher", "reviewer"] });
    // Saving a draft needs only content: the root context is inherited and visible.
    const q = await rpc("ana", "createEntity", { workspace_id: ids.ws, kind: "research", title: "Do small circuits compute parity?", content: { payload: { role: "objective", goal: "Decide whether constant-depth circuits compute parity" } } });
    const d = await rpc("ana", "draft", { draft_id: q.draft_id });
    expect(d.content.context.rev).toBe(ids.root);
    ids.objective = (await rpc("ana", "seal", { drafts: [q.draft_id] })).revisions[0];
    const ob = await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "research", title: "Show PARITY ∉ AC0", content: { context: { rev: ids.root }, payload: { role: "obligation", goal: "Lower bound for parity", closure_criterion: "an accepted proof or counterexample" }, provenance: human } });
    ids.obligation = ob.rev;
    ids.obligationEntity = ob.entity_id;
    await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "relation", title: "Plan", content: { context: { rev: ids.root }, payload: { contract: { id: "decomposes_into", version: "core@1" }, slots: [{ slot: "w", role: "whole", ref: { rev: ids.objective } }, { slot: "p", role: "part", ref: { rev: ob.rev }, modality: "proven_sufficient" }], modality: "logical", interpretation: "Lower bound suffices", fields: { plan_mode: "AND" } }, provenance: human } });
    const cockpit = await rpc("ana", "cockpit", { workspace_id: ids.ws });
    expect(cockpit.objectives[0].plans[0].parts[0].modality).toBe("proven_sufficient");
    await expect(rpc(null, "revision", { rev: ids.objective })).rejects.toMatchObject({ code: "not_found" });
  });

  it("2 — import literature: source with edition/rights, extracted candidates reviewed together; partial coverage", async () => {
    const src = await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "source", title: "Håstad 1986", content: { context: { rev: ids.root }, payload: { source_kind: "thesis", citation: "J. Håstad, Computational Limitations for Small Depth Circuits, 1986", edition: "1986 thesis manuscript", rights: { status: "unknown" }, availability: "available", revision_identity: { status: "exact", value: "1986 thesis" } }, provenance: { origin: "human", acquisition: "import", original_attribution: "bibliographic record" } } });
    ids.source = src.rev;
    const c1 = await rpc("ana", "submitCandidate", { workspace_id: ids.ws, kind: "declaration", title: "Switching lemma", content: { context: { rev: ids.root }, payload: { category: "propositional", statement: "Random restrictions simplify DNFs to short decision trees w.h.p." }, provenance: { origin: "human", acquisition: "extraction", sources: [{ source: { rev: src.rev }, locator: "ch. 4" }], original_attribution: "Johan Håstad" } } });
    const c2 = await rpc("ana", "submitCandidate", { workspace_id: ids.ws, kind: "declaration", title: "Parity bound", content: { context: { rev: ids.root }, payload: { category: "propositional", statement: "Parity requires size exp(Ω(n^{1/(d−1)})) at depth d" }, provenance: { origin: "human", acquisition: "extraction", sources: [{ source: { rev: src.rev }, locator: "ch. 5" }], original_attribution: "Johan Håstad" } } });
    const batch = await rpc("rita", "promoteBatch", { candidate_revs: [c1.rev, c2.rev], scope: "faithful extraction; logical status not evaluated", decision: "batch admission" });
    ids.switching = batch.promoted.find((p: any) => p.candidate_rev === c1.rev).curated_rev;
    ids.parityBound = batch.promoted.find((p: any) => p.candidate_rev === c2.rev).curated_rev;
    const r = await rpc("ana", "revision", { rev: ids.parityBound });
    expect(r.content.provenance.original_attribution).toBe("Johan Håstad");
    expect(r.content.provenance.sources[0].locator).toBe("ch. 5");
  });

  it("3 — own entity in the text: minimal draft, then seal with context", async () => {
    const e = await rpc("ben", "createEntity", { workspace_id: ids.ws, kind: "declaration", title: "PARITY ∉ AC0", content: { payload: { category: "propositional", statement: "PARITY is not computable by AC0 circuits" } } });
    ids.claimEntity = e.entity_id;
    ids.claim = (await rpc("ben", "seal", { drafts: [e.draft_id] })).revisions[0];
    expect((await rpc("ben", "status", { rev: ids.claim })).dimensions.logical.summary).toBe("not_evaluated");
  });

  it("4 — reuse an exact revision with a typed use; a newer edition never rewrites it", async () => {
    const found = await rpc("ben", "search", { text: "Switching", workspace_id: ids.ws });
    const rev = found.results[0].revisions[0].id;
    const proof = await rpc("ben", "createAndSeal", { workspace_id: ids.ws, kind: "argument", title: "Proof via switching lemma", content: { context: { rev: ids.root }, payload: { targets: [{ rev: ids.claim }], argument_kind: "natural_language_proof", completeness: "partial", steps: [{ id: "s1", text: "apply the switching lemma", uses: [{ rev }] }, { id: "s2", text: "induct on depth", uses: [] }], gaps: [{ id: "g1", text: "parameter bookkeeping" }] }, provenance: human } });
    ids.proof = proof.rev;
    ids.proofEntity = proof.entity_id;
    expect((await rpc("ben", "revisionUsed", { rev: proof.rev, entity_id: found.results[0].entity_id }))[0].rev).toBe(rev);
  });

  it("5 — review a draft against its base, diff, seal and publish to an audience", async () => {
    const { draft_id } = await rpc("ben", "draftFromRevision", { revs: [ids.claim] });
    await edit("ben", draft_id, (c) => ({ ...c, payload: { ...c.payload, statement: "For every fixed depth d, PARITY is not computable by polynomial-size depth-d circuits" }, change_summary: "make quantifiers explicit" }));
    ids.claim2 = (await rpc("ben", "seal", { drafts: [draft_id] })).revisions[0];
    const diff = await rpc("ben", "compare", { old: ids.claim, new: ids.claim2 });
    expect(diff.suggestions.map((s: any) => s.class)).toContain("changed_quantifier");
    const pre = await rpc("rita", "exposurePreview", { revs: [ids.claim2], audience: { mode: "public" } });
    expect(pre.ok).toBe(false);
    await rpc("rita", "publish", { workspace_id: ids.ws, revs: [ids.root, ids.claim2], audience: { mode: "public" }, license: "CC BY 4.0" });
    expect((await rpc(null, "revision", { rev: ids.claim2 })).content.payload.statement).toMatch(/fixed depth/);
    await expect(rpc(null, "revision", { rev: ids.claim })).rejects.toMatchObject({ code: "not_found" });
  });

  it("6 — record a connection guided by the contract, as own claim, and review it", async () => {
    await expect(rpc("ben", "createAndSeal", { workspace_id: ids.ws, kind: "relation", title: "bad", content: { context: { rev: ids.root }, payload: { contract: { id: "reduces_to", version: "core@1" }, slots: [{ slot: "s", role: "source", ref: { rev: ids.claim2 } }, { slot: "t", role: "target", ref: { rev: ids.parityBound } }], modality: "logical", interpretation: "x", fields: { regime: "many-one" } }, provenance: human } })).rejects.toMatchObject({ code: "contract_violation" });
    const rel = await rpc("ben", "createAndSeal", { workspace_id: ids.ws, kind: "relation", title: "Quantitative bound implies separation", content: { context: { rev: ids.root }, payload: { contract: { id: "entails", version: "core@1" }, slots: [{ slot: "p", role: "premise", ref: { rev: ids.parityBound } }, { slot: "c", role: "conclusion", ref: { rev: ids.claim2 } }], modality: "logical", interpretation: "exp lower bound ⇒ not polynomial size", hypotheses: [{ id: "h", text: "d fixed" }] }, provenance: human } });
    ids.relation = rel.rev;
    await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "evaluation", title: "Review of entailment", content: { context: { rev: ids.root }, payload: { eval_kind: "review", subject: { rev: rel.rev }, scope: "elementary", findings: [{ dimension: "correctness", value: "supported_in_scope" }] }, provenance: human } });
    expect((await rpc("ana", "status", { rev: rel.rev })).dimensions.review.summary).toMatch(/team_reviewed/);
  });

  it("7 — propose a refutation with matching scope; the curator selects; impact is explainable", async () => {
    const wrong = await rpc("ben", "createAndSeal", { workspace_id: ids.ws, kind: "declaration", title: "Over-strong claim", content: { context: { rev: ids.root }, payload: { category: "propositional", statement: "Every symmetric function needs exponential AC0 size" }, provenance: human } });
    const ce = await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "argument", title: "AND is symmetric and in AC0", content: { context: { rev: ids.root }, payload: { targets: [{ rev: wrong.rev }], argument_kind: "counterexample", completeness: "complete", summary: "AND_n is symmetric with a single gate." }, provenance: human } });
    const ref = await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "relation", title: "AND refutes the over-strong claim", content: { context: { rev: ids.root }, payload: { contract: { id: "refutes", version: "core@1" }, slots: [{ slot: "e", role: "evidence", ref: { rev: ce.rev } }, { slot: "t", role: "target", ref: { rev: wrong.rev } }], modality: "logical", interpretation: "counterexample within the same quantifier scope", fields: { negated: "∀ symmetric f: exp size" } }, provenance: human } });
    const a = await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "evaluation", title: "refuted", content: { context: { rev: ids.root }, payload: { eval_kind: "assessment", subject: { rev: wrong.rev }, dimension: "logical", value: "refuted", scope: "as stated", evidence: [{ rev: ref.rev }] }, provenance: human } });
    await rpc("rita", "selectAssessment", { subject_rev: wrong.rev, dimension: "logical", assessment_rev: a.rev, reason: "counterexample checked" });
    const st = await rpc("ben", "status", { rev: wrong.rev });
    expect(st.dimensions.logical.summary).toBe("refuted");
    expect(st.dimensions.logical.selection.curator).toBe("Rita");
    expect((await rpc("ben", "support", { rev: wrong.rev })).counter_evidence[0].negated).toMatch(/symmetric/);
  });

  it("8 — locate an error in a proof step, critique it, open a repair obligation, re-evaluate only that proof", async () => {
    const crit = await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "evaluation", title: "Gap in step s2", content: { context: { rev: ids.root }, payload: { eval_kind: "review", subject: { rev: ids.proof }, locator: "s2", scope: "step s2", findings: [{ dimension: "correctness", value: "defect_found", locator: "s2", text: "induction hypothesis too weak" }] }, provenance: human } });
    const repair = await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "research", title: "Repair step s2", content: { context: { rev: ids.root }, payload: { role: "obligation", goal: "Strengthen the induction", target: { rev: ids.proof }, closure_criterion: "new proof revision reviewed" }, provenance: human } });
    expect(repair.rev).toBeTruthy();
    const { draft_id } = await rpc("ben", "draftFromRevision", { revs: [ids.proof] });
    await edit("ben", draft_id, (c) => ({ ...c, payload: { ...c.payload, steps: [...c.payload.steps.slice(0, 1), { id: "s2", text: "induct with strengthened hypothesis", uses: [] }] }, change_summary: "repair s2" }));
    const repaired = (await rpc("ben", "seal", { drafts: [draft_id] })).revisions[0];
    const sup = await rpc("ben", "support", { rev: ids.claim });
    expect(sup.entries.find((e: any) => e.rev === ids.proof).status).toBe("defective");
    expect(sup.entries.find((e: any) => e.rev === repaired).status).toBe("unevaluated");
    expect((await rpc("ben", "status", { rev: ids.claim })).dimensions.logical.summary).not.toBe("refuted");
    void crit;
  });

  it("9 — obligation → bundle → attempt in narrative → closure proposal → decision", async () => {
    const b = await rpc("ben", "bundle", { rev: ids.obligation, profile: "collaborator" });
    expect(b.target.closure_criterion).toMatch(/accepted proof/);
    await rpc("ben", "transitionWork", { entity_id: ids.obligationEntity, to: "active", reason: "starting" });
    const att = await rpc("ben", "createAndSeal", { workspace_id: ids.ws, kind: "research", title: "Attempt via random restrictions", content: { context: { rev: ids.root }, payload: { role: "attempt", goal: "lower bound", target: { rev: ids.obligation }, attempt: { strategy: "switching lemma", steps: [{ id: "s1", text: "restrict" }], outputs: [{ rev: ids.proof }], result: "partial", artifacts: [{ rev: ids.proof }] } }, provenance: human } });
    const prop = await rpc("ben", "proposeClosure", { entity_id: ids.obligationEntity, artifact: att.rev, criterion: "accepted proof" });
    await rpc("rita", "decideClosure", { entity_id: ids.obligationEntity, proposal: prop.id, accepted: false, reason: "proof still has a defect", return_to: "active" });
    const st = await rpc("ben", "entity", { entity_id: ids.obligationEntity });
    expect(st.work.state).toBe("active");
    expect(st.work.closures[0].decision.accepted).toBe(false);
  });

  it("10 — import a formalization with environment; reported check ≠ reproduced; fidelity separate", async () => {
    const env = await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "context", title: "Lean 4 + Mathlib (pinned)", content: { context: { rev: ids.root }, payload: { foundations: "Lean 4 dependent type theory", execution: { kernel: "Lean 4.9", libraries: "Mathlib commit abc123" }, trust_boundary: "Lean kernel" }, provenance: { origin: "human", acquisition: "import", original_attribution: "Mathlib community" } } });
    const fs = await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "declaration", title: "Formal statement", content: { context: { rev: env.rev }, payload: { category: "propositional", statement: "formal parity bound", formal: { system: "Lean 4", text: "theorem parity_not_ac0 : ...", identifiers: ["parity_not_ac0"] } }, provenance: { origin: "human", acquisition: "import", original_attribution: "Mathlib community" } } });
    await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "relation", title: "formalizes", content: { context: { rev: env.rev }, payload: { contract: { id: "formalizes", version: "core@1" }, slots: [{ slot: "f", role: "formal", ref: { rev: fs.rev } }, { slot: "m", role: "meaning", ref: { rev: ids.claim2 } }], modality: "formal_mapping", interpretation: "Lean statement of the human claim", fields: { context_map: "Boolean circuits as Lean structures" } }, provenance: human } });
    await rpc("rita", "createAndSeal", { workspace_id: ids.ws, kind: "evaluation", title: "check report", content: { context: { rev: env.rev }, payload: { eval_kind: "assessment", subject: { rev: fs.rev }, dimension: "formalization", value: "check_pass_reported", scope: "CI log of Mathlib abc123", source_verdict: "build passed" }, provenance: { origin: "human", acquisition: "import", original_attribution: "Mathlib CI" } } });
    const f = await rpc("ana", "entity", { entity_id: (await rpc("ana", "revision", { rev: ids.claim2 })).entity_id, rev: ids.claim2 });
    expect(f.formalization.relations[0].contract.id).toBe("formalizes");
    expect(f.formalization.fidelity.summary).toBe("not_evaluated");
    expect((await rpc("ana", "status", { rev: fs.rev })).dimensions.formalization.summary).toBe("check_pass_reported");
  });

  it("11 — receive a dependency update, compare, and migrate consciously by a new consumer draft", async () => {
    const { draft_id } = await rpc("ana", "draftFromRevision", { revs: [ids.switching] });
    await edit("ana", draft_id, (c) => ({ ...c, payload: { ...c.payload, statement: c.payload.statement + " (with explicit constants)" }, change_summary: "constants" }));
    const sw2 = (await rpc("ana", "seal", { drafts: [draft_id] })).revisions[0];
    const notes = await rpc("ben", "notifications");
    const n = notes.find((x: any) => x.kind === "update_available" && x.payload.new_rev === sw2);
    expect(n.payload.consumer_rev).toBe(ids.proof);
    const mig = await rpc("ben", "draftFromRevision", { revs: [ids.proof], intent: "migrate to new switching lemma" });
    await edit("ben", mig.draft_id, (c) => ({ ...c, payload: { ...c.payload, steps: c.payload.steps.map((s: any) => ({ ...s, uses: s.uses.map((u: any) => (u.rev === ids.switching ? { rev: sw2 } : u)) })) } }));
    const migrated = (await rpc("ben", "seal", { drafts: [mig.draft_id] })).revisions[0];
    const uses = await rpc("ben", "revisionUsed", { rev: migrated, entity_id: (await rpc("ben", "revision", { rev: sw2 })).entity_id });
    expect(uses[0].rev).toBe(sw2);
    const old = await rpc("ben", "revisionUsed", { rev: ids.proof, entity_id: (await rpc("ben", "revision", { rev: sw2 })).entity_id });
    expect(old[0].rev).toBe(ids.switching);
  });

  it("12 — compute impact for an event and open a re-evaluation obligation from it", async () => {
    const imp = await rpc("ana", "impact", { rev: ids.switching, change: "defect" });
    const rec = imp.definitely_affected.find((r: any) => r.target.rev === ids.proof);
    expect(rec.dimension).toBe("derivation");
    const ob = await rpc("ana", "createAndSeal", { workspace_id: ids.ws, kind: "research", title: "Re-evaluate proof", content: { context: { rev: ids.root }, payload: { role: "obligation", goal: rec.reason, target: { rev: rec.target.rev }, closure_criterion: "new correctness assessment" }, provenance: human } });
    expect(ob.rev).toBeTruthy();
  });

  it("13 — a private inquiry line from a selection; only its owner sees it", async () => {
    const line = await rpc("ben", "createAndSeal", { workspace_id: ids.ws, kind: "research", title: "Private: depth-3 variant", access: { mode: "owner" }, content: { context: { rev: ids.root }, payload: { role: "inquiry_line", goal: "try depth 3", selection: [{ rev: ids.claim2 }, { rev: ids.switching }], baseline: "claim r2, switching r1" }, provenance: human } });
    await expect(rpc("ana", "entity", { entity_id: line.entity_id })).rejects.toMatchObject({ code: "not_found" });
    expect((await rpc("ben", "entity", { entity_id: line.entity_id })).revision.content.payload.selection).toHaveLength(2);
  });

  it("14 — partial publication: preview closure, add what it needs, publish self-contained scope", async () => {
    const pre = await rpc("rita", "exposurePreview", { revs: [ids.relation], audience: { mode: "public" } });
    const needed = pre.conflicts.map((c: any) => c.rev).filter(Boolean);
    expect(needed).toContain(ids.parityBound);
    await expect(rpc("rita", "publish", { workspace_id: ids.ws, revs: [ids.relation, ...needed], audience: { mode: "public" }, license: "CC BY 4.0" })).rejects.toMatchObject({ code: "exposure_conflict" }); // imported material: rights confirmation
    const p = await rpc("rita", "publish", { workspace_id: ids.ws, revs: [ids.relation, ...needed], audience: { mode: "public" }, license: "CC BY 4.0", rights_confirmed: true, title: "Parity lower bound connection" });
    expect(p.status).toBe("published");
    const anonymous = await rpc(null, "revision", { rev: ids.relation });
    expect(anonymous.content.payload.contract.id).toBe("entails");
    expect((await rpc(null, "usedBy", { rev: ids.parityBound })).total).toBe(1);
  });

  it("15 — an agent proposal waits in the inbox; a human inspects and decides; the agent cannot", async () => {
    const ag = await rpc("ana", "createAiAgent", { name: "Extractor" });
    tokens.agent = ag.token;
    await rpc("ana", "addMember", { workspace_id: ids.ws, agent_id: ag.agent_id, roles: ["reader"] });
    const c = await rpc("agent", "submitCandidate", { workspace_id: ids.ws, kind: "relation", title: "Suggested: switching lemma supports claim", content: { context: { rev: ids.root }, payload: { contract: { id: "supports", version: "core@1" }, slots: [{ slot: "e", role: "evidence", ref: { rev: ids.switching } }, { slot: "t", role: "target", ref: { rev: ids.claim2 } }], modality: "heuristic", interpretation: "suggested by co-occurrence" }, provenance: { origin: "ai", acquisition: "inference", ai_run: { model: "unknown", provider: "unknown", version: "unknown" } } } });
    await expect(rpc("agent", "promote", { candidate_rev: c.rev, scope: "x", decision: "y" })).rejects.toMatchObject({ code: "gate_missing" });
    expect((await rpc("rita", "candidateQueue", { workspace_id: ids.ws })).find((x: any) => x.rev === c.rev).gate.state).toBe("proposed");
    await rpc("rita", "gateTransition", { entity_id: c.entity_id, to: "rejected", reason: "co-occurrence is not support" });
    expect((await rpc("rita", "candidateQueue", { workspace_id: ids.ws })).find((x: any) => x.rev === c.rev).gate.state).toBe("rejected");
  });
});
