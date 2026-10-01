// Portable export/import (§7 reconstruction, I49, AC49). Exports keep IDs, revisions,
// contracts, roles, provenance, relations-on-relations, events and assessment policy/cut,
// filtered by the exporter's audience, with omissions declared.
import { canonicalJson, j, pj, sha256 } from "./db.ts";
import { DomainError, notFound, type Kernel, type Viewer } from "./kernel.ts";
import { indexEdges } from "./authoring.ts";
import { POLICIES, DEFAULT_POLICY } from "./status.ts";
import { CORE_CONTRACTS, VOCAB_VERSION } from "./vocab.ts";
import type { Lookup } from "./validate.ts";

export const EXPORT_FORMAT = "axiom-portable-export";
export const EXPORT_VERSION = 1;

export function exportWorkspace(k: Kernel, v: Viewer, ws: string, opts: { cut?: string; policy?: string } = {}) {
  const w = k.db.get("select * from workspaces where id = ?", ws);
  if (!w || !v.member(ws)) throw notFound();
  const cut = opts.cut ?? k.now();
  const entities = k.db.all("select * from entities where workspace_id = ? order by created_at", ws).filter((e) => v.canSeeEntity(e.id));
  const revisions = k.db.all("select * from revisions where workspace_id = ? and sealed_at <= ? order by sealed_at, seq", ws, cut).filter((r) => v.canSeeRev(r.id));
  const revIds = new Set(revisions.map((r) => r.id));
  const events = k.db
    .all("select * from events where workspace_id = ? and recorded_at <= ? order by recorded_at, rowid", ws, cut)
    .map((e) => k.eventRow(e))
    .filter((e) => v.canSeeEvent(e));
  const publications = k.db.all("select * from publications where workspace_id = ?", ws).filter((p) => pj<string[]>(p.revs).every((r) => revIds.has(r)));
  const agentIds = new Set<string>([...entities.map((e) => e.owner_id), ...entities.map((e) => e.steward_id), ...revisions.map((r) => r.sealed_by), ...events.map((e) => e.actor_id).filter(Boolean)]);
  const omittedRevs = k.db.get("select count(*) as n from revisions where workspace_id = ?", ws)!.n - revisions.length;
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    vocab: VOCAB_VERSION,
    exported_at: k.now(),
    cut,
    exporter: k.agentDescriptor(v.id),
    assessment_policy: { key: opts.policy ?? DEFAULT_POLICY, definitions: POLICIES },
    contracts: { core: CORE_CONTRACTS, extensions: k.db.all("select * from contracts where workspace_id = ?", ws).map((c) => ({ id: c.id, version: c.version, definition: pj(c.definition) })) },
    workspace: { id: w.id, name: w.name, description: w.description, root_context_rev: w.root_context_rev, created_at: w.created_at },
    agents: [...agentIds].map((a) => k.agentDescriptor(a)).filter(Boolean),
    entities: entities.map((e) => ({ ...e, facets: pj(e.facets), access: pj(e.access) })),
    revisions: revisions.map((r) => ({ ...r, content: pj(r.content), parents: pj(r.parents), access: pj(r.access) })),
    publications: publications.map((p) => ({ ...p, revs: pj(p.revs), audience: pj(p.audience), embargo: pj(p.embargo), exposure: pj(p.exposure), assessment_snapshot: pj(p.assessment_snapshot) })),
    rev_audience: k.db.all(`select * from rev_audience where rev_id in (${[...revIds].map(() => "?").join(",") || "''"})`, ...revIds),
    events,
    omissions: {
      drafts: "Drafts are not citable and are not exported.",
      restricted: omittedRevs > 0 ? "Some records are outside the exporter's audience and are omitted." : null,
      credentials: "Agent credentials are never exported.",
    },
  };
}

/** Export of one publication: only its manifest closure, already authorized for its audience. */
export function exportPublication(k: Kernel, v: Viewer, pubId: string) {
  const p = k.db.get("select * from publications where id = ?", pubId);
  if (!p || p.status !== "published") throw notFound();
  const revs = pj<string[]>(p.revs);
  if (!revs.every((r) => v.canSeeRev(r))) throw notFound();
  const closure = new Set<string>();
  const stack = [...revs];
  while (stack.length) {
    const cur = stack.pop()!;
    if (closure.has(cur) || !v.canSeeRev(cur)) continue;
    closure.add(cur);
    for (const e of k.db.all("select target_rev, via from refs where rev_id = ?", cur))
      if (!["parent", "provenance"].includes(e.via)) stack.push(e.target_rev);
  }
  const revisions = [...closure].map((id) => k.revRow(id)!).map((r) => {
    const c = pj(r.content);
    c.parents = (c.parents ?? []).filter((x: string) => v.canSeeRev(x));
    c.provenance = { ...c.provenance, sources: (c.provenance?.sources ?? []).filter((s: any) => v.canSeeRev(s.source.rev)) };
    if (c.provenance.derived_from_candidate && !v.canSeeRev(c.provenance.derived_from_candidate.rev)) delete c.provenance.derived_from_candidate;
    return { id: r.id, entity_id: r.entity_id, seq: r.seq, kind: r.kind, title: r.title, content: c, context_rev: r.context_rev, content_hash: r.content_hash, sealed_at: r.sealed_at, vocab: r.vocab };
  });
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    vocab: VOCAB_VERSION,
    publication: { id: p.id, title: p.title, license: p.license, audience: pj(p.audience).mode, published_at: p.published_at, revs, assessment_snapshot: pj(p.assessment_snapshot) },
    revisions,
    contracts: { core: CORE_CONTRACTS },
    omissions: { note: "Revision lineage and provenance inputs outside the publication audience are not included; content hashes refer to the full sealed snapshot." },
  };
}

/**
 * Restore a workspace export into this database, preserving every identifier.
 * Hashes are verified, edges re-indexed, and ancestry/containment re-validated.
 */
export function importWorkspace(k: Kernel, actor: string, data: any) {
  if (data?.format !== EXPORT_FORMAT || data.version !== EXPORT_VERSION)
    throw new DomainError("invalid_input", "Unsupported export format.");
  if (!k.isHuman(actor)) throw new DomainError("insufficient_permission", "Imports are performed by a human agent.");
  const ws = data.workspace;
  if (k.db.get("select 1 from workspaces where id = ?", ws.id)) throw new DomainError("invalid_transition", "This workspace already exists here.");
  for (const r of data.revisions) {
    if (sha256(canonicalJson(r.content)) !== r.content_hash)
      throw new DomainError("invalid_input", `Revision ${r.id} does not match its content hash.`);
  }
  return k.db.tx(() => {
    for (const a of data.agents) {
      if (!k.agent(a.id))
        k.db.run("insert into agents(id, kind, name, descriptor, created_at, operator_id) values(?,?,?,?,?,?)", a.id, a.kind, a.name, j({ imported: true }), k.now(), a.operator_id ?? null);
    }
    k.db.run("insert into workspaces(id, name, description, created_by, created_at, root_context_rev) values(?,?,?,?,?,?)", ws.id, ws.name, ws.description, actor, ws.created_at, ws.root_context_rev);
    k.db.run("insert into memberships(workspace_id, agent_id, roles, active, since) values(?,?,?,1,?)", ws.id, actor, j(["owner"]), k.now());
    for (const e of data.entities)
      k.db.run(
        `insert into entities(id, workspace_id, namespace, kind, facets, title, access, owner_id, steward_id, created_event, created_at, fixture_label)
         values(?,?,?,?,?,?,?,?,?,?,?,?)`,
        e.id, ws.id, e.namespace, e.kind, j(e.facets), e.title, j(e.access), e.owner_id, e.steward_id, e.created_event, e.created_at, e.fixture_label ?? null,
      );
    for (const c of data.contracts?.extensions ?? [])
      if (!k.db.get("select 1 from contracts where id = ? and version = ?", c.id, c.version))
        k.db.run("insert into contracts(id, version, workspace_id, definition, created_by, created_at) values(?,?,?,?,?,?)", c.id, c.version, ws.id, j(c.definition), actor, k.now());
    for (const r of data.revisions)
      k.db.run(
        `insert into revisions(id, entity_id, workspace_id, seq, kind, title, content, context_rev, parents, access, content_hash, sealed_at, sealed_by, seal_event, vocab)
         values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        r.id, r.entity_id, ws.id, r.seq, r.kind, r.title, j(r.content), r.context_rev, j(r.parents), j(r.access), r.content_hash, r.sealed_at, r.sealed_by, r.seal_event, r.vocab,
      );
    const byId = new Map(data.revisions.map((r: any) => [r.id, r]));
    const ents = new Map(data.entities.map((e: any) => [e.id, e]));
    const lookup: Lookup = (id) => {
      const r: any = byId.get(id) ?? (k.revRow(id) ? { ...k.revRow(id), content: k.revContent(id) } : undefined);
      if (!r) return undefined;
      return { id, entity_id: r.entity_id, workspace_id: ws.id, kind: r.kind, namespace: (ents.get(r.entity_id) as any)?.namespace ?? "curated", content: r.content };
    };
    for (const r of data.revisions) indexEdges(k, r.id, r.content, lookup);
    // Ancestry must be a DAG and parents must exist within the same entity.
    for (const r of data.revisions)
      for (const p of r.parents) {
        const pr: any = byId.get(p);
        if (!pr || pr.entity_id !== r.entity_id || pr.sealed_at > r.sealed_at) throw new DomainError("cycle", `Invalid ancestry for ${r.id}.`);
      }
    const structural = (rev: string) => k.db.all("select target_rev from refs where rev_id = ? and structural = 1", rev).map((x) => x.target_rev as string);
    for (const r of data.revisions) {
      const stack = structural(r.id);
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === r.id) throw new DomainError("cycle", "Imported structural containment contains a cycle.");
        if (seen.has(cur)) continue;
        seen.add(cur);
        stack.push(...structural(cur));
      }
    }
    for (const e of data.events)
      k.db.run(
        `insert into events(id, kind, workspace_id, actor_id, subject_entity, subject_rev, payload, occurred_at, recorded_at, audience)
         values(?,?,?,?,?,?,?,?,?,?)`,
        e.id, e.kind, ws.id, e.actor_id, e.subject_entity, e.subject_rev, j(e.payload), e.occurred_at, e.recorded_at, j(e.audience),
      );
    for (const p of data.publications)
      k.db.run(
        `insert into publications(id, workspace_id, issuer_id, revs, audience, license, status, embargo, exposure, assessment_snapshot, title, event_id, created_at, published_at)
         values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.id, ws.id, p.issuer_id, j(p.revs), j(p.audience), p.license, p.status, j(p.embargo), j(p.exposure), j(p.assessment_snapshot), p.title, p.event_id, p.created_at, p.published_at,
      );
    for (const a of data.rev_audience ?? []) k.db.run("insert into rev_audience(rev_id, kind, agent_id, publication_id) values(?,?,?,?)", a.rev_id, a.kind, a.agent_id, a.publication_id);
    k.recordEvent({ kind: "imported", workspace_id: ws.id, actor_id: actor, payload: { format: data.format, version: data.version, exported_at: data.exported_at, cut: data.cut, revisions: data.revisions.length }, audience: { mode: "workspace" } });
    return { workspace_id: ws.id, revisions: data.revisions.length, entities: data.entities.length, events: data.events.length };
  });
}
