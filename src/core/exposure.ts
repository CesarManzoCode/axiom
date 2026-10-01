// Audience admission shared by seal-time and publication-time exposure checks.
import { pj } from "./db.ts";
import type { Kernel } from "./kernel.ts";
import type { Audience } from "./types.ts";

export interface AccessDescriptor {
  workspace_id: string;
  access: Audience & { owner?: string };
  publications: { kind: string; agent_id: string | null }[];
}

export function accessOf(k: Kernel, revId: string): AccessDescriptor | undefined {
  const rev = k.revRow(revId);
  if (!rev) return undefined;
  return {
    workspace_id: rev.workspace_id,
    access: pj(rev.access),
    publications: k.db.all("select kind, agent_id from rev_audience where rev_id = ?", revId) as any,
  };
}

function admitsAgent(k: Kernel, t: AccessDescriptor, agent: string) {
  if (t.publications.some((p) => p.kind === "public")) return true;
  if (t.access.owner === agent) return true;
  if (t.access.mode === "team" && k.isMember(t.workspace_id, agent)) return true;
  if (t.access.mode === "named" && (t.access.agents ?? []).includes(agent)) return true;
  return t.publications.some((p) => (p.kind === "named" && p.agent_id === agent) || (p.kind === "team" && k.isMember(t.workspace_id, agent)));
}

/**
 * Would every member of `audience` (interpreted in workspace `ws`, owned by `owner`) be able to
 * read the target? Team audiences require team/public access in the same workspace.
 */
export function admits(k: Kernel, t: AccessDescriptor, audience: Audience, ws: string, owner: string): boolean {
  if (t.publications.some((p) => p.kind === "public")) return true;
  switch (audience.mode) {
    case "public":
      return false;
    case "owner":
      return admitsAgent(k, t, owner);
    case "team":
      return (
        t.workspace_id === ws &&
        (t.access.mode === "team" || t.publications.some((p) => p.kind === "team"))
      );
    case "named":
      return admitsAgent(k, t, owner) && (audience.agents ?? []).every((a) => admitsAgent(k, t, a));
  }
}
