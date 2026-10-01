// Payload contracts (handoff §34B). Zod schemas validate content at the seal boundary;
// drafts may hold partial content and are only validated strictly when sealed.
import { z } from "zod";
import {
  ACQUISITIONS,
  ARGUMENT_KINDS,
  CHANGE_CLASSES,
  CHANGE_STATUS,
  COMPLETENESS_CLAIMS,
  CONTRIBUTION_ROLES,
  DEP_KINDS,
  DEP_ROLES,
  EDITORIAL_ROLES,
  FAILURE_KINDS,
  ORIGINS,
  PAYLOAD_KINDS,
  PLAN_MODALITIES,
  RESEARCH_ROLES,
  SEMANTIC_CATEGORIES,
} from "./vocab.ts";

const text = z.string().trim().min(1);
const optText = z.string().optional();

/**
 * Reference forms. Only `rev` is admissible in sealed content (I05). `draft` is resolved
 * inside a joint snapshot (cohort); `entity`+`selector` is a live selector for drafts only.
 */
export const RefSchema = z.union([
  z.object({ rev: text, slot: optText }).strict(),
  z.object({ draft: text, slot: optText }).strict(),
  z.object({ entity: text, selector: z.enum(["latest", "preferred"]) }).strict(),
]);
export type Ref = z.infer<typeof RefSchema>;
export type ExactRef = { rev: string; slot?: string };

export const RefUseSchema = z.object({
  ref: RefSchema,
  purpose: z.enum([...DEP_KINDS, "evidence", "example", "background"]),
  role: z.enum(DEP_ROLES).optional(),
  locator: optText,
  origin: z.enum(["explicit", "inferred", "formal"]).default("explicit"),
  inference: z.object({ method: text, reason: text }).optional(),
  accepted: z.boolean().optional(),
  note: optText,
});
export type RefUse = z.infer<typeof RefUseSchema>;

const Binding = z.object({ symbol: text, meaning: text });
const Assumption = z.object({
  id: text,
  expr: text,
  variables: z.array(z.string()).default([]),
  scope: z.enum(["local", "global"]).default("local"),
  discharge: optText,
  source: RefSchema.optional(),
});

export const RepresentationSchema = z.object({
  id: text,
  modality: z.enum(["text", "latex", "formal", "diagram", "computational", "image"]),
  language: optText,
  format: optText,
  content: z.string(),
  meaning_role: z.enum(["statement", "narrative", "proof", "artifact", "drawing", "definition"]).default("statement"),
  system: optText,
  bindings: z.array(Binding).default([]),
  diagram: z
    .object({
      vertices: z.array(z.object({ id: text, label: text, ref: RefSchema.optional() })),
      arrows: z.array(
        z.object({ id: text, from: text, to: text, label: text, ref: RefSchema.optional() }),
      ),
      faces: z
        .array(z.object({ id: text, arrows: z.array(z.string()), commutes_claim: RefSchema.optional() }))
        .default([]),
      equations: z.array(z.string()).default([]),
    })
    .optional(),
});
export type Representation = z.infer<typeof RepresentationSchema>;

const UNKNOWN_DATE = z.union([z.literal("unknown"), z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?/)]);
export const ProvenanceSchema = z.object({
  origin: z.enum(ORIGINS),
  acquisition: z.enum(ACQUISITIONS),
  sources: z.array(z.object({ source: RefSchema, locator: z.string().default("") })).default([]),
  original_attribution: optText,
  dates: z
    .object({
      discovery_claimed_at: UNKNOWN_DATE.optional(),
      communicated_at: UNKNOWN_DATE.optional(),
      source_published_at: UNKNOWN_DATE.optional(),
    })
    .default({}),
  ai_run: z
    .object({
      model: z.string().default("unknown"),
      provider: z.string().default("unknown"),
      version: z.string().default("unknown"),
      config: optText,
      tools: optText,
    })
    .optional(),
  derived_from_candidate: z
    .object({ rev: text, mapping: z.enum(["whole", "fragment", "edited"]), locator: optText })
    .optional(),
  public_limitation: optText,
  notes: optText,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ContributionSchema = z.object({
  agent: optText,
  descriptor: optText,
  roles: z.array(z.enum(CONTRIBUTION_ROLES)).min(1),
  scope: optText,
  character: z.enum(["claimed", "acknowledged", "disputed"]).default("claimed"),
  evidence: optText,
});
export type Contribution = z.infer<typeof ContributionSchema>;

// ---------------------------------------------------------------- kind payloads

const Variable = z.object({ name: text, domain: optText, binder: z.enum(["forall", "exists", "free", "ae"]).optional() });

export const ObjectPayload = z.object({
  description: text,
  parameters: z.array(Variable).default([]),
});
export const DeclarationPayload = z.object({
  category: z.enum(SEMANTIC_CATEGORIES),
  statement: text,
  variables: z.array(Variable).default([]),
  assumptions: z.array(Assumption).default([]),
  conclusion: optText,
  usage: z.enum(["axiom", "hypothesis"]).optional(),
  editorial_roles: z.array(z.enum(EDITORIAL_ROLES)).default([]),
  answer_criterion: optText,
  barrier: z
    .object({ predicate: text, conditions: z.array(z.string()).default([]), restricts: text })
    .optional(),
  formal: z.object({ system: text, text: text, identifiers: z.array(z.string()).default([]) }).optional(),
});
export const MethodPayload = z.object({
  description: text,
  parameters: z.array(Variable).default([]),
  regime: optText,
  applicability: optText,
});

const DependencySet = z.object({
  id: text,
  members: z.array(RefSchema).min(1),
  rules: z.array(z.string()).default([]),
  scope: text,
  minimality: z.enum(["none_claimed", "inclusion_minimal", "cardinal_minimum"]).default("none_claimed"),
  method: optText,
  certificate: optText,
  completeness: z.enum(["exact_for_this_derivation", "declared_partial", "not_extracted"]).default("declared_partial"),
});
export const ArgumentPayload = z.object({
  targets: z.array(RefSchema).min(1),
  argument_kind: z.enum(ARGUMENT_KINDS),
  completeness: z.enum(COMPLETENESS_CLAIMS),
  summary: optText,
  steps: z
    .array(z.object({ id: text, text: text, uses: z.array(RefSchema).default([]) }))
    .default([]),
  gaps: z.array(z.object({ id: text, text: text })).default([]),
  discharged: z.array(z.string()).default([]),
  undischarged: z.array(z.string()).default([]),
  dependency_sets: z.array(DependencySet).default([]),
  formal: z
    .object({
      system: text,
      environment: RefSchema.optional(),
      identifiers: z.array(z.string()).default([]),
      kernel_dependencies: z.enum(["not_extracted", "extracted"]).default("not_extracted"),
    })
    .optional(),
  protocol: z
    .object({ description: text, range: optText, parameters: optText, artifacts: optText })
    .optional(),
  analyzes: RefSchema.optional(),
});

const Failure = z.object({
  kind: z.enum(FAILURE_KINDS),
  defect_locator: text,
  observed: text,
  allowed_negative_conclusion: text,
  non_conclusions: z.array(text).min(1),
  barrier_applicability: z.object({
    status: z.enum(["none_known", "not_evaluated", "evaluated"]),
    barrier: RefSchema.optional(),
    test: optText,
  }),
  successors: z.union([z.literal("none_recorded"), z.array(RefSchema).min(1)]),
  evaluator: text,
  evaluated_at: text,
  range: optText,
});
export const ResearchPayload = z.object({
  role: z.enum(RESEARCH_ROLES),
  goal: text,
  target: RefSchema.optional(),
  closure_criterion: optText,
  answer_criterion: optText,
  responsible: optText,
  attempt: z
    .object({
      strategy: text,
      approach: optText,
      protocol: optText,
      steps: z.array(z.object({ id: text, text: text })).default([]),
      outputs: z.array(RefSchema).default([]),
      observed: optText,
      result: z.enum(["succeeded", "partial", "failed", "in_progress"]),
      artifacts: z.array(RefSchema).default([]),
      artifacts_missing_reason: optText,
      failure: Failure.optional(),
    })
    .optional(),
  selection: z.array(RefSchema).default([]),
  baseline: optText,
});

const Finding = z.object({ dimension: text, value: text, locator: optText, text: optText, source_verdict: optText });
export const EvaluationPayload = z.object({
  eval_kind: z.enum(["assessment", "review", "comparison", "applicability", "consistency"]),
  subject: RefSchema,
  locator: optText,
  dimension: optText,
  value: optText,
  source_verdict: optText,
  scope: text,
  reason: optText,
  evidence: z.array(RefSchema).default([]),
  assessor: z.object({ agent: optText, descriptor: optText }).optional(),
  findings: z.array(Finding).default([]),
  barrier: RefSchema.optional(),
  predicate: optText,
  context_note: optText,
  conflicts_of_interest: optText,
  independence: optText,
  comparison: z
    .object({
      old: RefSchema,
      new: RefSchema,
      context_mapping: z.string().default("same context"),
      changes: z.array(
        z.object({ class: z.enum(CHANGE_CLASSES), description: text, status: z.enum(CHANGE_STATUS) }),
      ),
      verdict: z.enum(["comparable", "incomparable", "unknown"]),
    })
    .optional(),
});

const ManifestItem = z.object({
  slot: text,
  ref: RefSchema,
  role: z.string().default("component"),
  relation: z.enum(["has_part", "contains", "imports", "uses", "summarizes", "references"]).default("contains"),
  partition: z.enum(["mandatory", "recommended", "background"]).optional(),
  order: z.number().optional(),
  note: optText,
});
export const CollectionPayload = z.object({
  purpose: z.enum(["collection", "package", "theory", "program", "narrative", "paper", "bundle"]),
  description: optText,
  manifest: z.array(ManifestItem).default([]),
  narrative: z
    .array(
      z.object({
        id: text,
        type: z.enum(["heading", "prose", "transclusion"]),
        text: optText,
        ref: RefSchema.optional(),
      }),
    )
    .default([]),
  external_requirements: z.array(z.string()).default([]),
  bundle: z.any().optional(),
});

export const ContextPayload = z.object({
  root: z.boolean().default(false),
  profile: z.enum(["classical_informal", "unknown", "formal", "computational", "custom"]).default("custom"),
  parent: RefSchema.optional(),
  foundations: text,
  inference_rules: optText,
  axioms: z.array(z.object({ id: text, text: text })).default([]),
  assumptions: z.array(Assumption).default([]),
  universes: optText,
  imports: z.array(RefSchema).default([]),
  definitions: z.array(RefSchema).default([]),
  conventions: optText,
  notation: z.array(Binding).default([]),
  resolutions: z.array(z.object({ symbol: text, choice: text })).default([]),
  execution: z
    .object({
      kernel: optText,
      libraries: optText,
      software: optText,
      data: optText,
      precision: optText,
      seed: optText,
      parameters: optText,
      hardware: optText,
    })
    .optional(),
  trust_boundary: optText,
});

export type GroupExpr = { op: "AND" | "OR"; items: (string | GroupExpr)[] };
const GroupExprSchema: z.ZodType<GroupExpr> = z.lazy(() =>
  z.object({ op: z.enum(["AND", "OR"]), items: z.array(z.union([z.string(), GroupExprSchema])).min(1) }),
);
export const RelationPayload = z.object({
  contract: z.object({ id: text, version: text }),
  slots: z
    .array(
      z.object({
        slot: text,
        role: text,
        ref: RefSchema,
        order: z.number().optional(),
        modality: z.enum(PLAN_MODALITIES).optional(),
        note: optText,
      }),
    )
    .min(1),
  grouping: z.record(z.string(), GroupExprSchema).default({}),
  hypotheses: z.array(z.object({ id: text, text: text, ref: RefSchema.optional() })).default([]),
  scope: optText,
  modality: z.enum(["logical", "evidential", "heuristic", "editorial", "historical", "formal_mapping"]),
  quantitative_scope: optText,
  interpretation: text,
  fields: z.record(z.string(), z.string()).default({}),
  witness_not_provided: z.boolean().optional(),
  pairing: z.enum(["all_pairs", "listed_pairs"]).optional(),
  assertion: z.enum(["asserted", "claimed", "conjectured"]).default("asserted"),
});

export const SourcePayload = z.object({
  source_kind: z.enum(["paper", "book", "preprint", "web", "dataset", "formal_library", "discussion", "thesis", "other"]),
  citation: text,
  authors: z.array(z.string()).default([]),
  edition: optText,
  locator: optText,
  url: optText,
  retrieved_at: optText,
  source_published_at: optText,
  rights: z.object({ status: z.enum(["known", "unknown"]), note: optText }),
  availability: z.enum(["available", "restricted", "unavailable", "unknown"]),
  revision_identity: z.object({ status: z.enum(["exact", "unknown"]), value: optText, reason: optText }),
  artifact_hash: optText,
});

export const PAYLOAD_SCHEMAS = {
  object: ObjectPayload,
  declaration: DeclarationPayload,
  method: MethodPayload,
  argument: ArgumentPayload,
  research: ResearchPayload,
  evaluation: EvaluationPayload,
  collection: CollectionPayload,
  context: ContextPayload,
  relation: RelationPayload,
  source: SourcePayload,
} as const;

export const ContentSchema = z.object({
  kind: z.enum(PAYLOAD_KINDS),
  title: text,
  facets: z.array(z.string()).default([]),
  context: z.union([RefSchema, z.object({ self: z.literal(true) })]),
  payload: z.record(z.string(), z.any()),
  representations: z.array(RepresentationSchema).default([]),
  references: z.array(RefUseSchema).default([]),
  provenance: ProvenanceSchema,
  contributions: z.array(ContributionSchema).default([]),
  parents: z.array(z.string()).default([]),
  change_summary: optText,
  fixture_label: z.enum(["synthetic_product_fixture", "literature_transcription"]).optional(),
});
export type Content = z.infer<typeof ContentSchema>;

export type ObjectP = z.infer<typeof ObjectPayload>;
export type DeclarationP = z.infer<typeof DeclarationPayload>;
export type ArgumentP = z.infer<typeof ArgumentPayload>;
export type ResearchP = z.infer<typeof ResearchPayload>;
export type EvaluationP = z.infer<typeof EvaluationPayload>;
export type CollectionP = z.infer<typeof CollectionPayload>;
export type ContextP = z.infer<typeof ContextPayload>;
export type RelationP = z.infer<typeof RelationPayload>;
export type SourceP = z.infer<typeof SourcePayload>;

export interface Audience {
  mode: "owner" | "team" | "named" | "public";
  agents?: string[];
}
