// Test world: a platform with a monotonic fake clock, four humans, one AI agent and a
// workspace. Fixtures are optional and loaded through the same candidate → gate path as
// production imports.
import { Platform } from "../src/core/platform.ts";
import { loadFixture, type LoadResult } from "../src/fixtures/load.ts";
import { CROSS_DOMAIN_FIXTURE, PVNP_FIXTURE } from "../src/fixtures/corpus.ts";
import type { Fixture } from "../src/fixtures/dsl.ts";

export interface World {
  p: Platform;
  ana: string; // owner
  ben: string; // editor + reviewer
  rita: string; // curator, editor, reviewer, publisher
  carl: string; // outsider (no membership)
  ai: string; // AI agent operated by ana, member as reader
  ws: string;
  root: string;
  fx: LoadResult | null;
  tick: (ms?: number) => void;
  now: () => string;
  call: (actor: string | null, method: string, args?: any) => any;
  decl: (actor: string, title: string, statement: string, opts?: { context?: string; category?: string; access?: any; assumptions?: any[]; variables?: any[]; roles?: string[] }) => { entity_id: string; rev: string };
  arg: (actor: string, title: string, targets: string[], opts?: { uses?: string[]; kind?: string; completeness?: string; refs?: any[]; context?: string; access?: any }) => { entity_id: string; rev: string };
  rel: (actor: string, title: string, contract: string, slots: [string, string, string?][], opts?: { grouping?: any; fields?: any; hypotheses?: any[]; modality?: string; context?: string; witness_not_provided?: boolean; access?: any; version?: string }) => { entity_id: string; rev: string };
  assess: (actor: string, subject: string, dimension: string, value: string, opts?: { scope?: string; evidence?: string[]; locator?: string; reason?: string }) => { entity_id: string; rev: string };
  review: (actor: string, subject: string, findings: { dimension: string; value: string; locator?: string; text?: string }[], opts?: { evidence?: string[]; scope?: string }) => { entity_id: string; rev: string };
}

export function makeWorld(opts: { fixture?: Fixture | "pvnp" | "cross" | null } = {}): World {
  let t = Date.parse("2026-10-01T09:00:00Z");
  const p = new Platform({ clock: () => new Date((t += 1)) });
  const tick = (ms = 1000) => {
    t += ms;
  };
  const now = () => new Date(t).toISOString();
  const ana = p.createHuman("ana", "Ana").agent_id;
  const ben = p.createHuman("ben", "Ben").agent_id;
  const rita = p.createHuman("rita", "Rita").agent_id;
  const carl = p.createHuman("carl", "Carl").agent_id;
  const ai = p.call("createAiAgent", ana, { name: "Agent" }).agent_id;
  const { workspace_id: ws, root_context_rev: root } = p.call("createWorkspace", ana, { name: "W" });
  p.call("addMember", ana, { workspace_id: ws, agent_id: ben, roles: ["editor", "reviewer"] });
  p.call("addMember", ana, { workspace_id: ws, agent_id: rita, roles: ["curator", "editor", "reviewer", "publisher"] });
  p.call("addMember", ana, { workspace_id: ws, agent_id: ai, roles: ["reader"] });
  const fixture = opts.fixture === "pvnp" ? PVNP_FIXTURE : opts.fixture === "cross" ? CROSS_DOMAIN_FIXTURE : (opts.fixture ?? null);
  const fx = fixture ? loadFixture(p, { workspace_id: ws, curator: rita, agent: ai, fixture }) : null;
  const call = (actor: string | null, method: string, args: any = {}) => p.call(method, actor, args);
  const prov = { origin: "human", acquisition: "authorship" };
  const seal = (actor: string, kind: string, title: string, context: string | undefined, payload: any, extra: any = {}) =>
    call(actor, "createAndSeal", { workspace_id: ws, kind, title, access: extra.access, content: { context: { rev: context ?? root }, payload, provenance: prov, references: extra.references ?? [] } });
  return {
    p,
    ana,
    ben,
    rita,
    carl,
    ai,
    ws,
    root,
    fx,
    tick,
    now,
    call,
    decl: (actor, title, statement, o = {}) =>
      seal(actor, "declaration", title, o.context, { category: o.category ?? "propositional", statement, assumptions: o.assumptions ?? [], variables: o.variables ?? [], editorial_roles: o.roles ?? [] }, { access: o.access }),
    arg: (actor, title, targets, o = {}) =>
      seal(
        actor,
        "argument",
        title,
        o.context,
        {
          targets: targets.map((rev) => ({ rev })),
          argument_kind: o.kind ?? "natural_language_proof",
          completeness: o.completeness ?? "complete",
          steps: (o.uses ?? []).map((u, i) => ({ id: `s${i + 1}`, text: `use ${u}`, uses: [{ rev: u }] })),
        },
        { references: o.refs, access: o.access },
      ),
    rel: (actor, title, contract, slots, o = {}) =>
      seal(
        actor,
        "relation",
        title,
        o.context,
        {
          contract: { id: contract, version: o.version ?? "core@1" },
          slots: slots.map(([slot, role, rev]) => ({ slot, role, ref: { rev: rev! } })),
          grouping: o.grouping ?? {},
          hypotheses: o.hypotheses ?? [],
          modality: o.modality ?? "logical",
          interpretation: title,
          fields: o.fields ?? {},
          witness_not_provided: o.witness_not_provided,
        },
        { access: o.access },
      ),
    assess: (actor, subject, dimension, value, o = {}) =>
      seal(actor, "evaluation", `${dimension} of ${subject}`, undefined, { eval_kind: "assessment", subject: { rev: subject }, dimension, value, scope: o.scope ?? "test scope", evidence: (o.evidence ?? []).map((rev) => ({ rev })), locator: o.locator, reason: o.reason }),
    review: (actor, subject, findings, o = {}) =>
      seal(actor, "evaluation", `review of ${subject}`, undefined, { eval_kind: "review", subject: { rev: subject }, scope: o.scope ?? "test scope", findings, evidence: (o.evidence ?? []).map((rev) => ({ rev })) }),
  };
}

/** Expect a domain error with a given code. */
export function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e: any) {
    return e.code ?? "unknown";
  }
}
