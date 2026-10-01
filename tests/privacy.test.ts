// Visibility, publication, exposure closure, embargo, redaction, governance and bundles for
// other readers (§18, §22, §28; AC30, AC33–AC40, AC42, AC58).
import { describe, expect, it } from "vitest";
import { codeOf, makeWorld } from "./helpers.ts";

const pub = (w: ReturnType<typeof makeWorld>, revs: string[], extra: any = {}) =>
  w.call(w.rita, "publish", { workspace_id: w.ws, revs, audience: { mode: "public" }, license: "CC BY 4.0", ...extra });

describe("publication and exposure", () => {
  it("AC30: a published package keeps its manifest and narrative; updating a component does not alter it", () => {
    const w = makeWorld();
    const s = w.decl(w.ana, "S", "s holds");
    const coll = w.call(w.ana, "createAndSeal", {
      workspace_id: w.ws,
      kind: "collection",
      title: "Paper",
      content: { context: { rev: w.root }, payload: { purpose: "paper", narrative: [{ id: "b1", type: "prose", text: "We show:" }, { id: "b2", type: "transclusion", ref: { rev: s.rev } }], manifest: [{ slot: "m1", ref: { rev: s.rev }, relation: "has_part", role: "main result" }] }, provenance: { origin: "human", acquisition: "authorship" } },
    });
    const p = pub(w, [w.root, s.rev, coll.rev], { title: "Paper" });
    const { draft_id } = w.call(w.ana, "draftFromRevision", { revs: [s.rev] });
    w.call(w.ana, "seal", { drafts: [draft_id] });
    const m = w.call(null, "entity", { entity_id: coll.entity_id }).manifest;
    expect(m.items[0].rev).toBe(s.rev);
    expect(m.narrative[1].rev).toBe(s.rev);
    expect(m.items[0].relation_class).toBe("editorial");
    const exp = w.call(null, "exportPublication", { publication_id: p.publication_id });
    expect(exp.revisions.map((r: any) => r.id)).toEqual(expect.arrayContaining([s.rev, coll.rev]));
    expect(exp.publication.revs).toEqual([w.root, s.rev, coll.rev]);
  });

  it("AC33/AC34: a public publication needing private material is blocked with an editor-only explanation; outsiders learn nothing", () => {
    const w = makeWorld();
    const lemma = w.decl(w.rita, "Secret lemma", "an unpublished lemma");
    const t = w.call(w.rita, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title: "Theorem T", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "T holds" }, references: [{ ref: { rev: lemma.rev }, purpose: "explicit_informal" }], provenance: { origin: "human", acquisition: "authorship" } } });
    let err: any;
    try {
      pub(w, [w.root, t.rev]);
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("exposure_conflict");
    expect(err.details.conflicts[0].rev).toBe(lemma.rev); // explained to the publisher, who can see it
    // A team member without access to an owner-only item gets no ID/title for it.
    const priv = w.decl(w.ben, "Ben private", "private note", { access: { mode: "owner" } });
    const view = w.call(w.ana, "exposurePreview", { revs: [t.rev], audience: { mode: "public" } });
    expect(view.ok).toBe(false);
    expect(() => w.call(w.ana, "revision", { rev: priv.rev })).toThrow();
    // Outsiders: private and absent IDs are indistinguishable everywhere.
    const probe = (rev: string) => {
      try {
        w.call(w.carl, "revision", { rev });
      } catch (e: any) {
        return `${e.code}:${e.message}`;
      }
    };
    expect(probe(lemma.rev)).toBe(probe("rev_doesnotexist000"));
    const probeAnon = (fn: () => unknown) => codeOf(fn);
    expect(probeAnon(() => w.call(null, "entity", { entity_id: t.entity_id }))).toBe(probeAnon(() => w.call(null, "entity", { entity_id: "ent_nope" })));
    expect(probeAnon(() => w.call(null, "impact", { rev: t.rev, change: "retracted" }))).toBe("not_found");
    expect(w.call(w.carl, "search", { text: "Secret" }).results).toHaveLength(0);
    expect(w.call(null, "publications", {})).toHaveLength(0);
    expect(codeOf(() => w.call(w.carl, "exportWorkspace", { workspace_id: w.ws }))).toBe("not_found");
    // Publishing both works; public sees T and the lemma but not private provenance lineage.
    pub(w, [w.root, lemma.rev, t.rev]);
    expect(w.call(null, "revision", { rev: t.rev }).content.payload.statement).toBe("T holds");
    expect(w.call(null, "usedBy", { rev: lemma.rev }).total).toBe(1);
  });

  it("AC35: only the authorized selection is visible; private relations to public items, raw prompts and private lineage do not escape", () => {
    const w = makeWorld();
    const pubS = w.decl(w.ana, "Public S", "s");
    pub(w, [w.root, pubS.rev]);
    // Ben's private branch references the public statement.
    const line = w.call(w.ben, "createAndSeal", { workspace_id: w.ws, kind: "research", title: "Ben's line", access: { mode: "owner" }, content: { context: { rev: w.root }, payload: { role: "inquiry_line", goal: "explore", selection: [{ rev: pubS.rev }] }, provenance: { origin: "human", acquisition: "authorship" } } });
    const teamRel = w.rel(w.ana, "team-only support", "supports", [["e", "evidence", w.decl(w.ana, "E", "e").rev], ["t", "target", pubS.rev]]);
    expect(w.call(null, "usedBy", { rev: pubS.rev }).total).toBe(0);
    expect(w.call(null, "support", { rev: pubS.rev }).entries).toHaveLength(0);
    expect(w.call(null, "localGraph", { rev: pubS.rev }).nodes).toHaveLength(1);
    expect(w.call(w.ana, "usedBy", { rev: pubS.rev }).total).toBe(1); // team sees its relation, not Ben's private line
    expect(Object.values(w.call(w.ben, "usedBy", { rev: pubS.rev }).by_kind).flat().map((e: any) => e.rev).sort()).toEqual([line.rev, teamRel.rev].sort());
    expect(codeOf(() => w.call(w.ana, "entity", { entity_id: line.entity_id }))).toBe("not_found");
    // Raw AI configuration (e.g. prompts) stays in the workspace ledger.
    const cand = w.call(w.ai, "submitCandidate", { workspace_id: w.ws, kind: "declaration", title: "AI claim", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "ai" }, provenance: { origin: "ai", acquisition: "authorship", ai_run: { model: "m", provider: "p", version: "1", config: "SECRET PROMPT" } } } });
    const cur = w.call(w.rita, "promote", { candidate_rev: cand.rev, scope: "claim admitted as AI proposal", decision: "admit" });
    pub(w, [cur.curated_rev]);
    const outside = w.call(null, "revision", { rev: cur.curated_rev });
    expect(JSON.stringify(outside)).not.toMatch(/SECRET PROMPT/);
    expect(outside.content.provenance.ai_run.model).toBe("m");
    expect(outside.content.provenance.derived_from_candidate).toBeUndefined(); // candidate is private
    expect(w.call(w.ana, "revision", { rev: cur.curated_rev }).content.provenance.ai_run.config).toBe("SECRET PROMPT");
  });

  it("AC36: an embargo reaching its date without authorization or valid closure is not published; the publisher sees why", () => {
    const w = makeWorld();
    const s = w.decl(w.ana, "Embargoed", "e");
    const release = new Date(Date.parse(w.now()) + 3600_000).toISOString();
    const p1 = w.call(w.rita, "publish", { workspace_id: w.ws, revs: [w.root, s.rev], audience: { mode: "public" }, license: "CC BY", embargo: { release_at: release, release_authorized: false } });
    expect(p1.status).toBe("scheduled");
    w.tick(2 * 3600_000);
    const res = w.call(w.rita, "processEmbargoes", {});
    expect(res[0].status).toBe("blocked");
    expect(codeOf(() => w.call(null, "revision", { rev: s.rev }))).toBe("not_found");
    expect(w.call(w.rita, "notifications", {}).some((n: any) => n.kind === "embargo_blocked" && /not authorized/.test(n.payload.reason))).toBe(true);
    // Authorized, but closure now fails (a referenced item narrowed): re-validated at release.
    const t = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title: "T2", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "t2" }, references: [{ ref: { rev: s.rev }, purpose: "explicit_informal" }], provenance: { origin: "human", acquisition: "authorship" } } });
    const release2 = new Date(Date.parse(w.now()) + 3600_000).toISOString();
    const p2 = w.call(w.rita, "publish", { workspace_id: w.ws, revs: [w.root, s.rev, t.rev], audience: { mode: "public" }, license: "CC BY", embargo: { release_at: release2, release_authorized: true } });
    w.call(w.ana, "revokeMember", { workspace_id: w.ws, agent_id: w.rita, reason: "left the team" });
    w.tick(2 * 3600_000);
    const res2 = w.call(w.ana, "processEmbargoes", {});
    expect(res2.find((r: any) => r.publication === p2.publication_id).status).toBe("blocked");
    expect(codeOf(() => w.call(null, "revision", { rev: t.rev }))).toBe("not_found");
  });

  it("AC37/AC58: redaction/derivation creates a new anchor; the original is unchanged and its ID never reaches public viewers", () => {
    const w = makeWorld();
    const notes = w.call(w.ben, "createAndSeal", { workspace_id: w.ws, kind: "collection", title: "Private notes", access: { mode: "owner" }, content: { context: { rev: w.root }, payload: { purpose: "narrative", narrative: [{ id: "b1", type: "prose", text: "Idea with confidential client data X." }] }, provenance: { origin: "human", acquisition: "authorship" } } });
    const der = w.call(w.ben, "deriveEntity", { rev: notes.rev, reason: "public version without client data" });
    const d = w.call(w.ben, "draft", { draft_id: der.draft_id });
    w.call(w.ben, "saveDraft", { draft_id: der.draft_id, generation: d.generation, content: { ...d.content, title: "Public notes", payload: { ...d.content.payload, narrative: [{ id: "b1", type: "prose", text: "Idea (redacted)." }] } } });
    const pubRev = w.call(w.ben, "seal", { drafts: [der.draft_id] }).revisions[0];
    pub(w, [w.root, pubRev]);
    const seen = w.call(null, "revision", { rev: pubRev });
    expect(seen.parents).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain(notes.rev);
    expect(JSON.stringify(seen)).not.toContain(notes.entity_id);
    expect(JSON.stringify(w.call(null, "timeline", { entity_id: der.entity_id }))).not.toContain(notes.rev);
    // The private ledger keeps the mapping for workspace members.
    expect(w.call(w.ana, "timeline", { entity_id: der.entity_id }).some((e: any) => e.kind === "lineage" && e.payload.from_rev === notes.rev)).toBe(true);
    expect(w.call(w.ben, "revision", { rev: notes.rev }).content.payload.narrative[0].text).toMatch(/confidential/);
    // A derived proof still needing a private premise cannot be published as complete.
    const prem = w.decl(w.ben, "Private premise", "p", { access: { mode: "owner" } });
    const proof = w.call(w.ben, "createAndSeal", { workspace_id: w.ws, kind: "argument", title: "Proof needing premise", access: { mode: "owner" }, content: { context: { rev: w.root }, payload: { targets: [{ rev: pubRev }], argument_kind: "natural_language_proof", completeness: "complete", steps: [{ id: "s1", text: "use premise", uses: [{ rev: prem.rev }] }] }, provenance: { origin: "human", acquisition: "authorship" } } });
    const der2 = w.call(w.ben, "deriveEntity", { rev: proof.rev, reason: "public proof" });
    expect(codeOf(() => w.call(w.ben, "seal", { drafts: [der2.draft_id] }))).toBe("exposure_conflict");
  });
});

describe("governance", () => {
  it("AC38: moderation, retraction, appeal and restoration are attributable events; nothing disappears", () => {
    const w = makeWorld();
    w.call(w.ana, "addMember", { workspace_id: w.ws, agent_id: w.carl, roles: ["moderator"] });
    const s = w.decl(w.ana, "Contested", "c");
    pub(w, [w.root, s.rev]);
    w.call(w.carl, "recordValidity", { rev: s.rev, action: "availability_restricted", scope: "platform", reason: "legal request" });
    const anon = w.call(null, "revision", { rev: s.rev });
    expect(anon.withheld.reason).toBe("legal request");
    expect(anon.withheld.tombstone.revision).toBe(s.rev);
    expect(anon.content).toBeNull();
    expect(w.call(w.carl, "revision", { rev: s.rev }).content).not.toBeNull();
    expect(codeOf(() => w.call(w.ben, "recordValidity", { rev: s.rev, action: "availability_restricted", scope: "x", reason: "y" }))).toBe("insufficient_permission");
    const c1 = w.call(w.ben, "governanceCase", { case_kind: "dispute", action: "opened", subject_rev: s.rev, reason: "the restriction is unjustified" });
    expect(codeOf(() => w.call(w.ben, "governanceCase", { case_kind: "dispute", action: "decided_for_policy", subject_rev: s.rev, case_id: c1.case_id, reason: "x" }))).toBe("insufficient_permission");
    w.call(w.carl, "governanceCase", { case_kind: "dispute", action: "decided_for_policy", subject_rev: s.rev, case_id: c1.case_id, reason: "restriction upheld" });
    w.call(w.ben, "governanceCase", { case_kind: "dispute", action: "appealed", subject_rev: s.rev, case_id: c1.case_id, reason: "new evidence" });
    expect(codeOf(() => w.call(w.ben, "governanceCase", { case_kind: "dispute", action: "opened", subject_rev: s.rev, case_id: c1.case_id, reason: "x" }))).toBe("invalid_transition");
    w.call(w.carl, "recordValidity", { rev: s.rev, action: "restored", restores: "availability_restricted", scope: "platform", reason: "appeal granted" });
    w.call(w.ana, "recordValidity", { rev: s.rev, action: "retracted", scope: "author", reason: "author withdraws claim" });
    const st = w.call(null, "status", { rev: s.rev });
    expect(st.dimensions.validity.summary).toBe("retracted");
    expect(st.dimensions.logical.summary).toBe("not_evaluated"); // retraction ≠ falsehood
    expect(st.dimensions.disputes.summary).toBe("appealed");
    expect(w.call(null, "revision", { rev: s.rev }).content.payload.statement).toBe("c");
    const tl = w.call(w.ana, "timeline", { entity_id: s.entity_id }).map((e: any) => e.kind);
    expect(tl).toEqual(expect.arrayContaining(["validity", "governance", "published"]));
  });

  it("AC39: stewardship changes by abandonment with an event; contributions of the historical author stay intact", () => {
    const w = makeWorld();
    const s = w.call(w.ben, "createAndSeal", { workspace_id: w.ws, kind: "declaration", title: "Ben's result", content: { context: { rev: w.root }, payload: { category: "propositional", statement: "b" }, provenance: { origin: "human", acquisition: "authorship" }, contributions: [{ agent: w.ben, roles: ["discovery", "proof"], character: "claimed" }] } });
    expect(codeOf(() => w.call(w.ana, "recoverStewardship", { entity_id: s.entity_id, reason: "x" }))).toBe("invalid_transition");
    w.call(w.ana, "revokeMember", { workspace_id: w.ws, agent_id: w.ben, reason: "inactive" });
    w.call(w.ana, "recoverStewardship", { entity_id: s.entity_id, reason: "steward inactive for a year" });
    const v = w.call(w.ana, "entity", { entity_id: s.entity_id });
    expect(v.entity.steward.name).toBe("Ana");
    const credit = v.contributions.contributions.find((c: any) => c.agent?.name === "Ben" && c.roles.includes("discovery"));
    expect(credit.character).toBe("claimed");
    w.call(w.ana, "proposeStewardship", { entity_id: s.entity_id, to: w.rita, reason: "handover" });
    expect(codeOf(() => w.call(w.ben, "acceptStewardship", { entity_id: s.entity_id }))).toBe("invalid_transition");
    w.call(w.rita, "acceptStewardship", { entity_id: s.entity_id });
    expect(w.call(w.ana, "entity", { entity_id: s.entity_id }).entity.steward.name).toBe("Rita");
  });

  it("AC40: merge/split maps and identity disputes are recorded; references are not reassigned", () => {
    const w = makeWorld();
    const a = w.decl(w.ana, "Old combined lemma", "A and B");
    const a1 = w.decl(w.ana, "Part A", "A");
    const b1 = w.decl(w.ana, "Part B", "B");
    const user = w.arg(w.ben, "uses old", [w.decl(w.ben, "Goal", "g").rev], { uses: [a.rev] });
    w.call(w.rita, "recordIdentityMap", { workspace_id: w.ws, action: "split", from: [a.entity_id], to: [a1.entity_id, b1.entity_id], mapping: [{ from: `${a.rev}#A`, to: a1.entity_id }, { from: `${a.rev}#B`, to: b1.entity_id }], reason: "separate citations" });
    expect(w.call(w.ana, "revisionUsed", { rev: user.rev, entity_id: a.entity_id })[0].rev).toBe(a.rev);
    const rec = w.call(w.ana, "identityRecords", { entity_id: a.entity_id });
    expect(rec[0].action).toBe("split");
    expect(rec[0].mapping).toHaveLength(2);
    const c = w.call(w.ben, "governanceCase", { case_kind: "identity", action: "opened", subject_rev: a1.rev, reason: "Part A is the same concept as an existing lemma" });
    expect(c.case_id).toBeTruthy();
    const exp = w.call(w.ana, "exportWorkspace", { workspace_id: w.ws });
    expect(exp.events.some((e: any) => e.kind === "identity" && e.payload.action === "split")).toBe(true);
    expect(exp.entities.map((e: any) => e.id)).toEqual(expect.arrayContaining([a.entity_id, a1.entity_id, b1.entity_id]));
  });

  it("AC42: a bundle for another reader never leaks hidden slots and does not claim completeness", () => {
    const w = makeWorld();
    const target = w.decl(w.ana, "Target", "target statement");
    const ob = w.call(w.ana, "createAndSeal", { workspace_id: w.ws, kind: "research", title: "Prove target", content: { context: { rev: w.root }, payload: { role: "obligation", goal: "prove it", target: { rev: target.rev }, closure_criterion: "accepted proof" }, provenance: { origin: "human", acquisition: "authorship" } } });
    const secret = w.call(w.ben, "createAndSeal", { workspace_id: w.ws, kind: "argument", title: "Ben's hidden attempt", access: { mode: "owner" }, content: { context: { rev: w.root }, payload: { targets: [{ rev: target.rev }], argument_kind: "sketch", completeness: "sketch" }, provenance: { origin: "human", acquisition: "authorship" } } });
    w.call(w.rita, "publish", { workspace_id: w.ws, revs: [w.root, target.rev, ob.rev], audience: { mode: "named", agents: [w.carl] }, license: "internal review" });
    const forCarl = w.call(w.carl, "bundle", { rev: ob.rev, profile: "ai" });
    expect(forCarl.coverage).toBe("visible_scope_only");
    expect(JSON.stringify(forCarl)).not.toContain(secret.rev);
    expect(JSON.stringify(forCarl)).not.toMatch(/hidden attempt/);
    const forBen = w.call(w.ben, "bundle", { rev: ob.rev, profile: "mathematician" });
    expect(forBen.items.map((i: any) => i.rev)).toContain(secret.rev);
  });
});
