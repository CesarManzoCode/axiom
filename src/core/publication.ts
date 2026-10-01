// Publication (§18, §22): making sealed revisions available to an audience. Publication
// never mutates the snapshot, never approves it, and is blocked until the exposure closure
// of everything it would reveal is authorized for the target audience.
import { canonicalJson, j, newId, pj, sha256 } from "./db.ts";
import { DomainError, notFound, type Kernel, type Viewer } from "./kernel.ts";
import { SEMANTIC_VIAS } from "./refs.ts";
import { accessOf, admits } from "./exposure.ts";
import { statusVector, type PolicyKey } from "./status.ts";
import type { Audience } from "./types.ts";

export interface ExposureConflict {
  rev: string | null;
  title: string | null;
  reason: string;
  via: string;
  from: string;
}

/** Would `audience` be able to read `revId` once the cohort is published? */
function admitted(k: Kernel, revId: string, audience: Audience, cohort: Set<string>, ws: string, owner: string): boolean {
  if (cohort.has(revId)) return true;
  const t = accessOf(k, revId);
  return !!t && admits(k, t, audience, ws, owner);
}

/**
 * Exposure closure (Q19): every semantic reference reachable from the cohort must be readable by
 * the audience. Ancestry and provenance lineage are excluded — they stay in a ledger with its own
 * audience (T30). Conflicts are only described to a caller who can see the conflicting objects.
 */
export function exposureClosure(k: Kernel, v: Viewer, revIds: string[], audience: Audience) {
  const cohort = new Set(revIds);
  const conflicts: ExposureConflict[] = [];
  const warnings: string[] = [];
  const closure = new Set<string>();
  const stack = [...revIds];
  while (stack.length) {
    const cur = stack.pop()!;
    if (closure.has(cur)) continue;
    closure.add(cur);
    const row = k.revRow(cur);
    if (!row) continue;
    const ent = k.entityRow(row.entity_id)!;
    const c = pj(row.content);
    if (ent.namespace === "candidate" && cohort.has(cur) && !(c.facets ?? []).includes("declared_candidate_package"))
      conflicts.push({ rev: cur, title: row.title, reason: "Candidate content has not passed a human gate.", via: "namespace", from: cur });
    if (
      audience.mode === "public" &&
      ["import", "extraction"].includes(c.provenance?.acquisition) &&
      c.provenance?.sources?.some((s: any) => {
        const src = "rev" in s.source ? k.revContent(s.source.rev) : null;
        return src?.payload?.rights?.status === "unknown";
      })
    )
      warnings.push(`'${row.title}' paraphrases a source with unknown rights: confirm that only citation/paraphrase is exposed.`);
    const edges = k.db.all("select * from refs where rev_id = ?", cur);
    for (const e of edges) {
      if (!SEMANTIC_VIAS.has(e.via)) continue;
      if (!k.revRow(e.target_rev)) continue;
      if (e.target_rev === cur) continue;
      if (!admitted(k, e.target_rev, audience, cohort, row.workspace_id, v.id ?? row.sealed_by)) {
        const canDescribe = v.canSeeRev(e.target_rev);
        conflicts.push({
          rev: canDescribe ? e.target_rev : null,
          title: canDescribe ? k.revRow(e.target_rev)!.title : null,
          reason: canDescribe
            ? `Referenced (${e.via}${e.role ? `/${e.role}` : ""}) but not readable by the target audience.`
            : "A referenced item you cannot access is not readable by the target audience.",
          via: e.via,
          from: cur,
        });
        continue;
      }
      // Already-admitted targets carry their own closure; only cohort members need traversal.
      if (cohort.has(e.target_rev)) stack.push(e.target_rev);
    }
  }
  return {
    audience,
    cohort: revIds,
    ok: conflicts.length === 0,
    conflicts,
    warnings,
    excluded_from_closure: "Revision ancestry, private lineage (derived_from ledger) and raw provenance inputs are not exposed; public provenance shows only authorized scope.",
    remedies: conflicts.length
      ? ["Include the item in this publication", "Publish the item first", "Remove or redact the reference (new revision)", "Publish a self-contained derived anchor"]
      : [],
  };
}

export interface PublishInput {
  workspace_id: string;
  revs: string[];
  audience: Audience;
  license: string;
  title?: string;
  rights_confirmed?: boolean;
  embargo?: { release_at: string; release_authorized: boolean };
  policy?: PolicyKey;
  idem_key?: string;
}

export function publish(k: Kernel, actor: string, input: PublishInput) {
  k.requireRole(input.workspace_id, actor, "publisher");
  if (!k.isHuman(actor)) throw new DomainError("insufficient_permission", "Publication is issued by an accountable human publisher.");
  const v = k.viewer(actor);
  for (const r of input.revs) {
    const row = k.revRow(r);
    if (!row || !v.canSeeRev(r)) throw notFound();
    if (row.workspace_id !== input.workspace_id) throw new DomainError("invalid_input", "Publish revisions from this workspace only.");
  }
  if (!input.revs.length) throw new DomainError("incomplete_manifest", "A publication fixes at least one sealed revision.");
  if (!input.license?.trim()) throw new DomainError("incomplete_manifest", "A publication declares a license/policy.");
  const hash = sha256(canonicalJson({ revs: [...input.revs].sort(), audience: input.audience, license: input.license, embargo: input.embargo ?? null }));
  if (input.idem_key) {
    const prev = k.db.get("select id, idem_hash, status from publications where idem_key = ?", input.idem_key);
    if (prev) {
      if (prev.idem_hash !== hash)
        throw new DomainError("idempotency_conflict", "This publication activity was already issued with different content.");
      return { publication_id: prev.id, status: prev.status, replayed: true };
    }
  }
  const exposure = exposureClosure(k, v, input.revs, input.audience);
  if (!exposure.ok) throw new DomainError("exposure_conflict", "Publication blocked: exposure closure is not authorized.", exposure);
  if (input.audience.mode === "public" && exposure.warnings.length && !input.rights_confirmed)
    throw new DomainError("exposure_conflict", "Rights must be confirmed for imported material before public release.", exposure);
  const id = newId("pub");
  const snapshot = Object.fromEntries(input.revs.map((r) => [r, summaryOf(k, v, r, input.policy)]));
  return k.db.tx(() => {
    const scheduled = !!input.embargo && input.embargo.release_at > k.now();
    k.db.run(
      `insert into publications(id, workspace_id, issuer_id, revs, audience, license, status, embargo, exposure,
        assessment_snapshot, title, created_at, published_at, idem_key, idem_hash) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.workspace_id,
      actor,
      j(input.revs),
      j(input.audience),
      input.license,
      scheduled ? "scheduled" : "published",
      input.embargo ? j({ ...input.embargo, authorized_by: input.embargo.release_authorized ? actor : null }) : null,
      j(exposure),
      j({ policy: input.policy ?? "workspace_curator_selection@1", cut: k.now(), status: snapshot }),
      input.title ?? null,
      k.now(),
      scheduled ? null : k.now(),
      input.idem_key ?? null,
      input.idem_key ? hash : null,
    );
    if (!scheduled) grantAudience(k, id, input.revs, input.audience);
    const ev = k.recordEvent({
      kind: scheduled ? "publication_scheduled" : "published",
      workspace_id: input.workspace_id,
      actor_id: actor,
      payload: { publication: id, revs: input.revs, audience: input.audience, license: input.license, embargo: input.embargo },
      audience: input.audience.mode === "public" && !scheduled ? { mode: "public" } : { mode: "workspace" },
    });
    k.db.run("update publications set event_id = ? where id = ?", ev.id, id);
    return { publication_id: id, status: scheduled ? "scheduled" : "published", replayed: false };
  });
}

function summaryOf(k: Kernel, v: Viewer, revId: string, policy?: PolicyKey) {
  const s = statusVector(k, v, revId, { policy });
  return Object.fromEntries(Object.entries(s.dimensions).map(([d, x]) => [d, x.summary]));
}

function grantAudience(k: Kernel, pubId: string, revs: string[], audience: Audience) {
  for (const r of revs) {
    if (audience.mode === "named")
      for (const a of audience.agents ?? []) k.db.run("insert into rev_audience(rev_id, kind, agent_id, publication_id) values(?,?,?,?)", r, "named", a, pubId);
    else k.db.run("insert into rev_audience(rev_id, kind, agent_id, publication_id) values(?,?,?,?)", r, audience.mode, null, pubId);
  }
}

/** Authorize (or revoke authorization of) a scheduled release. Time alone never releases (I44). */
export function authorizeRelease(k: Kernel, actor: string, pubId: string, authorized: boolean) {
  const p = k.db.get("select * from publications where id = ?", pubId);
  if (!p) throw notFound();
  k.requireRole(p.workspace_id, actor, "publisher");
  if (p.status !== "scheduled" && p.status !== "blocked") throw new DomainError("invalid_transition", `Publication is ${p.status}.`);
  const embargo = { ...pj(p.embargo), release_authorized: authorized, authorized_by: authorized ? actor : null };
  k.db.run("update publications set embargo = ?, status = 'scheduled' where id = ?", j(embargo), pubId);
  k.recordEvent({ kind: "embargo_authorization", workspace_id: p.workspace_id, actor_id: actor, payload: { publication: pubId, authorized }, audience: { mode: "workspace" } });
  return { ok: true };
}

export function cancelPublication(k: Kernel, actor: string, pubId: string, reason: string) {
  const p = k.db.get("select * from publications where id = ?", pubId);
  if (!p) throw notFound();
  k.requireRole(p.workspace_id, actor, "publisher");
  if (p.status !== "scheduled" && p.status !== "blocked") throw new DomainError("invalid_transition", "Only scheduled releases can be cancelled; published material stays published.");
  k.db.run("update publications set status = 'cancelled' where id = ?", pubId);
  k.recordEvent({ kind: "publication_cancelled", workspace_id: p.workspace_id, actor_id: actor, payload: { publication: pubId, reason }, audience: { mode: "workspace" } });
  return { ok: true };
}

/**
 * Process embargoes whose time has come: release only with prior authorization and a fresh
 * exposure validation; otherwise record a blocked reason for the publisher (AC36).
 */
export function processEmbargoes(k: Kernel) {
  const due = k.db.all("select * from publications where status = 'scheduled'").filter((p) => pj(p.embargo)?.release_at <= k.now());
  const results: { publication: string; status: string; reason?: string }[] = [];
  for (const p of due) {
    const embargo = pj(p.embargo);
    const revs = pj<string[]>(p.revs);
    const audience = pj<Audience>(p.audience);
    let reason: string | undefined;
    if (!embargo.release_authorized) reason = "Release was not authorized before the embargo date.";
    else if (!k.hasRole(p.workspace_id, embargo.authorized_by, "publisher")) reason = "The authorizing publisher no longer holds publishing rights.";
    else {
      const exposure = exposureClosure(k, k.viewer(p.issuer_id), revs, audience);
      if (!exposure.ok) reason = `Exposure closure no longer holds: ${exposure.conflicts.map((c) => c.reason).join("; ")}`;
    }
    k.db.tx(() => {
      if (reason) {
        k.db.run("update publications set status = 'blocked' where id = ?", p.id);
        k.recordEvent({ kind: "publication_blocked", workspace_id: p.workspace_id, payload: { publication: p.id, reason }, audience: { mode: "workspace" } });
        k.notify(p.issuer_id, p.workspace_id, "embargo_blocked", { publication: p.id, reason });
      } else {
        k.db.run("update publications set status = 'published', published_at = ? where id = ?", k.now(), p.id);
        grantAudience(k, p.id, revs, audience);
        k.recordEvent({
          kind: "published",
          workspace_id: p.workspace_id,
          actor_id: embargo.authorized_by,
          payload: { publication: p.id, revs, audience, license: p.license, embargo_release: true },
          audience: audience.mode === "public" ? { mode: "public" } : { mode: "workspace" },
        });
      }
    });
    results.push({ publication: p.id, status: reason ? "blocked" : "published", reason });
  }
  return results;
}

/** Publications visible to the caller; blocked reasons only for workspace publishers. */
export function publicationsFor(k: Kernel, v: Viewer, filter: { workspace_id?: string; rev?: string } = {}) {
  let rows = filter.workspace_id
    ? k.db.all("select * from publications where workspace_id = ? order by created_at desc", filter.workspace_id)
    : k.db.all("select * from publications order by created_at desc");
  if (filter.rev) rows = rows.filter((p) => pj<string[]>(p.revs).includes(filter.rev!));
  return rows
    .filter((p) => {
      if (k.hasRole(p.workspace_id, v.id, "publisher", "owner")) return true;
      if (p.status !== "published") return false;
      return pj<string[]>(p.revs).every((r) => v.canSeeRev(r));
    })
    .map((p) => {
      const insider = v.member(p.workspace_id);
      return {
        id: p.id,
        title: p.title,
        workspace_id: insider ? p.workspace_id : undefined,
        issuer: k.agentDescriptor(p.issuer_id),
        revs: pj<string[]>(p.revs).map((r) => ({ rev: r, title: k.revRow(r)?.title, entity: k.revRow(r)?.entity_id, seq: k.revRow(r)?.seq })),
        audience: insider ? pj(p.audience) : { mode: pj(p.audience).mode === "public" ? "public" : "restricted" },
        license: p.license,
        status: p.status,
        embargo: insider ? pj(p.embargo) : undefined,
        exposure: k.hasRole(p.workspace_id, v.id, "publisher") ? pj(p.exposure) : undefined,
        assessment_snapshot: pj(p.assessment_snapshot),
        created_at: p.created_at,
        published_at: p.published_at,
      };
    });
}
