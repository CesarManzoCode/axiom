// Persistence: a single SQLite file via node:sqlite. Sealed revisions and events are
// append-only; only drafts, projections (memberships) and notification flags mutate.
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";

const SCHEMA = `
create table if not exists meta(key text primary key, value text not null);
create table if not exists agents(
  id text primary key,
  kind text not null check(kind in ('human','group','ai','service')),
  name text not null,
  handle text unique,
  password_hash text,
  token_hash text unique,
  operator_id text,
  descriptor text not null default '{}',
  created_at text not null
);
create table if not exists sessions(token_hash text primary key, agent_id text not null, created_at text not null);
create table if not exists workspaces(
  id text primary key, name text not null, description text not null default '',
  created_by text not null, created_at text not null, root_context_rev text, settings text not null default '{}'
);
create table if not exists memberships(
  workspace_id text not null, agent_id text not null, roles text not null, active integer not null,
  since text not null, primary key(workspace_id, agent_id)
);
create table if not exists entities(
  id text primary key, workspace_id text not null,
  namespace text not null check(namespace in ('curated','candidate')),
  kind text not null, facets text not null, title text not null,
  access text not null, owner_id text not null, steward_id text not null,
  created_event text not null, created_at text not null, fixture_label text
);
create index if not exists entities_ws on entities(workspace_id);
create table if not exists drafts(
  id text primary key, entity_id text not null, workspace_id text not null, author_id text not null,
  content text not null, base_revs text not null, generation integer not null,
  status text not null check(status in ('editing','sealed','discarded')),
  created_at text not null, updated_at text not null, sealed_rev text, intent text
);
create index if not exists drafts_entity on drafts(entity_id);
create table if not exists revisions(
  id text primary key, entity_id text not null, workspace_id text not null, seq integer not null,
  kind text not null, title text not null, content text not null, context_rev text not null,
  parents text not null, access text not null, content_hash text not null,
  sealed_at text not null, sealed_by text not null, seal_event text not null, vocab text not null,
  unique(entity_id, seq)
);
create index if not exists revisions_entity on revisions(entity_id);
create table if not exists refs(
  rev_id text not null, target_rev text not null, target_entity text not null,
  via text not null, role text, slot text, dep_kind text, origin text,
  structural integer not null default 0, locator text
);
create index if not exists refs_target on refs(target_rev);
create index if not exists refs_rev on refs(rev_id);
create table if not exists events(
  id text primary key, kind text not null, workspace_id text, actor_id text,
  subject_entity text, subject_rev text, payload text not null,
  occurred_at text, recorded_at text not null, audience text not null,
  idem_key text unique, idem_hash text
);
create index if not exists events_entity on events(subject_entity);
create index if not exists events_rev on events(subject_rev);
create index if not exists events_kind on events(kind);
create table if not exists publications(
  id text primary key, workspace_id text not null, issuer_id text not null, revs text not null,
  audience text not null, license text not null, status text not null, embargo text,
  exposure text, assessment_snapshot text, title text, event_id text,
  created_at text not null, published_at text, idem_key text unique, idem_hash text
);
create table if not exists rev_audience(
  rev_id text not null, kind text not null, agent_id text, publication_id text not null
);
create index if not exists rev_audience_rev on rev_audience(rev_id);
create table if not exists notifications(
  id text primary key, agent_id text not null, workspace_id text, kind text not null,
  payload text not null, created_at text not null, read integer not null default 0
);
create index if not exists notifications_agent on notifications(agent_id);
create table if not exists contracts(
  id text not null, version text not null, workspace_id text, definition text not null,
  created_by text not null, created_at text not null, primary key(id, version)
);
`;

export type Row = Record<string, any>;

export class Db {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path = ":memory:") {
    this.raw = new DatabaseSync(path);
    this.raw.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.raw.exec(SCHEMA);
  }

  all(sql: string, ...params: any[]): Row[] {
    return this.raw.prepare(sql).all(...params) as Row[];
  }
  get(sql: string, ...params: any[]): Row | undefined {
    return this.raw.prepare(sql).get(...params) as Row | undefined;
  }
  run(sql: string, ...params: any[]): void {
    this.raw.prepare(sql).run(...params);
  }

  /** Nested-safe transaction: an observer never sees half of a joint operation (§34E). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.raw.exec("begin immediate");
    this.depth = 1;
    try {
      const out = fn();
      this.raw.exec("commit");
      return out;
    } catch (err) {
      this.raw.exec("rollback");
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close() {
    this.raw.close();
  }
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** Opaque, non-recycled identifiers. The prefix names the primitive only, never type, title or truth. */
export function newId(prefix: string): string {
  const bytes = randomBytes(13);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return `${prefix}_${out}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as object)
    .filter((k) => (value as any)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export const j = (v: unknown) => JSON.stringify(v);
export const pj = <T = any>(v: string | null | undefined): T => (v == null ? (undefined as T) : JSON.parse(v));
