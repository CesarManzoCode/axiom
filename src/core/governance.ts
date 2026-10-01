// Governance (§28; Q22; AC38–AC40). Every decision is an attributable event with authority
// and scope. Nothing here rewrites content, history, credit or references.
import { j, newId } from "./db.ts";
import { DomainError, notFound, type Kernel, type Viewer } from "./kernel.ts";

// ------------------------------------------------------------------ identity overlay

/** Reversible alias overlay: records which anchors a curator considers duplicates. IDs keep resolving (I10). */
export function decideAlias(k: Kernel, actor: string, input: { workspace_id: string; entities: string[]; reason: string; kind?: "duplicate_record" | "same_concept_claim" }) {
  k.requireRole(input.workspace_id, actor, "curator");
  if (!k.isHuman(actor)) throw new DomainError("insufficient_permission", "Identity overlays are human curatorial decisions.");
  const v = k.viewer(actor);
  if (input.entities.length < 2) throw new DomainError("invalid_input", "An alias overlay relates at least two anchors.");
  for (const e of input.entities) if (!v.canSeeEntity(e)) throw notFound();
  const overlay = newId("ovl");
  k.recordEvent({
    kind: "identity",
    workspace_id: input.workspace_id,
    actor_id: actor,
    payload: { action: "alias", overlay, entities: input.entities, reason: input.reason, alias_kind: input.kind ?? "duplicate_record", policy: "local curator overlay" },
    audience: { mode: "workspace" },
  });
  return { overlay };
}

export function reverseAlias(k: Kernel, actor: string, input: { workspace_id: string; overlay: string; reason: string }) {
  k.requireRole(input.workspace_id, actor, "curator");
  const prev = k.events("kind = 'identity' and workspace_id = ?", input.workspace_id).find((e) => e.payload.overlay === input.overlay && e.payload.action === "alias");
  if (!prev) throw notFound();
  return k.recordEvent({
    kind: "identity",
    workspace_id: input.workspace_id,
    actor_id: actor,
    payload: { action: "alias_reversed", overlay: input.overlay, entities: prev.payload.entities, reason: input.reason },
    audience: { mode: "workspace" },
  });
}

/** Split/merge correspondence maps: new anchors plus mappings; old references are never redistributed. */
export function recordIdentityMap(
  k: Kernel,
  actor: string,
  input: { workspace_id: string; action: "split" | "merge"; from: string[]; to: string[]; mapping: { from: string; to: string; note?: string }[]; reason: string },
) {
  k.requireRole(input.workspace_id, actor, "curator");
  const v = k.viewer(actor);
  for (const e of [...input.from, ...input.to]) if (!v.canSeeEntity(e)) throw notFound();
  return k.recordEvent({
    kind: "identity",
    workspace_id: input.workspace_id,
    actor_id: actor,
    payload: { ...input, note: input.action === "merge" ? "A merge is a new synthesis; it does not prove equivalence nor delete anchors." : "Split anchors are new IDs; consumers migrate by their own revisions." },
    audience: { mode: "workspace" },
  });
}

/** Q22: overlays and maps touching an entity, with active/reversed state. */
export function identityRecords(k: Kernel, v: Viewer, entityId: string) {
  const all = k.events("kind = 'identity'").filter((e) => v.canSeeEvent(e));
  const touching = all.filter((e) => [...(e.payload.entities ?? []), ...(e.payload.from ?? []), ...(e.payload.to ?? [])].includes(entityId));
  const reversed = new Set(all.filter((e) => e.payload.action === "alias_reversed").map((e) => e.payload.overlay));
  return touching.map((e) => ({
    id: e.id,
    action: e.payload.action,
    overlay: e.payload.overlay,
    active: e.payload.action === "alias" ? !reversed.has(e.payload.overlay) : undefined,
    entities: (e.payload.entities ?? []).filter((x: string) => v.canSeeEntity(x)).map((x: string) => ({ id: x, title: k.entityRow(x)?.title })),
    from: e.payload.from,
    to: e.payload.to,
    mapping: e.payload.mapping,
    reason: e.payload.reason,
    actor: k.agentDescriptor(e.actor_id)?.name,
    at: e.recorded_at,
    note: "Overlay is presentational: anchors, revisions and citations keep resolving to their own content.",
  }));
}

// ------------------------------------------------------------------ cases: dispute, plagiarism, priority, appeal

const CASE_FLOW: Record<string, string[]> = {
  "": ["opened"],
  opened: ["assessed", "decided_for_policy"],
  assessed: ["assessed", "decided_for_policy"],
  decided_for_policy: ["appealed"],
  appealed: ["reassessed"],
  reassessed: ["reassessed", "decided_for_policy"],
};

export function governanceCase(
  k: Kernel,
  actor: string,
  input: {
    case_id?: string;
    case_kind: "dispute" | "plagiarism" | "priority" | "correction" | "moderation" | "identity";
    action: "opened" | "assessed" | "decided_for_policy" | "appealed" | "reassessed";
    subject_rev: string;
    allegation?: string;
    reason: string;
    evidence?: string[];
    decision?: string;
  },
) {
  const rev = k.revRow(input.subject_rev);
  const v = k.viewer(actor);
  if (!rev || !v.canSeeRev(input.subject_rev)) throw notFound();
  if (!k.isMember(rev.workspace_id, actor)) throw new DomainError("insufficient_permission", "Cases are handled within the workspace's policy.");
  if (input.action === "decided_for_policy" && !k.hasRole(rev.workspace_id, actor, "curator", "moderator"))
    throw new DomainError("insufficient_permission", "Decisions require the competent curator/moderator authority.");
  for (const e of input.evidence ?? []) if (!v.canSeeRev(e)) throw notFound();
  const caseId = input.case_id ?? newId("case");
  const prior = k.events("kind = 'governance' and subject_rev = ?", input.subject_rev).filter((e) => e.payload.case_id === caseId);
  const last = prior.at(-1)?.payload.action ?? "";
  if (!CASE_FLOW[last]?.includes(input.action))
    throw new DomainError("invalid_transition", `Case cannot go from '${last || "none"}' to '${input.action}'.`);
  const ev = k.recordEvent({
    kind: "governance",
    workspace_id: rev.workspace_id,
    actor_id: actor,
    subject_entity: rev.entity_id,
    subject_rev: input.subject_rev,
    payload: { ...input, case_id: caseId, authority: k.roles(rev.workspace_id, actor), note: "A policy decision is local; it does not decide mathematical truth." },
    audience: { mode: "subject" },
  });
  return { case_id: caseId, event_id: ev.id };
}

// ------------------------------------------------------------------ stewardship

export function proposeStewardship(k: Kernel, actor: string, entityId: string, input: { to: string; reason: string }) {
  const ent = k.entityRow(entityId);
  if (!ent || !k.viewer(actor).canSeeEntity(entityId)) throw notFound();
  if (ent.steward_id !== actor && !k.hasRole(ent.workspace_id, actor, "owner"))
    throw new DomainError("insufficient_permission", "Only the steward or a workspace owner proposes a transfer.");
  if (!k.agent(input.to)) throw notFound();
  return k.recordEvent({
    kind: "stewardship",
    workspace_id: ent.workspace_id,
    actor_id: actor,
    subject_entity: entityId,
    payload: { action: "transfer_proposed", from: ent.steward_id, to: input.to, reason: input.reason },
    audience: { mode: "workspace" },
  });
}

/** The recipient accepts; authorship and contributions stay untouched (AC39). */
export function acceptStewardship(k: Kernel, actor: string, entityId: string) {
  const ent = k.entityRow(entityId);
  if (!ent) throw notFound();
  const pending = k.events("kind = 'stewardship' and subject_entity = ?", entityId).filter((e) => e.payload.action === "transfer_proposed").at(-1);
  if (!pending || pending.payload.to !== actor) throw new DomainError("invalid_transition", "No transfer is pending for you.");
  return k.db.tx(() => {
    k.db.run("update entities set steward_id = ? where id = ?", actor, entityId);
    if (!k.isMember(ent.workspace_id, actor))
      k.db.run("insert into memberships(workspace_id, agent_id, roles, active, since) values(?,?,?,1,?)", ent.workspace_id, actor, j(["editor"]), k.now());
    return k.recordEvent({
      kind: "stewardship",
      workspace_id: ent.workspace_id,
      actor_id: actor,
      subject_entity: entityId,
      payload: { action: "transferred", from: pending.payload.from, to: actor, proposal: pending.id, note: "Authorship, discovery credit and third-party rights are not transferred." },
      audience: { mode: "workspace" },
    });
  });
}

/** Recovery when the steward is inactive (abandoned trajectory), by a workspace owner, audited. */
export function recoverStewardship(k: Kernel, actor: string, entityId: string, input: { reason: string }) {
  const ent = k.entityRow(entityId);
  if (!ent) throw notFound();
  k.requireRole(ent.workspace_id, actor, "owner");
  if (k.isMember(ent.workspace_id, ent.steward_id))
    throw new DomainError("invalid_transition", "The steward is active; propose a transfer instead.");
  return k.db.tx(() => {
    k.db.run("update entities set steward_id = ? where id = ?", actor, entityId);
    return k.recordEvent({
      kind: "stewardship",
      workspace_id: ent.workspace_id,
      actor_id: actor,
      subject_entity: entityId,
      payload: { action: "recovered", from: ent.steward_id, to: actor, reason: input.reason, note: "Recovery changes administration only." },
      audience: { mode: "workspace" },
    });
  });
}
