// Event-sourced projections that are NOT content: validity lifecycle of revisions,
// work state of research items (with closure), curator selections. All append-only.
import { DomainError, notFound, type Kernel, type Viewer } from "./kernel.ts";
import { pj } from "./db.ts";
import { VALIDITY_ACTIONS, WORK_TRANSITIONS, type WorkState } from "./vocab.ts";

const before = (cut?: string) => (e: { recorded_at: string }) => !cut || e.recorded_at <= cut;

// ------------------------------------------------------------------ validity lifecycle

export type ValidityAction = (typeof VALIDITY_ACTIONS)[number];

/**
 * Lifecycle events are external to the snapshot (§7): corrected, superseded_in_scope,
 * retracted, availability_restricted, abandoned and restored can coexist; none edits content
 * and retraction never decides falsehood (I18).
 */
export function recordValidity(
  k: Kernel,
  actor: string,
  revId: string,
  input: { action: ValidityAction; scope: string; reason: string; by_rev?: string; restores?: ValidityAction; authority?: string; audience?: "subject" | "workspace" },
) {
  const rev = k.revRow(revId);
  if (!rev || !k.viewer(actor).canSeeRev(revId)) throw notFound();
  if (!VALIDITY_ACTIONS.includes(input.action)) throw new DomainError("invalid_input", "Unknown validity action.");
  const ws = rev.workspace_id;
  const isAuthor = rev.sealed_by === actor;
  const ok =
    input.action === "availability_restricted" || input.restores === "availability_restricted"
      ? k.hasRole(ws, actor, "moderator")
      : input.action === "retracted" || input.action === "corrected"
        ? isAuthor || k.hasRole(ws, actor, "curator", "editor")
        : k.hasRole(ws, actor, "curator", "editor");
  if (!ok)
    throw new DomainError(
      "insufficient_permission",
      "Third parties publish a critique instead of changing another trajectory's validity record.",
    );
  if (input.action === "restored" && !input.restores)
    throw new DomainError("invalid_input", "A restoration names the decision it reverts.");
  if (input.by_rev && !k.viewer(actor).canSeeRev(input.by_rev)) throw notFound();
  return k.recordEvent({
    kind: "validity",
    workspace_id: ws,
    actor_id: actor,
    subject_entity: rev.entity_id,
    subject_rev: revId,
    payload: { ...input, authority: input.authority ?? k.roles(ws, actor).join(",") },
    audience: { mode: input.audience ?? "subject" },
  });
}

export function validityOf(k: Kernel, v: Viewer, revId: string, cut?: string) {
  const events = k.events("kind = 'validity' and subject_rev = ?", revId).filter(before(cut)).filter((e) => v.canSeeEvent(e));
  const active = new Set<string>();
  for (const e of events) {
    if (e.payload.action === "restored") active.delete(e.payload.restores);
    else active.add(e.payload.action);
  }
  return {
    values: active.size ? [...active] : ["active"],
    events: events.map((e) => ({
      id: e.id,
      action: e.payload.action,
      scope: e.payload.scope,
      reason: e.payload.reason,
      by_rev: e.payload.by_rev,
      restores: e.payload.restores,
      actor: k.agentDescriptor(e.actor_id),
      authority: e.payload.authority,
      recorded_at: e.recorded_at,
    })),
  };
}

// ------------------------------------------------------------------ work state & closure

export function workStateOf(k: Kernel, entityId: string, cut?: string) {
  const events = k
    .events("subject_entity = ? and kind in ('work_state','closure_proposed','closure_decided','reopened')", entityId)
    .filter(before(cut));
  let state: WorkState = "not_started";
  const history: any[] = [];
  const closures: any[] = [];
  for (const e of events) {
    if (e.kind === "work_state") state = e.payload.to;
    if (e.kind === "closure_proposed") {
      state = "completion_claimed";
      closures.push({ id: e.id, artifact: e.payload.artifact, criterion: e.payload.criterion, proposed_by: k.agentDescriptor(e.actor_id), at: e.recorded_at, decision: null });
    }
    if (e.kind === "closure_decided") {
      state = e.payload.accepted ? "completed" : e.payload.return_to;
      const c = closures.find((x) => x.id === e.payload.proposal);
      if (c) c.decision = { accepted: e.payload.accepted, by: k.agentDescriptor(e.actor_id), reason: e.payload.reason, at: e.recorded_at, dimension: e.payload.dimension };
    }
    if (e.kind === "reopened") state = e.payload.to;
    history.push({ id: e.id, kind: e.kind, payload: e.payload, actor: k.agentDescriptor(e.actor_id), at: e.recorded_at });
  }
  return { state, history, closures };
}

function researchEntity(k: Kernel, actor: string, entityId: string) {
  const ent = k.entityRow(entityId);
  if (!ent || !k.viewer(actor).canSeeEntity(entityId)) throw notFound();
  if (ent.kind !== "research") throw new DomainError("invalid_input", "Work states apply to research items only.");
  return ent;
}

/** §34C transitions; `blocked` requires an evaluation event or a pending requirement (§14). */
export function transitionWork(
  k: Kernel,
  actor: string,
  entityId: string,
  input: { to: WorkState; reason: string; evidence?: string[] },
) {
  const ent = researchEntity(k, actor, entityId);
  k.requireRole(ent.workspace_id, actor, "editor");
  const { state } = workStateOf(k, entityId);
  if (input.to === "completed" || input.to === "completion_claimed")
    throw new DomainError("invalid_transition", "Completion goes through a closure proposal and decision.");
  if (!WORK_TRANSITIONS[state].includes(input.to))
    throw new DomainError("invalid_transition", `Cannot move from ${state} to ${input.to}.`);
  if (input.to === "blocked" && !(input.evidence ?? []).length)
    throw new DomainError(
      "invalid_transition",
      "'blocked' needs an evaluation (e.g. applicable barrier assessment) or a pending requirement as evidence; graph proximity is not enough.",
    );
  return k.recordEvent({
    kind: "work_state",
    workspace_id: ent.workspace_id,
    actor_id: actor,
    subject_entity: entityId,
    payload: { from: state, to: input.to, reason: input.reason, evidence: input.evidence ?? [] },
    audience: { mode: "workspace" },
  });
}

/** A closure proposal cites an exact artifact and the criterion; an author claim only reaches completion_claimed. */
export function proposeClosure(k: Kernel, actor: string, entityId: string, input: { artifact: string; criterion: string; idem_key?: string }) {
  const ent = researchEntity(k, actor, entityId);
  if (!k.isMember(ent.workspace_id, actor)) throw notFound();
  const v = k.viewer(actor);
  if (!k.revRow(input.artifact) || !v.canSeeRev(input.artifact))
    throw new DomainError("reference_unresolved", "A closure proposal cites an exact, accessible artifact revision.");
  const { state } = workStateOf(k, entityId);
  if (!["active", "blocked", "not_started"].includes(state))
    throw new DomainError("invalid_transition", `Cannot propose closure while ${state}.`);
  return k.recordEvent({
    kind: "closure_proposed",
    workspace_id: ent.workspace_id,
    actor_id: actor,
    subject_entity: entityId,
    payload: { artifact: input.artifact, criterion: input.criterion },
    audience: { mode: "workspace" },
    idem_key: input.idem_key,
  });
}

export function decideClosure(
  k: Kernel,
  actor: string,
  entityId: string,
  input: { proposal: string; accepted: boolean; reason: string; return_to?: "active" | "blocked"; dimension?: string },
) {
  const ent = researchEntity(k, actor, entityId);
  const latest = k.revisionsOf(entityId).at(-1);
  const responsible = latest ? pj(latest.content).payload?.responsible : undefined;
  if (!k.isHuman(actor)) throw new DomainError("insufficient_permission", "Closure decisions are made by an accountable human.");
  if (responsible !== actor && !k.hasRole(ent.workspace_id, actor, "curator"))
    throw new DomainError("insufficient_permission", "Only the responsible person or a curator can accept or reject closure.");
  const ws = workStateOf(k, entityId);
  if (ws.state !== "completion_claimed") throw new DomainError("invalid_transition", "No pending closure proposal.");
  const proposal = ws.closures.find((c) => c.id === input.proposal && !c.decision);
  if (!proposal) throw new DomainError("invalid_input", "Unknown or already decided proposal.");
  return k.recordEvent({
    kind: "closure_decided",
    workspace_id: ent.workspace_id,
    actor_id: actor,
    subject_entity: entityId,
    payload: {
      proposal: input.proposal,
      accepted: input.accepted,
      reason: input.reason,
      return_to: input.accepted ? "completed" : (input.return_to ?? "active"),
      dimension: input.dimension ?? "closure criterion",
      artifact: proposal.artifact,
      criterion: proposal.criterion,
    },
    audience: { mode: "workspace" },
  });
}

/** Reopen keeps the earlier closure on record (I29). */
export function reopen(k: Kernel, actor: string, entityId: string, input: { reason: string; to?: "active" | "blocked"; evidence?: string[] }) {
  const ent = researchEntity(k, actor, entityId);
  k.requireRole(ent.workspace_id, actor, "editor", "curator");
  const { state } = workStateOf(k, entityId);
  if (state !== "completed" && state !== "abandoned")
    throw new DomainError("invalid_transition", "Only completed or abandoned items are reopened.");
  return k.recordEvent({
    kind: "reopened",
    workspace_id: ent.workspace_id,
    actor_id: actor,
    subject_entity: entityId,
    payload: { from: state, to: input.to ?? "active", reason: input.reason, evidence: input.evidence ?? [] },
    audience: { mode: "workspace" },
  });
}

// ------------------------------------------------------------------ curator selection of assessments

/** Curator adopts one assessment as the workspace summary for a dimension; opposition stays visible. */
export function selectAssessment(
  k: Kernel,
  actor: string,
  input: { subject_rev: string; dimension: string; assessment_rev: string; reason: string },
) {
  const rev = k.revRow(input.subject_rev);
  const v = k.viewer(actor);
  if (!rev || !v.canSeeRev(input.subject_rev) || !v.canSeeRev(input.assessment_rev)) throw notFound();
  k.requireRole(rev.workspace_id, actor, "curator");
  if (!k.isHuman(actor)) throw new DomainError("insufficient_permission", "Curatorial selection is a human decision.");
  const a = k.revContent(input.assessment_rev);
  if (a?.kind !== "evaluation" || a.payload.subject?.rev !== input.subject_rev)
    throw new DomainError("invalid_input", "The selected assessment must evaluate this exact revision.");
  return k.recordEvent({
    kind: "assessment_selected",
    workspace_id: rev.workspace_id,
    actor_id: actor,
    subject_entity: rev.entity_id,
    subject_rev: input.subject_rev,
    payload: { dimension: input.dimension, assessment_rev: input.assessment_rev, reason: input.reason, policy: "workspace_curator_selection@1" },
    audience: { mode: "subject" },
  });
}
