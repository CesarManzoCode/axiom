// Demo seed: three researchers, two AI agents, and two workspaces loaded with the handoff
// fixtures (§29–30). Fixtures arrive as candidates from the transcription agent and are admitted
// by a human curator's batch gate decision. Run: npm run seed  (AXIOM_DB to choose the file).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Platform } from "../core/platform.ts";
import { loadFixture } from "../fixtures/load.ts";
import { CROSS_DOMAIN_FIXTURE, PVNP_FIXTURE } from "../fixtures/corpus.ts";

export const DEMO_PASSWORD = "axiom-demo";

export function seed(p: Platform) {
  if (p.k.db.get("select 1 from agents where handle = 'ana'")) return { skipped: true };
  const ana = p.createHuman("ana", "Ana Ruiz", DEMO_PASSWORD).agent_id;
  const ben = p.createHuman("ben", "Ben Okafor", DEMO_PASSWORD).agent_id;
  const rita = p.createHuman("rita", "Rita Lind", DEMO_PASSWORD).agent_id;
  const transcriber = p.call("createAiAgent", ana, { name: "Handoff transcription assistant", model: "unknown", provider: "unknown" }).agent_id;
  p.call("createAiAgent", ana, { name: "Extraction assistant", model: "unknown", provider: "unknown" });

  const pvnp = p.call("createWorkspace", ana, { name: "P vs NP — research sample", description: "Handoff §29 corpus: definitions, barriers, routes, obligations and failed attempts. Literature rows are transcriptions attributed to their sources; O*/FA01/… are synthetic product scenarios." }).workspace_id;
  p.call("addMember", ana, { workspace_id: pvnp, agent_id: ben, roles: ["editor", "reviewer"], reason: "collaborator" });
  p.call("addMember", ana, { workspace_id: pvnp, agent_id: rita, roles: ["curator", "editor", "reviewer", "publisher"], reason: "curator" });
  p.call("addMember", ana, { workspace_id: pvnp, agent_id: transcriber, roles: ["reader"], reason: "transcription agent submits candidates" });
  const fx = loadFixture(p, { workspace_id: pvnp, curator: rita, agent: transcriber, fixture: PVNP_FIXTURE });

  const cross = p.call("createWorkspace", ana, { name: "Cross-domain sample", description: "Handoff §30: topology, analysis, number theory/computation, foundations, formalization." }).workspace_id;
  p.call("addMember", ana, { workspace_id: cross, agent_id: rita, roles: ["curator", "editor", "reviewer", "publisher"], reason: "curator" });
  p.call("addMember", ana, { workspace_id: cross, agent_id: ben, roles: ["reader"], reason: "reader" });
  p.call("addMember", ana, { workspace_id: cross, agent_id: transcriber, roles: ["reader"], reason: "transcription agent submits candidates" });
  loadFixture(p, { workspace_id: cross, curator: rita, agent: transcriber, fixture: CROSS_DOMAIN_FIXTURE });

  // A reading narrative with exact transclusions (workflow 1/3).
  const ctx = fx.rev("C0");
  const blocks = [
    { id: "h1", type: "heading", text: "Routes toward P ≠ NP and what blocks them" },
    { id: "p1", type: "prose", text: "The question is fixed in the classical context C0. Two reformulations matter for planning:" },
    { id: "t1", type: "transclusion", ref: { rev: fx.rev("P19") } },
    { id: "t2", type: "transclusion", ref: { rev: fx.rev("P25") } },
    { id: "p2", type: "prose", text: "Three barriers restrict families of techniques — each only where applicability was shown:" },
    { id: "t3", type: "transclusion", ref: { rev: fx.rev("P45") } },
    { id: "t4", type: "transclusion", ref: { rev: fx.rev("P51") } },
    { id: "t5", type: "transclusion", ref: { rev: fx.rev("P57") } },
    { id: "p3", type: "prose", text: "The working objective and its candidate routes live in the research cockpit:" },
    { id: "t6", type: "transclusion", ref: { rev: fx.rev("O01") } },
  ];
  p.call("createAndSeal", ana, {
    workspace_id: pvnp,
    kind: "collection",
    title: "Reading notes: routes and barriers",
    facets: ["collection", "narrative"],
    content: {
      context: { rev: ctx },
      payload: { purpose: "narrative", description: "Narrative with exact transclusions", narrative: blocks, manifest: blocks.filter((b) => b.ref).map((b, i) => ({ slot: `m${i + 1}`, ref: b.ref, role: "transcluded statement", relation: "references" })) },
      provenance: { origin: "human", acquisition: "authorship" },
      contributions: [{ agent: ana, roles: ["exposition"], character: "claimed" }],
    },
  });

  // A public package: the root context, C0 and the definitional core P01–P09.
  const pub = ["ROOT", "C0", "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09"].map((k) => fx.rev(k));
  p.call("publish", rita, { workspace_id: pvnp, revs: pub, audience: { mode: "public" }, license: "CC BY 4.0 (paraphrase and citation; source texts not republished)", title: "Definitions of P and NP and their equivalence", rights_confirmed: true });

  // A private inquiry line by Ben referencing public material (workflow 13).
  p.call("createAndSeal", ben, {
    workspace_id: pvnp,
    kind: "research",
    title: "Private line: can P37-style algorithms reach ACC∘THR?",
    access: { mode: "owner" },
    content: {
      context: { rev: fx.rev("CW") },
      payload: { role: "inquiry_line", goal: "Explore whether faster SAT algorithms for a more expressive class C would extend P38's conclusion", selection: [{ rev: fx.rev("P37") }, { rev: fx.rev("P38") }, { rev: fx.rev("O08") }], baseline: "P38@r1, O08@r1" },
      provenance: { origin: "human", acquisition: "authorship" },
    },
  });
  return { skipped: false, accounts: ["ana", "ben", "rita"], password: DEMO_PASSWORD };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.AXIOM_DB ?? "data/axiom.sqlite";
  mkdirSync(dirname(dbPath), { recursive: true });
  const p = new Platform({ path: dbPath });
  console.log(seed(p));
}
