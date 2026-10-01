// Controlled vocabularies of the semantic contract (handoff §9, §13, §14, §20, §24, §25, §34).
// Every value list is versioned through VOCAB_VERSION; exports carry it so a later
// vocabulary revision never reinterprets data sealed under an earlier one.

export const VOCAB_VERSION = "core@1";

export const PAYLOAD_KINDS = [
  "object",
  "declaration",
  "method",
  "argument",
  "research",
  "evaluation",
  "collection",
  "context",
  "relation",
  "source",
] as const;
export type PayloadKind = (typeof PAYLOAD_KINDS)[number];

export const ROLES = ["owner", "editor", "publisher", "curator", "moderator", "reviewer", "reader"] as const;
export type WorkspaceRole = (typeof ROLES)[number];

export const AGENT_KINDS = ["human", "group", "ai", "service"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const ORIGINS = ["human", "ai", "human_ai", "deterministic"] as const;
export const ACQUISITIONS = [
  "authorship",
  "import",
  "extraction",
  "inference",
  "formal_check",
  "computation",
  "editorial_transformation",
] as const;

// ---------------------------------------------------------------- epistemic status (§13)

export const STATUS_DIMENSIONS = [
  "logical",
  "evidence",
  "review",
  "formalization",
  "fidelity",
  "novelty",
  "provenance",
  "reproducibility",
  "validity",
  "disputes",
] as const;
export type StatusDimension = (typeof STATUS_DIMENSIONS)[number];

export const STATUS_VALUES: Record<StatusDimension, readonly string[]> = {
  logical: [
    "open",
    "proof_claimed",
    "supported_derivation",
    "refuted",
    "relative_independence",
    "inconsistent_context",
    "not_applicable",
    "conflicting",
    "not_evaluated",
  ],
  evidence: [
    "none_known",
    "sketch",
    "informal_proof",
    "formal_artifact",
    "checked_derivation",
    "certificate",
    "computation",
    "experiment",
    "example",
    "counterexample",
    "reproduction",
    "expert_review",
    "citation",
    "testimony",
    "mixed",
  ],
  review: ["unreviewed", "author_checked", "team_reviewed", "external_reviewed", "conflicting", "not_applicable"],
  formalization: [
    "none_known",
    "statement_only",
    "partial_proof",
    "complete_artifact",
    "check_pass_reported",
    "check_pass_reproduced",
    "check_failed",
    "stale_environment",
  ],
  fidelity: ["not_evaluated", "claimed", "reviewed_match", "reviewed_partial", "mismatch", "conflicting"],
  novelty: [
    "not_searched",
    "search_recorded",
    "prior_art_found",
    "independent_discovery_claimed",
    "reviewed_scope_claim",
    "disputed",
  ],
  provenance: ["recorded_complete_for_scope", "partial", "source_unresolved", "disputed"],
  reproducibility: [
    "not_applicable",
    "artifacts_missing",
    "artifacts_available",
    "reproduction_reported",
    "independently_reproduced",
    "failed",
    "not_evaluated",
  ],
  validity: ["active", "corrected", "superseded_in_scope", "retracted", "availability_restricted", "abandoned"],
  disputes: ["none_recorded", "open", "resolved_for_policy", "appealed", "multiple_conflicts"],
};

/** Value shown when nothing has been recorded for a dimension. Never a negative verdict (I16). */
export const STATUS_DEFAULT: Record<StatusDimension, string> = {
  logical: "not_evaluated",
  evidence: "none_known",
  review: "unreviewed",
  formalization: "none_known",
  fidelity: "not_evaluated",
  novelty: "not_searched",
  provenance: "partial",
  reproducibility: "not_evaluated",
  validity: "active",
  disputes: "none_recorded",
};

// Review finding namespaces (§34I). They never map automatically onto Logical.
export const FINDING_VALUES: Record<string, readonly string[]> = {
  correctness: ["supported_in_scope", "defect_found", "undetermined", "not_applicable"],
  completeness: ["complete_under_declared_assumptions", "gaps_found", "undetermined", "not_applicable"],
  references: ["substantiated", "incomplete", "incorrect", "undetermined", "not_applicable"],
  clarity: ["understandable_in_scope", "needs_clarification", "undetermined", "not_applicable"],
  fidelity: STATUS_VALUES.fidelity,
  novelty: STATUS_VALUES.novelty,
  reproducibility: STATUS_VALUES.reproducibility,
  formalization: STATUS_VALUES.formalization,
  context_consistency: ["not_evaluated", "relative_consistency_supported", "known_inconsistency", "disputed"],
  barrier_applicability: ["applies", "does_not_apply", "undetermined", "disputed"],
};
export const FINDING_DIMENSIONS = Object.keys(FINDING_VALUES);

/** Dimensions an assessment may target: the ten status axes plus the review namespaces. */
export const ASSESSABLE_DIMENSIONS = [...new Set([...STATUS_DIMENSIONS, ...FINDING_DIMENSIONS])];
export function allowedValues(dimension: string): readonly string[] | undefined {
  return (STATUS_VALUES as Record<string, readonly string[]>)[dimension] ?? FINDING_VALUES[dimension];
}

// ---------------------------------------------------------------- declarations (§11)

export const SEMANTIC_CATEGORIES = ["definitional", "propositional", "interrogative"] as const;
export const EDITORIAL_ROLES = [
  "definition",
  "axiom",
  "hypothesis",
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "conjecture",
  "observation",
  "question",
  "barrier",
  "example",
  "counterexample",
] as const;

// ---------------------------------------------------------------- arguments / evidence (§12)

export const ARGUMENT_KINDS = [
  "natural_language_proof",
  "sketch",
  "formal_proof",
  "machine_checked",
  "certificate",
  "computation",
  "experiment",
  "example",
  "counterexample",
  "reproduction",
  "expert_review",
  "citation",
  "testimony",
] as const;
export const ARGUMENT_EVIDENCE: Record<(typeof ARGUMENT_KINDS)[number], string> = {
  natural_language_proof: "informal_proof",
  sketch: "sketch",
  formal_proof: "formal_artifact",
  machine_checked: "checked_derivation",
  certificate: "certificate",
  computation: "computation",
  experiment: "experiment",
  example: "example",
  counterexample: "counterexample",
  reproduction: "reproduction",
  expert_review: "expert_review",
  citation: "citation",
  testimony: "testimony",
};
export const COMPLETENESS_CLAIMS = ["complete", "partial", "sketch", "source_reported"] as const;

// ---------------------------------------------------------------- dependencies (§25)

export const DEP_KINDS = [
  "formal",
  "explicit_informal",
  "inferred",
  "citation",
  "conceptual_influence",
  "necessary_assumption",
  "proof_local_use",
] as const;
export type DepKind = (typeof DEP_KINDS)[number];
export const DEP_ROLES = ["statement", "proof", "definition", "rule", "environment"] as const;
/** Dependency kinds that never propagate logical invalidity (I23). */
export const NON_LOGICAL_DEPS: ReadonlySet<string> = new Set(["citation", "conceptual_influence"]);

// ---------------------------------------------------------------- research (§14)

export const RESEARCH_ROLES = [
  "problem",
  "program",
  "objective",
  "obligation",
  "strategy",
  "approach",
  "attempt",
  "dead_end",
  "milestone",
  "experiment",
  "inquiry_line",
] as const;
export const WORK_STATES = [
  "not_started",
  "active",
  "paused",
  "blocked",
  "completion_claimed",
  "completed",
  "abandoned",
] as const;
export type WorkState = (typeof WORK_STATES)[number];
/** Allowed transitions (§34C). Reopen of a completed item is a separate event that lands in active/blocked. */
export const WORK_TRANSITIONS: Record<WorkState, readonly WorkState[]> = {
  not_started: ["active", "paused", "abandoned"],
  active: ["blocked", "paused", "completion_claimed", "abandoned"],
  paused: ["active", "abandoned"],
  blocked: ["active", "paused", "abandoned"],
  completion_claimed: ["completed", "active", "blocked"],
  completed: ["active", "blocked"],
  abandoned: ["active"],
};
export const PLAN_MODALITIES = [
  "proven_necessary",
  "proven_sufficient",
  "candidate_route",
  "diagnostic",
  "strategy",
  "local_requirement",
  "hypothetical",
] as const;
export const FAILURE_KINDS = [
  "logical_error",
  "unsatisfied_assumption",
  "local_counterexample",
  "demonstrated_technique_limitation",
  "computation_not_reproduced",
  "finite_search_no_hit",
  "budget_exhausted",
  "novelty_defeated",
  "unable_to_complete",
] as const;

// ---------------------------------------------------------------- candidates (§21)

export const GATE_STATES = ["proposed", "under_review", "promoted", "rejected", "quarantined"] as const;
export type GateState = (typeof GATE_STATES)[number];
export const GATE_TRANSITIONS: Record<GateState, readonly GateState[]> = {
  proposed: ["under_review", "rejected", "quarantined"],
  under_review: ["promoted", "rejected", "quarantined"],
  promoted: [],
  rejected: ["under_review"],
  quarantined: ["under_review"],
};

// ---------------------------------------------------------------- credit (§20)

export const CONTRIBUTION_ROLES = [
  "discovery",
  "statement",
  "proof",
  "alternative_proof",
  "simplification",
  "generalization",
  "counterexample",
  "definition",
  "formalization",
  "review",
  "correction",
  "connection_discovery",
  "computation",
  "exposition",
  "curation",
  "maintenance",
  "coordination",
  "translation",
  "transcription",
] as const;

// ---------------------------------------------------------------- semantic diff (§24)

export const CHANGE_CLASSES = [
  "typo_editorial",
  "notation_only",
  "translation",
  "same_statement_new_proof",
  "stronger_conclusion",
  "weaker_conclusion",
  "added_assumption",
  "removed_assumption",
  "weakened_assumption",
  "strengthened_assumption",
  "changed_quantifier",
  "changed_domain",
  "changed_foundation_import",
  "corrected_statement",
  "generalization",
  "specialization",
  "split_merge",
  "changed_resource_parameter",
  "retraction",
] as const;
export const CHANGE_STATUS = ["suggested", "proposed", "declared", "reviewed", "proved"] as const;

// ---------------------------------------------------------------- validity events (§7, §34C)

export const VALIDITY_ACTIONS = [
  "corrected",
  "superseded_in_scope",
  "retracted",
  "restored",
  "availability_restricted",
  "abandoned",
] as const;

// ---------------------------------------------------------------- relation contracts (§9, §34D)

export type Cardinality = { min: number; max: number | null };
export interface RoleSpec {
  role: string;
  card: Cardinality;
  /** Payload kinds allowed for participants in this role; empty = any. */
  kinds?: readonly string[];
  /** For declarations, allowed semantic categories. */
  categories?: readonly string[];
}
export interface RelationContract {
  id: string;
  version: string;
  family: string;
  roles: RoleSpec[];
  /** Roles whose participants are combined by an explicit logical grouping. */
  grouped?: string[];
  directed: boolean;
  /** Whether the impact engine may propagate along this contract, and how. */
  inference: "none" | "support" | "dependency" | "structural" | "equivalence" | "refutation" | "history";
  /** Structural containment: whole/part edges must remain acyclic (I08). */
  structural?: boolean;
  required_fields?: string[];
  description: string;
}

const n = (min: number, max: number | null = null): Cardinality => ({ min, max });
const PROPOSITIONAL = ["declaration", "relation", "research", "context"];

export const CORE_CONTRACTS: RelationContract[] = [
  {
    id: "entails",
    version: VOCAB_VERSION,
    family: "inference",
    roles: [
      { role: "premise", card: n(0), kinds: PROPOSITIONAL, categories: ["propositional"] },
      { role: "conclusion", card: n(1), kinds: PROPOSITIONAL, categories: ["propositional"] },
      { role: "condition", card: n(0), kinds: PROPOSITIONAL, categories: ["propositional", "definitional"] },
    ],
    grouped: ["premise", "conclusion"],
    directed: true,
    inference: "dependency",
    description:
      "Premises (grouped explicitly) entail conclusions under the Context and conditions. Zero premises means derivation from the Context alone.",
  },
  {
    id: "equivalent_under",
    version: VOCAB_VERSION,
    family: "inference",
    roles: [
      { role: "side", card: n(2), kinds: PROPOSITIONAL },
      { role: "condition", card: n(0), kinds: PROPOSITIONAL },
      { role: "map", card: n(0) },
    ],
    directed: false,
    inference: "equivalence",
    description: "Formulations equivalent under the stated context and conditions. Never identity; anchors stay distinct.",
  },
  {
    id: "proves",
    version: VOCAB_VERSION,
    family: "argumentation",
    roles: [
      { role: "evidence", card: n(1), kinds: ["argument", "evaluation", "relation"] },
      { role: "target", card: n(1), kinds: [...PROPOSITIONAL, "argument"] },
    ],
    directed: true,
    inference: "support",
    description: "Evidence purports a complete derivation of the target. Whether it succeeds is an Assessment.",
  },
  {
    id: "refutes",
    version: VOCAB_VERSION,
    family: "argumentation",
    roles: [
      { role: "evidence", card: n(1) },
      { role: "target", card: n(1) },
    ],
    directed: true,
    inference: "refutation",
    required_fields: ["negated"],
    description:
      "Evidence negates the target proposition or a step's validity. Refuting a Proof identifies a derivation defect; it does not refute the proof's conclusion.",
  },
  {
    id: "supports",
    version: VOCAB_VERSION,
    family: "argumentation",
    roles: [
      { role: "evidence", card: n(1) },
      { role: "target", card: n(1) },
    ],
    directed: true,
    inference: "support",
    description: "Partial or evidential support with explicit scope; no implication by default.",
  },
  {
    id: "challenges",
    version: VOCAB_VERSION,
    family: "argumentation",
    roles: [
      { role: "evidence", card: n(1) },
      { role: "target", card: n(1) },
    ],
    directed: true,
    inference: "none",
    description: "A reason questions the target within scope. Not a refutation.",
  },
  {
    id: "depends_on",
    version: VOCAB_VERSION,
    family: "use",
    roles: [
      { role: "consumer", card: n(1, 1) },
      { role: "input", card: n(1) },
    ],
    directed: true,
    inference: "dependency",
    required_fields: ["dependency_kind"],
    description: "Typed dependency of a consumer revision on exact inputs. Requires dependency_kind.",
  },
  {
    id: "uses",
    version: VOCAB_VERSION,
    family: "use",
    roles: [
      { role: "consumer", card: n(1, 1) },
      { role: "input", card: n(1) },
    ],
    directed: true,
    inference: "dependency",
    description: "Local use inside one activity or proof (proof-local), not a necessary premise of every derivation.",
  },
  {
    id: "imports",
    version: VOCAB_VERSION,
    family: "use",
    roles: [
      { role: "consumer", card: n(1, 1) },
      { role: "input", card: n(1) },
    ],
    directed: true,
    inference: "dependency",
    description: "Fixes interpretation and availability of declarations; does not mean every imported item is used.",
  },
  {
    id: "cites",
    version: VOCAB_VERSION,
    family: "use",
    roles: [
      { role: "consumer", card: n(1, 1) },
      { role: "input", card: n(1) },
    ],
    directed: true,
    inference: "none",
    description: "Citation for exposition, history or alleged support. Never a logical dependency.",
  },
  {
    id: "motivates",
    version: VOCAB_VERSION,
    family: "use",
    roles: [
      { role: "motivator", card: n(1) },
      { role: "motivated", card: n(1) },
    ],
    directed: true,
    inference: "none",
    description: "Conceptual influence or motivation. No validity propagation.",
  },
  {
    id: "isomorphic_to",
    version: VOCAB_VERSION,
    family: "correspondence",
    roles: [
      { role: "side", card: n(2) },
      { role: "witness", card: n(0) },
    ],
    directed: false,
    inference: "none",
    description: "Structures isomorphic via a witness (or visibly witness-not-yet-provided). Not equality.",
  },
  ...(["generalizes", "specializes", "instance_of", "reformulates", "translates"] as const).map(
    (id): RelationContract => ({
      id,
      version: VOCAB_VERSION,
      family: "correspondence",
      roles: [
        { role: "source", card: n(1) },
        { role: "target", card: n(1) },
        { role: "map", card: n(0) },
      ],
      directed: true,
      inference: "none",
      description: `Correspondence '${id}' with explicit direction, conditions and variable/context map. No automatic identity or new fact.`,
    }),
  ),
  {
    id: "reduces_to",
    version: VOCAB_VERSION,
    family: "construction",
    roles: [
      { role: "source", card: n(1, 1) },
      { role: "target", card: n(1, 1) },
      { role: "witness", card: n(0, 1) },
    ],
    directed: true,
    inference: "none",
    required_fields: ["regime"],
    description: "Reduction declaring regime (kind/resources/uniformity), preservation and transformation witness.",
  },
  {
    id: "constructs",
    version: VOCAB_VERSION,
    family: "construction",
    roles: [
      { role: "method", card: n(1) },
      { role: "object", card: n(1) },
      { role: "witness", card: n(0) },
    ],
    directed: true,
    inference: "none",
    description: "A method constructs objects; outputs and choices are explicit.",
  },
  {
    id: "characterizes",
    version: VOCAB_VERSION,
    family: "construction",
    roles: [
      { role: "criteria", card: n(1) },
      { role: "object", card: n(1) },
    ],
    directed: true,
    inference: "none",
    description: "Criteria characterize (biconditionally) the object.",
  },
  ...(["derived_from", "revises", "corrects", "retracts", "supersedes"] as const).map(
    (id): RelationContract => ({
      id,
      version: VOCAB_VERSION,
      family: "history",
      roles: [
        { role: "new", card: n(1) },
        { role: "old", card: n(1) },
      ],
      directed: true,
      inference: "history",
      required_fields: id === "corrects" ? ["defect_locator"] : undefined,
      description: `Editorial/historical relation '${id}' with exact revisions and scope. Retraction does not imply negation.`,
    }),
  ),
  {
    id: "formalizes",
    version: VOCAB_VERSION,
    family: "formal_expression",
    roles: [
      { role: "formal", card: n(1) },
      { role: "meaning", card: n(1) },
      { role: "map", card: n(0) },
    ],
    directed: true,
    inference: "none",
    description: "A formal expression formalizes a human statement. Does not certify fidelity.",
  },
  {
    id: "faithfully_expresses",
    version: VOCAB_VERSION,
    family: "formal_expression",
    roles: [
      { role: "formal", card: n(1) },
      { role: "meaning", card: n(1) },
      { role: "map", card: n(0) },
    ],
    directed: true,
    inference: "none",
    description: "Claim that an expression faithfully expresses a meaning; needs a fidelity evaluation and scope.",
  },
  ...(["has_part", "contains"] as const).map(
    (id): RelationContract => ({
      id,
      version: VOCAB_VERSION,
      family: "composition",
      roles: [
        { role: "whole", card: n(1, 1) },
        { role: "part", card: n(1) },
      ],
      directed: true,
      inference: "structural",
      structural: true,
      description: `Editorial membership '${id}'. Does not transmit permissions or validity. Acyclic.`,
    }),
  ),
  {
    id: "decomposes_into",
    version: VOCAB_VERSION,
    family: "composition",
    roles: [
      { role: "whole", card: n(1, 1) },
      { role: "part", card: n(1) },
    ],
    directed: true,
    inference: "none",
    required_fields: ["plan_mode"],
    description:
      "Research plan: an objective decomposes into routes/obligations, each with one declared modality; AND/OR is local to this plan.",
  },
  {
    id: "summarizes",
    version: VOCAB_VERSION,
    family: "composition",
    roles: [
      { role: "summary", card: n(1, 1) },
      { role: "subject", card: n(1) },
    ],
    directed: true,
    inference: "none",
    description: "Refers to content without containing its proof. Non-structural.",
  },
];

export const CONTRACT_INDEX = new Map(CORE_CONTRACTS.map((c) => [c.id, c]));
