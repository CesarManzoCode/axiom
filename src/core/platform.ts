// Platform facade: authentication plus a typed method table. Each method validates its
// arguments at the boundary (zod) and delegates to the domain modules. The HTTP layer and
// tests both go through `call`, so permissions are enforced in one place.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { j, newId, sha256 } from "./db.ts";
import { DomainError, Kernel, notFound } from "./kernel.ts";
import * as A from "./authoring.ts";
import * as C from "./candidates.ts";
import * as S from "./state.ts";
import * as P from "./publication.ts";
import * as Q from "./queries.ts";
import * as G from "./governance.ts";
import * as X from "./portable.ts";
import { impact } from "./impact.ts";
import { computeBundle, sealBundle } from "./bundle.ts";
import { compareRevisions } from "./diff.ts";
import { barrierApplicability, blockingObligations, cockpit, failedAttempts, plansFor, routeStatus } from "./research.ts";
import { POLICIES, statusVector, supportOf } from "./status.ts";
import { CHANGE_CLASSES, CORE_CONTRACTS, PAYLOAD_KINDS, ROLES, VALIDITY_ACTIONS, WORK_STATES, GATE_STATES, STATUS_VALUES, FINDING_VALUES, PLAN_MODALITIES, DEP_KINDS, CONTRIBUTION_ROLES, EDITORIAL_ROLES, ARGUMENT_KINDS, RESEARCH_ROLES, FAILURE_KINDS } from "./vocab.ts";
import { pj } from "./db.ts";

const id = z.string().min(1);
const audience = z.object({ mode: z.enum(["owner", "team", "named", "public"]), agents: z.array(z.string()).optional() });
const scope = {
  policy: z.enum(Object.keys(POLICIES) as [keyof typeof POLICIES, ...(keyof typeof POLICIES)[]]).optional(),
  cut: z.string().optional(),
  include_candidates: z.boolean().optional(),
};
const content = z.record(z.string(), z.any());

type Ctx = { k: Kernel; actor: string | null };
interface Method<S extends z.ZodTypeAny> {
  args: S;
  auth: boolean;
  run: (ctx: Ctx, args: z.infer<S>) => unknown;
}
const m = <S extends z.ZodTypeAny>(args: S, run: (ctx: Ctx, a: z.infer<S>) => unknown, auth = true): Method<S> => ({ args, run, auth });
const me = (c: Ctx) => c.actor as string;
const v = (c: Ctx) => c.k.viewer(c.actor);

function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const got = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(got, Buffer.from(hash, "hex"));
}

function issueToken(k: Kernel, agentId: string) {
  const token = randomBytes(24).toString("hex");
  k.db.run("insert into sessions(token_hash, agent_id, created_at) values(?,?,?)", sha256(token), agentId, k.now());
  return token;
}

export const METHODS = {
  // ---------------------------------------------------------------- agents & auth
  register: m(
    z.object({ handle: z.string().regex(/^[a-z0-9_.-]{2,32}$/), name: z.string().min(1), password: z.string().min(6) }),
    ({ k }, a) => {
      if (k.db.get("select 1 from agents where handle = ?", a.handle)) throw new DomainError("invalid_input", "Handle already taken.");
      const agentId = newId("agt");
      k.db.run("insert into agents(id, kind, name, handle, password_hash, created_at) values(?,?,?,?,?,?)", agentId, "human", a.name, a.handle, hashPassword(a.password), k.now());
      return { agent_id: agentId, token: issueToken(k, agentId) };
    },
    false,
  ),
  login: m(
    z.object({ handle: z.string(), password: z.string() }),
    ({ k }, a) => {
      const ag = k.db.get("select * from agents where handle = ? and kind = 'human'", a.handle);
      if (!ag || !ag.password_hash || !checkPassword(a.password, ag.password_hash)) throw new DomainError("unauthenticated", "Unknown handle or wrong password.");
      return { agent_id: ag.id, token: issueToken(k, ag.id) };
    },
    false,
  ),
  logout: m(z.object({ token: z.string() }), ({ k }, a) => {
    k.db.run("delete from sessions where token_hash = ?", sha256(a.token));
    return { ok: true };
  }),
  me: m(z.object({}), (c) => ({ agent: c.k.agentDescriptor(c.actor) }), false),
  createAiAgent: m(
    z.object({ name: z.string().min(1), model: z.string().default("unknown"), provider: z.string().default("unknown"), version: z.string().default("unknown") }),
    (c, a) => {
      if (!c.k.isHuman(me(c))) throw new DomainError("insufficient_permission", "AI agents are registered by an accountable human operator.");
      const agentId = newId("agt");
      c.k.db.run("insert into agents(id, kind, name, operator_id, descriptor, created_at) values(?,?,?,?,?,?)", agentId, "ai", a.name, me(c), j({ model: a.model, provider: a.provider, version: a.version }), c.k.now());
      return { agent_id: agentId, token: issueToken(c.k, agentId), note: "Use this token as the agent's own credential; it can submit candidates but never gate them." };
    },
  ),
  agents: m(z.object({}), ({ k }) => k.db.all("select id, kind, name, handle, operator_id from agents order by name")),

  // ---------------------------------------------------------------- vocabulary
  vocabulary: m(
    z.object({ workspace_id: z.string().optional() }),
    ({ k }, a) => ({
      payload_kinds: PAYLOAD_KINDS,
      roles: ROLES,
      contracts: [...CORE_CONTRACTS, ...k.db.all("select * from contracts where workspace_id is ? or ? is null", a.workspace_id ?? null, a.workspace_id ?? null).map((c) => ({ ...pj(c.definition), version: c.version, id: c.id, extension: true }))],
      status_values: STATUS_VALUES,
      finding_values: FINDING_VALUES,
      validity_actions: VALIDITY_ACTIONS,
      work_states: WORK_STATES,
      gate_states: GATE_STATES,
      plan_modalities: PLAN_MODALITIES,
      dep_kinds: DEP_KINDS,
      contribution_roles: CONTRIBUTION_ROLES,
      editorial_roles: EDITORIAL_ROLES,
      argument_kinds: ARGUMENT_KINDS,
      research_roles: RESEARCH_ROLES,
      failure_kinds: FAILURE_KINDS,
      change_classes: CHANGE_CLASSES,
      policies: POLICIES,
    }),
    false,
  ),

  // ---------------------------------------------------------------- workspaces
  createWorkspace: m(z.object({ name: z.string().min(1), description: z.string().optional(), profile: z.enum(["classical_informal", "unknown"]).optional() }), (c, a) => A.createWorkspace(c.k, me(c), a)),
  myWorkspaces: m(z.object({}), (c) =>
    c.k.db
      .all("select w.*, m.roles from workspaces w join memberships m on m.workspace_id = w.id where m.agent_id = ? and m.active = 1 order by w.created_at", me(c))
      .map((w) => ({ id: w.id, name: w.name, description: w.description, roles: pj(w.roles), root_context_rev: w.root_context_rev })),
  ),
  workspace: m(z.object({ workspace_id: id }), (c, a) => Q.workspaceOverview(c.k, v(c), a.workspace_id)),
  addMember: m(z.object({ workspace_id: id, agent_id: id, roles: z.array(z.enum(ROLES)).min(1), reason: z.string().default("") }), (c, a) => (A.addMember(c.k, me(c), a.workspace_id, a.agent_id, a.roles, a.reason), { ok: true })),
  revokeMember: m(z.object({ workspace_id: id, agent_id: id, reason: z.string().default("") }), (c, a) => (A.revokeMember(c.k, me(c), a.workspace_id, a.agent_id, a.reason), { ok: true })),

  // ---------------------------------------------------------------- authoring
  createEntity: m(
    z.object({ workspace_id: id, kind: z.enum(PAYLOAD_KINDS), title: z.string().min(1), facets: z.array(z.string()).optional(), access: audience.optional(), content: content.optional() }),
    (c, a) => A.createEntity(c.k, me(c), a as any),
  ),
  createAndSeal: m(
    z.object({ workspace_id: id, kind: z.enum(PAYLOAD_KINDS), title: z.string().min(1), facets: z.array(z.string()).optional(), access: audience.optional(), content, idem_key: z.string().optional() }),
    (c, a) => A.createAndSeal(c.k, me(c), a as any, { idem_key: a.idem_key }),
  ),
  draft: m(z.object({ draft_id: id }), (c, a) => {
    const d = c.k.db.get("select * from drafts where id = ?", a.draft_id);
    if (!d || !v(c).canSeeDraft(d)) throw notFound();
    const ent = c.k.entityRow(d.entity_id)!;
    return { ...d, content: pj(d.content), base_revs: pj(d.base_revs), entity: { id: ent.id, kind: ent.kind, namespace: ent.namespace, title: ent.title, access: pj(ent.access) }, author: c.k.agentDescriptor(d.author_id) };
  }),
  myDrafts: m(z.object({ workspace_id: id }), (c, a) =>
    c.k.db
      .all("select d.*, e.title as etitle, e.kind as ekind from drafts d join entities e on e.id = d.entity_id where d.workspace_id = ? and d.status = 'editing' order by d.updated_at desc", a.workspace_id)
      .filter((d) => v(c).canSeeDraft(d))
      .map((d) => ({ id: d.id, entity_id: d.entity_id, title: pj(d.content).title ?? d.etitle, kind: d.ekind, author: c.k.agentDescriptor(d.author_id), updated_at: d.updated_at, intent: d.intent })),
  ),
  saveDraft: m(z.object({ draft_id: id, content, generation: z.number().int() }), (c, a) => A.saveDraft(c.k, me(c), a.draft_id, a.content, a.generation)),
  saveAsAlternativeDraft: m(z.object({ draft_id: id, content }), (c, a) => A.saveAsAlternativeDraft(c.k, me(c), a.draft_id, a.content)),
  discardDraft: m(z.object({ draft_id: id }), (c, a) => A.discardDraft(c.k, me(c), a.draft_id)),
  draftFromRevision: m(z.object({ revs: z.array(id).min(1), intent: z.string().optional() }), (c, a) => A.draftFromRevision(c.k, me(c), a.revs, a.intent)),
  deriveEntity: m(z.object({ rev: id, title: z.string().optional(), access: audience.optional(), reason: z.string().min(1) }), (c, a) => A.deriveEntity(c.k, me(c), a.rev, a as any)),
  resolveSelectors: m(z.object({ draft_id: id }), (c, a) => A.resolveSelectors(c.k, me(c), a.draft_id)),
  seal: m(z.object({ drafts: z.array(id).min(1), idem_key: z.string().optional() }), (c, a) => A.sealDrafts(c.k, me(c), a.drafts, { idem_key: a.idem_key })),
  selectPreferred: m(z.object({ rev: id, scope: z.string().min(1) }), (c, a) => A.selectPreferred(c.k, me(c), a.rev, a.scope)),
  registerContract: m(
    z.object({ workspace_id: id, id: z.string().regex(/^[a-z_]+$/), version: z.string().min(1), roles: z.array(z.object({ role: z.string(), card: z.object({ min: z.number().int(), max: z.number().int().nullable() }) })).min(1), description: z.string().min(1) }),
    (c, a) => A.registerExtensionContract(c.k, me(c), a.workspace_id, { id: a.id, version: a.version, roles: a.roles, description: a.description }),
  ),

  // ---------------------------------------------------------------- lifecycle & work
  recordValidity: m(
    z.object({ rev: id, action: z.enum(VALIDITY_ACTIONS), scope: z.string().min(1), reason: z.string().min(1), by_rev: z.string().optional(), restores: z.enum(VALIDITY_ACTIONS).optional(), audience: z.enum(["subject", "workspace"]).optional() }),
    (c, a) => S.recordValidity(c.k, me(c), a.rev, a),
  ),
  transitionWork: m(z.object({ entity_id: id, to: z.enum(WORK_STATES), reason: z.string().min(1), evidence: z.array(z.string()).optional() }), (c, a) => S.transitionWork(c.k, me(c), a.entity_id, a)),
  proposeClosure: m(z.object({ entity_id: id, artifact: id, criterion: z.string().min(1), idem_key: z.string().optional() }), (c, a) => S.proposeClosure(c.k, me(c), a.entity_id, a)),
  decideClosure: m(z.object({ entity_id: id, proposal: id, accepted: z.boolean(), reason: z.string().min(1), return_to: z.enum(["active", "blocked"]).optional(), dimension: z.string().optional() }), (c, a) => S.decideClosure(c.k, me(c), a.entity_id, a)),
  reopen: m(z.object({ entity_id: id, reason: z.string().min(1), to: z.enum(["active", "blocked"]).optional(), evidence: z.array(z.string()).optional() }), (c, a) => S.reopen(c.k, me(c), a.entity_id, a)),
  selectAssessment: m(z.object({ subject_rev: id, dimension: z.string().min(1), assessment_rev: id, reason: z.string().min(1) }), (c, a) => S.selectAssessment(c.k, me(c), a)),

  // ---------------------------------------------------------------- candidates
  submitCandidate: m(
    z.object({ workspace_id: id, kind: z.enum(PAYLOAD_KINDS), title: z.string().min(1), content, proposed_kind: z.string().optional(), uncertainty: z.string().optional(), idem_key: z.string().optional() }),
    (c, a) => C.submitCandidate(c.k, me(c), a as any, { idem_key: a.idem_key }),
  ),
  gateTransition: m(z.object({ entity_id: id, to: z.enum(GATE_STATES), reason: z.string().default("") }), (c, a) => C.gateTransition(c.k, me(c), a.entity_id, a)),
  promote: m(
    z.object({ candidate_rev: id, scope: z.string().min(1), decision: z.string().min(1), edited_content: content.optional(), fragment: z.object({ content, locator: z.string().min(1) }).optional(), idem_key: z.string().optional() }),
    (c, a) => C.promote(c.k, me(c), a as any),
  ),
  promoteBatch: m(z.object({ candidate_revs: z.array(id).min(1), scope: z.string().min(1), decision: z.string().min(1) }), (c, a) => C.promoteBatch(c.k, me(c), a)),
  candidateQueue: m(z.object({ workspace_id: id }), (c, a) => C.candidateQueue(c.k, c.actor, a.workspace_id)),

  // ---------------------------------------------------------------- publication
  exposurePreview: m(z.object({ revs: z.array(id).min(1), audience }), (c, a) => {
    for (const r of a.revs) if (!v(c).canSeeRev(r)) throw notFound();
    return P.exposureClosure(c.k, v(c), a.revs, a.audience);
  }),
  publish: m(
    z.object({ workspace_id: id, revs: z.array(id).min(1), audience, license: z.string().min(1), title: z.string().optional(), rights_confirmed: z.boolean().optional(), embargo: z.object({ release_at: z.string(), release_authorized: z.boolean() }).optional(), idem_key: z.string().optional(), ...scope }),
    (c, a) => P.publish(c.k, me(c), a as any),
  ),
  authorizeRelease: m(z.object({ publication_id: id, authorized: z.boolean() }), (c, a) => P.authorizeRelease(c.k, me(c), a.publication_id, a.authorized)),
  cancelPublication: m(z.object({ publication_id: id, reason: z.string().min(1) }), (c, a) => P.cancelPublication(c.k, me(c), a.publication_id, a.reason)),
  processEmbargoes: m(z.object({}), (c) => P.processEmbargoes(c.k)),
  publications: m(z.object({ workspace_id: z.string().optional(), rev: z.string().optional() }), (c, a) => P.publicationsFor(c.k, v(c), a), false),

  // ---------------------------------------------------------------- queries
  entity: m(z.object({ entity_id: id, rev: z.string().optional(), ...scope }), (c, a) => Q.entityView(c.k, v(c), a.entity_id, a), false),
  revision: m(z.object({ rev: id }), (c, a) => Q.projectRevision(c.k, v(c), a.rev), false),
  status: m(z.object({ rev: id, ...scope }), (c, a) => {
    if (!v(c).canSeeRev(a.rev)) throw notFound();
    return statusVector(c.k, v(c), a.rev, a);
  }, false),
  support: m(z.object({ rev: id, ...scope }), (c, a) => {
    if (!v(c).canSeeRev(a.rev)) throw notFound();
    return supportOf(c.k, v(c), a.rev, a);
  }, false),
  search: m(z.object({ text: z.string().optional(), workspace_id: z.string().optional(), kind: z.string().optional(), include_candidates: z.boolean().optional(), limit: z.number().optional() }), (c, a) => Q.search(c.k, v(c), a), false),
  dependsOn: m(z.object({ rev: id, ...scope }), (c, a) => Q.dependsOn(c.k, v(c), a.rev, a), false),
  usedBy: m(z.object({ rev: id, ...scope }), (c, a) => Q.usedBy(c.k, v(c), a.rev, a), false),
  revisionUsed: m(z.object({ rev: id, entity_id: id }), (c, a) => Q.revisionUsed(c.k, v(c), a.rev, a.entity_id), false),
  equivalences: m(z.object({ rev: id, ...scope }), (c, a) => {
    if (!v(c).canSeeRev(a.rev)) throw notFound();
    return Q.equivalences(c.k, v(c), a.rev, a);
  }, false),
  aiGenerated: m(z.object({ workspace_id: id }), (c, a) => Q.aiGenerated(c.k, v(c), a.workspace_id)),
  asOf: m(z.object({ entity_id: id, cut: z.string(), policy: scope.policy }), (c, a) => Q.asOf(c.k, v(c), a.entity_id, a.cut, a), false),
  timeline: m(z.object({ entity_id: id }), (c, a) => Q.timeline(c.k, v(c), a.entity_id), false),
  compare: m(z.object({ old: id, new: id }), (c, a) => compareRevisions(c.k, v(c), a.old, a.new), false),
  impact: m(
    z.object({ rev: id, change: z.enum(["defect", "refuted", "retracted", "new_revision", "context_changed"]), new_rev: z.string().optional(), budget: z.number().int().min(1).max(20).optional(), ...scope }),
    (c, a) => {
      if (!v(c).canSeeRev(a.rev)) throw notFound();
      return impact(c.k, v(c), a);
    },
    false,
  ),
  bundle: m(z.object({ rev: id, profile: z.enum(["mathematician", "collaborator", "ai"]).default("mathematician"), budget: z.number().int().optional(), ...scope }), (c, a) => computeBundle(c.k, v(c), a.rev, a)),
  sealBundle: m(z.object({ rev: id, profile: z.enum(["mathematician", "collaborator", "ai"]).default("mathematician"), budget: z.number().int().optional(), declared_adequate_for: z.string().optional(), ...scope }), (c, a) => sealBundle(c.k, me(c), a.rev, a)),
  cockpit: m(z.object({ workspace_id: id, ...scope }), (c, a) => {
    if (!v(c).member(a.workspace_id)) throw notFound();
    return cockpit(c.k, v(c), a.workspace_id, a);
  }),
  plans: m(z.object({ entity_id: id, ...scope }), (c, a) => {
    if (!v(c).canSeeEntity(a.entity_id)) throw notFound();
    return { plans: plansFor(c.k, v(c), a.entity_id, a), blocking: blockingObligations(c.k, v(c), a.entity_id, a) };
  }, false),
  routeStatus: m(z.object({ entity_id: id, ...scope }), (c, a) => {
    if (!v(c).canSeeEntity(a.entity_id)) throw notFound();
    return routeStatus(c.k, v(c), a.entity_id, a);
  }, false),
  failedAttempts: m(z.object({ entity_id: id, ...scope }), (c, a) => {
    if (!v(c).canSeeEntity(a.entity_id)) throw notFound();
    return failedAttempts(c.k, v(c), a.entity_id, a);
  }, false),
  barrierApplicability: m(z.object({ rev: id, ...scope }), (c, a) => {
    if (!v(c).canSeeRev(a.rev)) throw notFound();
    return barrierApplicability(c.k, v(c), a.rev, a);
  }, false),
  localGraph: m(z.object({ rev: id, depth: z.number().int().min(1).max(3).optional(), max: z.number().int().max(200).optional(), include_citations: z.boolean().optional() }), (c, a) => Q.localGraph(c.k, v(c), a.rev, a), false),
  notifications: m(z.object({}), (c) => Q.notifications(c.k, v(c))),
  markNotificationsRead: m(z.object({}), (c) => (c.k.db.run("update notifications set read = 1 where agent_id = ?", me(c)), { ok: true })),
  contributions: m(z.object({ entity_id: id }), (c, a) => {
    if (!v(c).canSeeEntity(a.entity_id)) throw notFound();
    return Q.contributions(c.k, v(c), a.entity_id);
  }, false),
  identityRecords: m(z.object({ entity_id: id }), (c, a) => {
    if (!v(c).canSeeEntity(a.entity_id)) throw notFound();
    return G.identityRecords(c.k, v(c), a.entity_id);
  }, false),

  // ---------------------------------------------------------------- governance
  decideAlias: m(z.object({ workspace_id: id, entities: z.array(id).min(2), reason: z.string().min(1), kind: z.enum(["duplicate_record", "same_concept_claim"]).optional() }), (c, a) => G.decideAlias(c.k, me(c), a)),
  reverseAlias: m(z.object({ workspace_id: id, overlay: id, reason: z.string().min(1) }), (c, a) => G.reverseAlias(c.k, me(c), a)),
  recordIdentityMap: m(
    z.object({ workspace_id: id, action: z.enum(["split", "merge"]), from: z.array(id).min(1), to: z.array(id).min(1), mapping: z.array(z.object({ from: z.string(), to: z.string(), note: z.string().optional() })), reason: z.string().min(1) }),
    (c, a) => G.recordIdentityMap(c.k, me(c), a),
  ),
  governanceCase: m(
    z.object({ case_id: z.string().optional(), case_kind: z.enum(["dispute", "plagiarism", "priority", "correction", "moderation", "identity"]), action: z.enum(["opened", "assessed", "decided_for_policy", "appealed", "reassessed"]), subject_rev: id, allegation: z.string().optional(), reason: z.string().min(1), evidence: z.array(z.string()).optional(), decision: z.string().optional() }),
    (c, a) => G.governanceCase(c.k, me(c), a),
  ),
  proposeStewardship: m(z.object({ entity_id: id, to: id, reason: z.string().min(1) }), (c, a) => G.proposeStewardship(c.k, me(c), a.entity_id, a)),
  acceptStewardship: m(z.object({ entity_id: id }), (c, a) => G.acceptStewardship(c.k, me(c), a.entity_id)),
  recoverStewardship: m(z.object({ entity_id: id, reason: z.string().min(1) }), (c, a) => G.recoverStewardship(c.k, me(c), a.entity_id, a)),

  // ---------------------------------------------------------------- portability
  exportWorkspace: m(z.object({ workspace_id: id, cut: z.string().optional(), policy: z.string().optional() }), (c, a) => X.exportWorkspace(c.k, v(c), a.workspace_id, a)),
  exportPublication: m(z.object({ publication_id: id }), (c, a) => X.exportPublication(c.k, v(c), a.publication_id), false),
  importWorkspace: m(z.object({ data: z.any() }), (c, a) => X.importWorkspace(c.k, me(c), a.data)),
} satisfies Record<string, Method<any>>;

export type MethodName = keyof typeof METHODS;

export class Platform {
  readonly k: Kernel;
  constructor(opts: { path?: string; clock?: () => Date } = {}) {
    this.k = new Kernel(opts);
  }

  /** Resolve a bearer token to an agent id, or null for anonymous callers. */
  authenticate(token: string | undefined | null): string | null {
    if (!token) return null;
    return (this.k.db.get("select agent_id from sessions where token_hash = ?", sha256(token))?.agent_id as string) ?? null;
  }

  call(method: string, actor: string | null, rawArgs: unknown): any {
    const def = (METHODS as Record<string, Method<any>>)[method];
    if (!def) throw new DomainError("not_found", `Unknown method '${method}'.`);
    if (def.auth && !actor) throw new DomainError("unauthenticated", "Sign in required.");
    const parsed = def.args.safeParse(rawArgs ?? {});
    if (!parsed.success)
      throw new DomainError("invalid_input", "Invalid arguments.", parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`));
    return def.run({ k: this.k, actor }, parsed.data);
  }

  /** Create a human agent directly (seeding/tests). */
  createHuman(handle: string, name: string, password = "password") {
    return this.call("register", null, { handle, name, password }) as { agent_id: string; token: string };
  }
}
