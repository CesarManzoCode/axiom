# Axiom — research workspace for attributed, revisioned mathematical knowledge

V1 of the product defined by *PLATFORM CONCEPT AND IMPLEMENTATION HANDOFF* (decision 1, 1 Oct 2026).
A person or team writes narrative and statements, reuses exact revisions, records proofs,
reviews, connections, obligations and failed attempts with their scope, sees what a change
affects, and publishes only what they choose — without operating an ontology.

## Run it

```bash
npm install
npm run seed      # demo DB at data/axiom.sqlite (AXIOM_DB to override): §29–30 corpus + demo users
npm run build     # typecheck + UI bundle
npm start         # http://localhost:4400
```

Development: `npm run dev` (API on :4400 with reload, UI on :5173 proxied).
Demo accounts (password `axiom-demo`): **ana** (owner), **ben** (editor/reviewer), **rita** (curator/publisher).
Quality gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`; Node prints an experimental warning).

## Architecture

One TypeScript package, three layers:

| Layer | Where | Role |
|---|---|---|
| Domain core | `src/core/` | Pure domain logic over a single SQLite file. All semantics live here. |
| Transport | `src/server/` | Express: `POST /api/rpc/:method` over the core's method table, static UI, embargo timer, seed. |
| UI | `src/web/` | React SPA: research workflows (entity pages, drafts, cockpit, inbox, publish, impact, bundles, diff, export). |

Core modules: `kernel` (clock, errors, agents, memberships, **Viewer** access filter, append-only events) ·
`authoring` (workspaces, root context bootstrap, entities, drafts, cohort seal, live-selector resolution) ·
`validate` (relation contracts, contexts, evaluations, research/failure contracts) · `refs` (typed edge index) ·
`state` (validity lifecycle, work state, closure, curator selection) · `status` (10-dimension status under
policy + cut, support sets) · `candidates` (gate) · `exposure`/`publication` (closure, publish, embargo) ·
`impact` · `bundle` · `diff` · `research` (plans, routes, barriers, failures) · `governance` · `queries` (Q01–Q25
projections) · `portable` (export/import) · `platform` (auth + zod-validated method table).

How the handoff's non-negotiables are made structural:

- **Entity ≠ file, Revision ≠ mutable state** — `entities` are anchors; `revisions` are immutable, hashed
  snapshots with exact context, parents and content; only `drafts` mutate, with a generation check
  (conflicts become alternatives, never overwrites). Cohorts seal atomically with reserved IDs.
- **Relation ≠ anonymous edge** — relations are entities whose content holds a versioned contract,
  role-labelled slots (order, plan modality), explicit AND/OR grouping, hypotheses, scope and modality.
  Every reference in any content is indexed as a typed edge (`refs`), so relations about relations,
  n-ary role positions and inverse queries work uniformly. Unknown contracts are refused; extension
  contracts carry no inference.
- **Truth is attributed** — status is computed from evaluation entities on an *exact* revision, per
  dimension, under a declared policy (`workspace_curator_selection@1`, `attributed_positions@1`,
  `author_only@1`) and time cut. Unknown/not-evaluated are explicit values; no global “verified”.
- **Proof invalidation ≠ refutation; failure ≠ impossibility** — each argument is an OR-branch of
  support; losing one reports “no accepted support known”, never false. Failed attempts must carry a
  defect locator, maximal negative conclusion and non-conclusions (finite searches need their range).
- **Citation ≠ dependency** — dependency kinds (formal, explicit informal, proof-local, inferred,
  citation, influence, necessary assumption) are stored per edge; impact follows typed rules, stops at
  citations (source alert only) and at retained alternative support, and reports budget/unknown.
- **Candidate ≠ curated** — candidates live in their own namespace, are excluded from curated answers,
  support and impact; only an authorized human gate (never an agent) promotes, with scope, mapping
  (whole/edited/fragment) and preserved AI origin.
- **Private ≠ hidden page** — one `Viewer` filters every query, export, bundle, notification and error.
  Inaccessible and absent IDs return the same error. Sealing and publishing run an exposure closure
  over semantic references (ancestry and provenance lineage excluded, filtered in projections).
- **Publication ≠ approval; embargo ≠ timer** — publications fix exact revisions for an audience with a
  status snapshot; embargoed releases need prior authorization and re-validate exposure.

## Corpus fixtures

`src/fixtures/corpus.ts` transcribes §29 (P01–P80, contexts, sources M01–M17, scenario objects O01–O08,
N01, FA01, CE01, RV01, FL01, SD01, SU01, ST01, RP01, RR01, FN01) and §30 (A–E with X01–X07). They are
loaded by `src/fixtures/load.ts` exactly like an import: the transcription agent submits candidates and
a human curator records one batch gate decision; synthetic scenarios stay labelled
`synthetic_product_fixture`. No fixture-specific logic exists in the core.

## Acceptance (§36) → tests

| Tests | Criteria |
|---|---|
| `tests/revisions.test.ts` | AC01, 02, 09, 11, 12, 31, 32, 46, 47, 48, 57; I32/I34 context conflicts |
| `tests/semantics.test.ts` | AC03–08, 10, 13–20, 41, 51–54, 56 and the twenty §29 cases |
| `tests/candidates.test.ts` | AC26–29, gate transitions |
| `tests/privacy.test.ts` | AC30, 33–40, 42, 58 |
| `tests/crossdomain.test.ts` | AC21–25, 43–45 (§30 A–E) |
| `tests/portable.test.ts` | AC49, AC55 |
| `tests/workflows.test.ts` | AC50: the fifteen §27 workflows over HTTP |

## Declared V1 limits

Within the handoff's V1 boundary (§33), these are manual or later by design: literature import is
register-source + paste + select fragments (no automatic PDF/LaTeX parsing); formal artifacts are
imported with reported checks (no kernel execution or kernel-dependency extraction); diff suggestions
are lexical/structural candidates with manual classification; authentication is local accounts and
agent bearer tokens; notifications are in-app; concurrency is optimistic (alternatives on conflict);
graph layout is a bounded radial projection. No performance budget is published; traversals report
their coverage instead of truncating silently.
