// Kernel: persistence handle, clock, errors, agents, memberships, visibility and the
// append-only event log. Every projection in the product goes through `Viewer` so that
// queries, exports, bundles and notifications share one access filter (I42).
import { Db, j, newId, pj, sha256, canonicalJson, type Row } from "./db.ts";
import type { Audience } from "./types.ts";
import type { WorkspaceRole } from "./vocab.ts";

export type ErrorCode =
  | "not_found"
  | "unauthenticated"
  | "invalid_input"
  | "reference_unresolved"
  | "context_conflict"
  | "missing_provenance"
  | "contract_violation"
  | "cycle"
  | "stale_draft"
  | "insufficient_permission"
  | "exposure_conflict"
  | "incomplete_manifest"
  | "gate_missing"
  | "invalid_transition"
  | "idempotency_conflict";

const HTTP_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  unauthenticated: 401,
  invalid_input: 400,
  reference_unresolved: 422,
  context_conflict: 422,
  missing_provenance: 422,
  contract_violation: 422,
  cycle: 422,
  stale_draft: 409,
  insufficient_permission: 403,
  exposure_conflict: 422,
  incomplete_manifest: 422,
  gate_missing: 422,
  invalid_transition: 409,
  idempotency_conflict: 409,
};

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return HTTP_STATUS[this.code];
  }
}

/** Identical for absent and inaccessible objects so that unauthorized callers learn nothing (I43, AC34). */
export const notFound = () => new DomainError("not_found", "No accessible record with this identifier.");

export interface EventInput {
  kind: string;
  workspace_id?: string | null;
  actor_id?: string | null;
  subject_entity?: string | null;
  subject_rev?: string | null;
  payload?: unknown;
  occurred_at?: string | null;
  audience?: EventAudience;
  idem_key?: string;
}
/** `subject`: visible to whoever can see the subject; `workspace`: members; `public`; `agents`: listed agents. */
export type EventAudience = { mode: "subject" | "workspace" | "public" | "agents"; agents?: string[] };

export interface EventRow {
  id: string;
  kind: string;
  workspace_id: string | null;
  actor_id: string | null;
  subject_entity: string | null;
  subject_rev: string | null;
  payload: any;
  occurred_at: string | null;
  recorded_at: string;
  audience: EventAudience;
}

export class Kernel {
  readonly db: Db;
  private clock: () => Date;

  constructor(opts: { path?: string; clock?: () => Date } = {}) {
    this.db = new Db(opts.path ?? ":memory:");
    this.clock = opts.clock ?? (() => new Date());
  }

  now(): string {
    return this.clock().toISOString();
  }
  setClock(clock: () => Date) {
    this.clock = clock;
  }

  // ------------------------------------------------------------------ agents

  agent(id: string | null | undefined): Row | undefined {
    if (!id) return undefined;
    return this.db.get("select * from agents where id = ?", id);
  }

  agentDescriptor(id: string | null | undefined) {
    const a = this.agent(id);
    if (!a) return null;
    return { id: a.id, kind: a.kind, name: a.name, operator_id: a.operator_id ?? undefined };
  }

  isHuman(id: string | null | undefined) {
    return this.agent(id)?.kind === "human";
  }

  // ------------------------------------------------------------------ memberships

  roles(workspaceId: string, agentId: string | null | undefined): WorkspaceRole[] {
    if (!agentId) return [];
    const m = this.db.get(
      "select roles from memberships where workspace_id = ? and agent_id = ? and active = 1",
      workspaceId,
      agentId,
    );
    return m ? pj(m.roles) : [];
  }

  isMember(workspaceId: string, agentId: string | null | undefined) {
    return this.roles(workspaceId, agentId).length > 0;
  }

  hasRole(workspaceId: string, agentId: string | null | undefined, ...wanted: WorkspaceRole[]) {
    const r = this.roles(workspaceId, agentId);
    return r.includes("owner") || wanted.some((w) => r.includes(w));
  }

  requireRole(workspaceId: string, agentId: string | null | undefined, ...wanted: WorkspaceRole[]) {
    if (!agentId) throw new DomainError("unauthenticated", "Sign in required.");
    if (!this.isMember(workspaceId, agentId)) throw notFound();
    if (!this.hasRole(workspaceId, agentId, ...wanted))
      throw new DomainError("insufficient_permission", `Requires role: ${wanted.join(" or ")}.`);
  }

  // ------------------------------------------------------------------ visibility

  viewer(agentId: string | null | undefined): Viewer {
    return new Viewer(this, agentId ?? null);
  }

  // ------------------------------------------------------------------ rows

  entityRow(id: string): Row | undefined {
    return this.db.get("select * from entities where id = ?", id);
  }
  revRow(id: string): Row | undefined {
    return this.db.get("select * from revisions where id = ?", id);
  }
  revContent(id: string): any {
    const r = this.revRow(id);
    return r ? pj(r.content) : undefined;
  }
  revisionsOf(entityId: string): Row[] {
    return this.db.all("select * from revisions where entity_id = ? order by seq", entityId);
  }

  // ------------------------------------------------------------------ events

  /**
   * Append an immutable event. With an idempotency key, a retry carrying the same payload
   * returns the original event; a different payload is an explicit conflict (AC48).
   */
  recordEvent(input: EventInput): { id: string; replayed: boolean } {
    const payload = input.payload ?? {};
    const hash = sha256(
      canonicalJson({ kind: input.kind, s: input.subject_entity, r: input.subject_rev, payload }),
    );
    if (input.idem_key) {
      const prev = this.db.get("select id, idem_hash from events where idem_key = ?", input.idem_key);
      if (prev) {
        if (prev.idem_hash !== hash)
          throw new DomainError(
            "idempotency_conflict",
            "This activity identifier was already used with different content.",
          );
        return { id: prev.id, replayed: true };
      }
    }
    const id = newId("evt");
    this.db.run(
      `insert into events(id, kind, workspace_id, actor_id, subject_entity, subject_rev, payload,
        occurred_at, recorded_at, audience, idem_key, idem_hash) values(?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.kind,
      input.workspace_id ?? null,
      input.actor_id ?? null,
      input.subject_entity ?? null,
      input.subject_rev ?? null,
      j(payload),
      input.occurred_at ?? null,
      this.now(),
      j(input.audience ?? { mode: "subject" }),
      input.idem_key ?? null,
      input.idem_key ? hash : null,
    );
    return { id, replayed: false };
  }

  eventRow(r: Row): EventRow {
    return { ...r, payload: pj(r.payload), audience: pj(r.audience) } as EventRow;
  }

  events(where: string, ...params: any[]): EventRow[] {
    return this.db
      .all(`select * from events where ${where} order by recorded_at, rowid`, ...params)
      .map((r) => this.eventRow(r));
  }

  notify(agentId: string, workspaceId: string | null, kind: string, payload: unknown) {
    this.db.run(
      "insert into notifications(id, agent_id, workspace_id, kind, payload, created_at) values(?,?,?,?,?,?)",
      newId("ntf"),
      agentId,
      workspaceId,
      kind,
      j(payload),
      this.now(),
    );
  }
}

/**
 * Access decisions for one caller. Revisions are visible through their sealed access
 * (owner/team/named) or through a completed Publication to an audience containing the caller.
 * Drafts follow the entity's working access. Candidates are visible like any workspace object,
 * but excluded from curated answers by the query layer.
 */
export class Viewer {
  private revCache = new Map<string, boolean>();
  private entCache = new Map<string, boolean>();
  private roleCache = new Map<string, WorkspaceRole[]>();

  constructor(
    readonly k: Kernel,
    readonly id: string | null,
  ) {}

  roles(ws: string): WorkspaceRole[] {
    let r = this.roleCache.get(ws);
    if (!r) {
      r = this.k.roles(ws, this.id);
      this.roleCache.set(ws, r);
    }
    return r;
  }
  member(ws: string) {
    return this.roles(ws).length > 0;
  }

  private audienceAdmits(a: Audience, ownerId: string, ws: string) {
    if (a.mode === "public") return true;
    if (!this.id) return false;
    if (this.id === ownerId) return true;
    if (a.mode === "team") return this.member(ws);
    if (a.mode === "named") return (a.agents ?? []).includes(this.id);
    return false;
  }

  canSeeRev(revId: string): boolean {
    const hit = this.revCache.get(revId);
    if (hit !== undefined) return hit;
    const rev = this.k.revRow(revId);
    let ok = false;
    if (rev) {
      const access: Audience & { owner?: string } = pj(rev.access);
      ok = this.audienceAdmits(access, access.owner ?? rev.sealed_by, rev.workspace_id);
      if (!ok) {
        for (const a of this.k.db.all("select kind, agent_id from rev_audience where rev_id = ?", revId)) {
          if (a.kind === "public") ok = true;
          else if (a.kind === "team" && this.member(rev.workspace_id)) ok = true;
          else if (a.kind === "named" && a.agent_id === this.id) ok = true;
          if (ok) break;
        }
      }
    }
    this.revCache.set(revId, ok);
    return ok;
  }

  canSeeDraft(draft: Row): boolean {
    if (!this.id) return false;
    if (draft.author_id === this.id) return true;
    const ent = this.k.entityRow(draft.entity_id);
    if (!ent) return false;
    return this.audienceAdmits(pj(ent.access), ent.owner_id, ent.workspace_id);
  }

  canSeeEntity(entityId: string): boolean {
    const hit = this.entCache.get(entityId);
    if (hit !== undefined) return hit;
    const ent = this.k.entityRow(entityId);
    let ok = false;
    if (ent) {
      ok = this.audienceAdmits(pj(ent.access), ent.owner_id, ent.workspace_id);
      if (!ok) ok = this.k.revisionsOf(entityId).some((r) => this.canSeeRev(r.id));
      if (!ok && this.id)
        ok = this.k.db
          .all("select * from drafts where entity_id = ? and status = 'editing'", entityId)
          .some((d) => this.canSeeDraft(d));
    }
    this.entCache.set(entityId, ok);
    return ok;
  }

  canSeeEvent(e: EventRow): boolean {
    const a = e.audience;
    if (a.mode === "public") return true;
    if (a.mode === "agents") return !!this.id && (a.agents ?? []).includes(this.id);
    if (a.mode === "workspace") return !!e.workspace_id && this.member(e.workspace_id);
    if (e.subject_rev) return this.canSeeRev(e.subject_rev);
    if (e.subject_entity) return this.canSeeEntity(e.subject_entity);
    return !!e.workspace_id && this.member(e.workspace_id);
  }

  /** Content of moderated (availability-restricted) revisions is withheld except for authorized roles. */
  contentWithheld(revId: string): string | null {
    const rev = this.k.revRow(revId);
    if (!rev) return null;
    const evs = this.k.events("kind = 'validity' and subject_rev = ?", revId);
    let restricted: string | null = null;
    for (const e of evs) {
      if (e.payload.action === "availability_restricted") restricted = e.payload.reason ?? "restricted";
      if (e.payload.action === "restored" && e.payload.restores === "availability_restricted") restricted = null;
    }
    if (!restricted) return null;
    if (this.k.hasRole(rev.workspace_id, this.id, "moderator", "owner")) return null;
    return restricted;
  }
}
