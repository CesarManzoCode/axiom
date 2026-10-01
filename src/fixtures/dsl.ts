// Fixture format for the handoff corpus (§29–30) and for manual literature imports.
// References inside fixture payloads are written as { key } (optionally with slot) and are
// resolved to exact revisions while loading. Fixtures enter as *candidates* produced by the
// transcription agent and are admitted by a human batch gate decision (§29 boundary).
import type { PayloadKind } from "../core/vocab.ts";

export type Key = { key: string; slot?: string };

export interface FixItem {
  key: string;
  kind: PayloadKind;
  title: string;
  /** Context key; defaults to "ROOT" (the workspace root context). Contexts use "ROOT" too. */
  context?: string;
  facets?: string[];
  payload: Record<string, any>;
  references?: {
    key: string;
    purpose: string;
    role?: "statement" | "proof" | "definition" | "rule" | "environment";
    locator?: string;
    origin?: "explicit" | "inferred" | "formal";
    inference?: { method: string; reason: string };
  }[];
  /** Provenance sources by source-item key with locator. */
  sources?: { key: string; locator: string }[];
  /** Original authors of the content (not the importer). */
  attribution?: string;
  /** Row profile of §29 (D/T/H/M/P/R/F); expands into attributed default assessments. */
  profile?: "D" | "T" | "H" | "M" | "P" | "R" | "F";
  /** Only the statement is accessible (T rows): evidence modality is citation instead of informal proof. */
  statement_only?: boolean;
  label?: "literature_transcription" | "synthetic_product_fixture";
  representations?: any[];
  /** Kept in the candidate inbox (not promoted), e.g. N01 or an inferred-dependency proposal. */
  candidate_only?: boolean;
  dates?: { source_published_at?: string; discovery_claimed_at?: string; communicated_at?: string };
}

export type PostOp =
  | { op: "validity"; subject: string; action: "corrected" | "superseded_in_scope" | "retracted" | "availability_restricted" | "abandoned"; scope: string; reason: string; by?: string }
  | {
      op: "revise";
      key: string;
      of: string;
      title?: string;
      payload: Record<string, any>;
      change_summary: string;
      comparison?: { changes: { class: string; description: string; status: "proposed" | "declared" | "reviewed" | "proved" }[]; verdict: "comparable" | "incomparable" | "unknown"; scope: string };
      corrects?: { defect_locator: string; scope: string };
    }
  | { op: "gate"; subject: string; to: "under_review" | "rejected" | "quarantined"; reason: string }
  | { op: "work_state"; subject: string; to: "active" | "paused" | "blocked" | "abandoned"; reason: string; evidence?: string[] }
  | { op: "preferred"; subject: string; scope: string };

export interface Fixture {
  name: string;
  description: string;
  contracts?: { id: string; version: string; roles: { role: string; card: { min: number; max: number | null } }[]; description: string }[];
  items: FixItem[];
  post?: PostOp[];
}

export const k = (key: string, slot?: string): Key => (slot ? { key, slot } : { key });
