// Handoff manual stress-test corpus (§29 "P vs NP manual stress test", §30 "Cross-domain stress
// tests" A–E) transcribed into the fixture DSL. English paraphrase of the Spanish handoff rows;
// keys are exactly the handoff IDs. Helper items use the prefixes S_ (statements/objects/arguments
// the rows need as participants), R_ (relations, routes, plans) and CTX_ (combined contexts).
// Nothing here is a new result: literature rows are attributed to the cited sources, and product
// scenarios (O*, N01, FA01, CE01, RV01, FL01, SD01, SU01, ST01, RP01, RR01, FN01, plans/routes)
// carry label "synthetic_product_fixture".
import { VOCAB_VERSION } from "../core/vocab.ts";
import type { Fixture, FixItem, PostOp } from "./dsl.ts";

// ------------------------------------------------------------------ helpers

type Ref = { key: string; slot?: string };
type RefUse = NonNullable<FixItem["references"]>[number];
const r = (key: string, slot?: string): Ref => (slot ? { key, slot } : { key });
const SYN = "synthetic_product_fixture" as const;

interface Opts {
  profile?: FixItem["profile"];
  /** [source key, locator] pairs; the first one is the primary evidence locator. */
  src?: [string, string][];
  attribution?: string;
  /** "U" column: explicit informal upstream use (role inferred from the referenced item). */
  u?: string[];
  refs?: RefUse[];
  label?: FixItem["label"];
  statement_only?: boolean;
  candidate_only?: boolean;
  representations?: any[];
  dates?: FixItem["dates"];
}

/** Source authors per source key (original attribution of transcribed content). */
const ATTR: Record<string, string> = {};
/** Publication date of each source when the handoff states it. */
const SRC_DATE: Record<string, string> = {};

function make(kind: FixItem["kind"], key: string, title: string, context: string, payload: Record<string, any>, o: Opts = {}): FixItem {
  const sources = (o.src ?? []).map(([k, locator]) => ({ key: k, locator }));
  const primary = sources[0]?.key;
  const references: RefUse[] = [...(o.u ?? []).map((k): RefUse => ({ key: k, purpose: "explicit_informal" })), ...(o.refs ?? [])];
  const attribution = o.attribution ?? (o.label === SYN ? undefined : primary ? ATTR[primary] : undefined);
  const published = o.dates?.source_published_at ?? (primary ? SRC_DATE[primary] : undefined);
  const item: FixItem = { key, kind, title, context, payload };
  if (references.length) item.references = references;
  if (sources.length) item.sources = sources;
  if (attribution) item.attribution = attribution;
  if (o.profile) item.profile = o.profile;
  if (o.statement_only) item.statement_only = true;
  if (o.label) item.label = o.label;
  if (o.candidate_only) item.candidate_only = true;
  if (o.representations) item.representations = o.representations;
  if (published || o.dates) item.dates = { ...o.dates, ...(published ? { source_published_at: published } : {}) };
  return item;
}

function source(
  key: string,
  title: string,
  p: {
    source_kind: string;
    citation: string;
    authors: string[];
    attribution: string;
    edition?: string;
    locator?: string;
    url?: string;
    published?: string;
    exact?: string;
    unknown?: string;
    availability?: "available" | "restricted" | "unavailable" | "unknown";
    retrieved_at?: string;
  },
): FixItem {
  ATTR[key] = p.attribution;
  if (p.published) SRC_DATE[key] = p.published;
  return make("source", key, `${key}: ${title}`, "ROOT", {
    source_kind: p.source_kind,
    citation: p.citation,
    authors: p.authors,
    edition: p.edition,
    locator: p.locator,
    url: p.url,
    source_published_at: p.published,
    retrieved_at: p.retrieved_at,
    rights: { status: "unknown", note: "Citation and paraphrase only; no republication licence for the full work." },
    availability: p.availability ?? "available",
    revision_identity: p.exact ? { status: "exact", value: p.exact } : { status: "unknown", reason: p.unknown ?? "No edition or revision pinned by the handoff." },
  });
}

const CLASSICAL = "Classical informal mathematics (foundations not formalized; no library or checker imported)";

function context(key: string, title: string, p: Record<string, any>): FixItem {
  return make("context", key, `${key}: ${title}`, "ROOT", { profile: "classical_informal", foundations: CLASSICAL, ...p });
}

const obj = (key: string, title: string, ctx: string, description: string, o: Opts = {}, parameters: any[] = []) =>
  make("object", key, `${key}: ${title}`, ctx, { description, parameters }, o);

const defn = (key: string, title: string, ctx: string, statement: string, o: Opts = {}, extra: Record<string, any> = {}) =>
  make("declaration", key, `${key}: ${title}`, ctx, { category: "definitional", statement, editorial_roles: ["definition"], ...extra }, o);

const prop = (key: string, title: string, ctx: string, statement: string, roles: string[], o: Opts = {}, extra: Record<string, any> = {}) =>
  make("declaration", key, `${key}: ${title}`, ctx, { category: "propositional", statement, editorial_roles: roles, ...extra }, o);

const meth = (key: string, title: string, ctx: string, description: string, o: Opts = {}, extra: Record<string, any> = {}) =>
  make("method", key, `${key}: ${title}`, ctx, { description, ...extra }, o);

const argu = (key: string, title: string, ctx: string, p: Record<string, any>, o: Opts = {}) =>
  make("argument", key, `${key}: ${title}`, ctx, { argument_kind: "natural_language_proof", completeness: "source_reported", ...p }, o);

const research = (key: string, title: string, ctx: string, p: Record<string, any>, o: Opts = {}) =>
  make("research", key, `${key}: ${title}`, ctx, p, o);

const evaluation = (key: string, title: string, ctx: string, p: Record<string, any>, o: Opts = {}) =>
  make("evaluation", key, title, ctx, p, o);

type Slot = { slot: string; role: string; ref: Ref; order?: number; modality?: string; note?: string };
const sl = (slot: string, role: string, key: string, extra: Partial<Slot> = {}): Slot => ({ slot, role, ref: r(key), ...extra });

function rel(
  key: string,
  title: string,
  ctx: string,
  contract: string,
  slots: Slot[],
  p: { modality: string; interpretation: string; [k: string]: any },
  o: Opts = {},
): FixItem {
  const [id, version] = contract.includes("@") ? contract.split("@") : [contract, VOCAB_VERSION];
  return make("relation", key, `${key}: ${title}`, ctx, { contract: { id, version }, slots, ...p }, o);
}

/** Sets the reference role of explicit informal uses from the referenced item's kind. */
function finalize(items: FixItem[]): FixItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const i of items)
    for (const ref of i.references ?? []) {
      if (ref.role || ref.purpose !== "explicit_informal") continue;
      const t = byKey.get(ref.key);
      const definitional =
        t && (["object", "method", "context"].includes(t.kind) || (t.kind === "declaration" && t.payload.category === "definitional"));
      ref.role = definitional ? "definition" : "statement";
    }
  return items;
}

// ================================================================== §29 P vs NP

const PVNP_SOURCES: FixItem[] = [
  source("M01", "Cook, The P versus NP Problem (Clay official description)", {
    source_kind: "paper",
    citation: "Stephen Cook, The P versus NP Problem, official Clay Mathematics Institute problem description (PDF).",
    authors: ["Stephen Cook"],
    attribution: "Stephen Cook",
    url: "https://www.claymath.org/wp-content/uploads/2022/06/pvsnp.pdf",
    locator: "§§1–2, Proposition 1, Appendix",
    unknown: "Clay-hosted PDF without a version identifier; it contains historically dated remarks, only definitions and propositions are used.",
  }),
  source("M02", "Cook, The Complexity of Theorem-Proving Procedures", {
    source_kind: "paper",
    citation: "Stephen Cook, The Complexity of Theorem-Proving Procedures, STOC 1971, pp. 151–158.",
    authors: ["Stephen Cook"],
    attribution: "Stephen Cook",
    url: "https://www.cs.toronto.edu/~sacook/homepage/1971.pdf",
    locator: "Theorem 1 and formula construction",
    published: "1971",
    exact: "STOC 1971, pp. 151–158 (scan on the author's homepage)",
  }),
  source("M03", "Levin, Universal Sequential Search Problems", {
    source_kind: "paper",
    citation: "Leonid Levin, Universal Sequential Search Problems (1973), English translation hosted by a university.",
    authors: ["Leonid Levin"],
    attribution: "Leonid Levin",
    url: "https://www.karlin.mff.cuni.cz/~krajicek/levin.pdf",
    locator: "Definitions 1–2, Theorem 1/Lemma 1",
    edition: "English translation (a manifestation distinct from the Russian original; no own fidelity audit claimed)",
    published: "1973",
    exact: "1973 original; English translation as hosted by the university",
  }),
  source("M04", "Furst, Saxe, Sipser, Parity, Circuits, and the Polynomial-Time Hierarchy", {
    source_kind: "paper",
    citation: "Furst, Saxe and Sipser, Parity, Circuits, and the Polynomial-Time Hierarchy, Mathematical Systems Theory 17 (1984), 13–27.",
    authors: ["Furst", "Saxe", "Sipser"],
    attribution: "Furst, Saxe, Sipser",
    url: "https://wiki.epfl.ch/edicpublic/documents/Candidacy%20exam/Furst%20Saxe%20Sipser%20-%201984%20-%20Parity%20circuits%20and%20the%20polynomial-time%20hierarchy.pdf",
    locator: "abstract and restriction argument",
    published: "1984",
    exact: "Mathematical Systems Theory 17 (1984), 13–27 (original paper hosted at EPFL)",
  }),
  source("M05", "Håstad, Computational Limitations for Small Depth Circuits", {
    source_kind: "thesis",
    citation: "Johan Håstad, Computational Limitations for Small Depth Circuits, thesis manuscript 1986 (author's site).",
    authors: ["Johan Håstad"],
    attribution: "Johan Håstad",
    url: "https://johanhastad.se/thesis.pdf",
    locator: "ch. 4 Switching Lemma, ch. 5 parity",
    edition: "1986 thesis manuscript; the 1989 expanded edition (https://johanhastad.se/largesmalldepth.pdf) is a distinct edition and is not conflated",
    published: "1986",
    exact: "1986 thesis manuscript (author's site)",
  }),
  source("M06", "Williams, Non-Uniform ACC Circuit Lower Bounds", {
    source_kind: "paper",
    citation: "Ryan Williams, Non-Uniform ACC Circuit Lower Bounds, PDF dated 23 Nov 2010.",
    authors: ["Ryan Williams"],
    attribution: "Ryan Williams",
    url: "https://www.cs.cmu.edu/~ryanw/acc-lbs.pdf",
    locator: "Theorems 1.1, 1.3, §5",
    edition: "PDF dated 2010-11-23; not substituted by the JACM 2014 article",
    published: "2010-11-23",
    exact: "PDF dated 2010-11-23",
  }),
  source("M07", "Baker, Gill, Solovay, Relativizations of the P =? NP Question", {
    source_kind: "paper",
    citation: "Baker, Gill and Solovay, Relativizations of the P = ? NP Question, SIAM J. Computing 4 (1975), 1–11.",
    authors: ["Baker", "Gill", "Solovay"],
    attribution: "Baker, Gill, Solovay",
    url: "https://epubs.siam.org/doi/10.1137/0204037",
    locator: "primary editorial abstract with both oracles",
    published: "1975",
    exact: "SIAM J. Computing 4 (1975), 1–11",
    availability: "restricted",
  }),
  source("M08", "Razborov, Rudich, Natural Proofs", {
    source_kind: "paper",
    citation: "Razborov and Rudich, Natural Proofs, JCSS 55 (1997), 24–35; authors' copy dated 11 Sep 1999.",
    authors: ["Razborov", "Rudich"],
    attribution: "Razborov, Rudich",
    url: "https://www1.karlin.mff.cuni.cz/~krajicek/rr.pdf",
    locator: "§§2.1–2.2, Theorem 4.1 and its proof",
    edition: "authors' copy dated 1999-09-11 (published JCSS 55 (1997), 24–35)",
    published: "1997",
    exact: "authors' copy dated 1999-09-11",
  }),
  source("M09", "Aaronson, Wigderson, Algebrization: A New Barrier in Complexity Theory", {
    source_kind: "paper",
    citation: "Aaronson and Wigderson, Algebrization: A New Barrier in Complexity Theory, authors' PDF; published TOCT 2009.",
    authors: ["Aaronson", "Wigderson"],
    attribution: "Aaronson, Wigderson",
    url: "https://www.scottaaronson.com/papers/alg.pdf",
    locator: "§2 definitions, Theorems 3.7, 5.1, 5.3",
    published: "2009",
    unknown: "Authors' PDF consulted without a version date; the published TOCT 2009 version is not the consulted manifestation.",
  }),
  source("M10", "Chow, Almost-natural proofs (arXiv v3)", {
    source_kind: "preprint",
    citation: "Timothy Chow, Almost-natural proofs, arXiv:0805.1385v3, 30 Mar 2009.",
    authors: ["Timothy Chow"],
    attribution: "Timothy Chow",
    url: "https://arxiv.org/abs/0805.1385v3",
    locator: "Theorem 2 and §3; Definitions 4–5; §5, Theorem 5 (attributed to Vadhan)",
    published: "2009-03-30",
    exact: "arXiv:0805.1385v3 (2009-03-30)",
  }),
  source("M11", "Mulmuley, Sohoni, Geometric Complexity Theory I", {
    source_kind: "paper",
    citation: "Mulmuley and Sohoni, Geometric Complexity Theory I, SIAM J. Computing 31, 496–526.",
    authors: ["Mulmuley", "Sohoni"],
    attribution: "Mulmuley, Sohoni",
    url: "https://epubs.siam.org/doi/abs/10.1137/S009753970038715X",
    locator: "original authors' abstract",
    exact: "SIAM J. Computing 31, 496–526",
    availability: "restricted",
  }),
  source("M12", "Bürgisser, Ikenmeyer, Panova, No occurrence obstructions in GCT", {
    source_kind: "paper",
    citation: "Bürgisser, Ikenmeyer and Panova, No occurrence obstructions in geometric complexity theory, copy dated 9 Mar 2017.",
    authors: ["Bürgisser", "Ikenmeyer", "Panova"],
    attribution: "Bürgisser, Ikenmeyer, Panova",
    url: "https://www3.math.tu-berlin.de/algebra/work/nooccobs.pdf",
    locator: "Definitions/Conjectures 1.1, 1.3, 1.4; Theorem 1.5; §1(d)",
    edition: "copy dated 2017-03-09 with bound n ≥ m^25; arXiv v3 (2018) reorganizes the text and numbering identity is not presupposed",
    published: "2017-03-09",
    exact: "copy dated 2017-03-09",
  }),
  source("M13", "Cook, Reckhow, The Relative Efficiency of Propositional Proof Systems", {
    source_kind: "paper",
    citation: "Cook and Reckhow, The Relative Efficiency of Propositional Proof Systems, J. Symbolic Logic 44 (1979), 36–50.",
    authors: ["Cook", "Reckhow"],
    attribution: "Cook, Reckhow",
    url: "https://www.cs.toronto.edu/~sacook/homepage/cook_reckhow.pdf",
    locator: "Definitions 1.3, 1.5; Propositions 1.1, 1.4",
    published: "1979",
    exact: "J. Symbolic Logic 44 (1979), 36–50",
  }),
  source("M14", "Lipton, Regan, Issues in the Proof That P≠NP", {
    source_kind: "discussion",
    citation: "Lipton and Regan, Issues in the Proof That P≠NP, blog post, 9 Aug 2010, with signed researcher comments.",
    authors: ["Lipton", "Regan"],
    attribution: "Lipton, Regan and signed commenters",
    url: "https://rjlipton.com/2010/08/09/issues-in-the-proof-that-p%E2%89%A0np/",
    locator: "direct critiques and signed comments",
    published: "2010-08-09",
    exact: "blog post of 2010-08-09",
  }),
  source("M15", "Lipton/Regan, Deolalikar Responds to Issues", {
    source_kind: "discussion",
    citation: "Lipton/Regan, Deolalikar Responds to Issues About His P≠NP Proof, blog post, 11 Aug 2010.",
    authors: ["Lipton", "Regan"],
    attribution: "Lipton, Regan",
    url: "https://rjlipton.com/2010/08/11/deolalikar-responds-to-issues-about-his-p%E2%89%A0np-proof-2/",
    locator: "author's response; claim maintained, no retraction",
    published: "2010-08-11",
    exact: "blog post of 2010-08-11",
  }),
  source("M16", "Clay Mathematics Institute, P vs NP problem page", {
    source_kind: "web",
    citation: "Clay Mathematics Institute, P vs NP (Millennium Problem page), consulted 1 Oct 2026: classified Unsolved.",
    authors: ["Clay Mathematics Institute"],
    attribution: "Clay Mathematics Institute",
    url: "https://www.claymath.org/millennium/p-vs-np/",
    locator: "classification 'Unsolved'",
    retrieved_at: "2026-10-01",
    unknown: "Live web page consulted 2026-10-01; no revision identifier available.",
  }),
  source("M17", "Karp, Reducibility among Combinatorial Problems", {
    source_kind: "paper",
    citation: "Richard Karp, Reducibility among Combinatorial Problems, 1972, 85–103.",
    authors: ["Richard Karp"],
    attribution: "Richard Karp",
    url: "https://doi.org/10.1007/978-1-4684-2001-2_9",
    locator: "historical antecedent referenced by M01; no theorems imported",
    published: "1972",
    exact: "1972, pp. 85–103",
  }),
];

const PVNP_CONTEXTS: FixItem[] = [
  context("C0", "Classical complexity (Turing machines)", {
    conventions:
      "Binary languages; standard finite-length encodings; worst-case time on Turing machines; uniform decision.",
    notation: [
      { symbol: "P", meaning: "languages decided by a deterministic TM in polynomial time" },
      { symbol: "NP", meaning: "languages decided by a nondeterministic TM in polynomial time" },
      { symbol: "≤p", meaning: "polynomial-time many-one reducibility" },
    ],
  }),
  context("CH", "Cook 1971 historical framework", {
    conventions:
      "Historical context of Cook 1971: polynomial-time query-reducibility to tautologies; not automatically reinterpreted as modern many-one reducibility.",
  }),
  context("CL", "Levin search problems", {
    conventions:
      "Search/quasi-search problems and polynomial comparability per Levin Definitions 1–2; translated manifestation; no automatic identity with the decision framework.",
  }),
  context("CC", "Non-uniform Boolean circuits", {
    conventions: "Non-uniform Boolean circuits per input length; basis/gates and size/depth as fixed by each entity; classical finite combinatorics.",
    notation: [
      { symbol: "P/poly", meaning: "languages with polynomial-size circuit families (no uniformity)" },
      { symbol: "AC0", meaning: "polynomial size, constant depth, unbounded fan-in AND/OR and NOT" },
    ],
  }),
  context("CO", "Oracle machines", {
    conventions: "Oracle machines with a fixed oracle A/B and conventional query cost; quantification over oracles is external.",
    notation: [
      { symbol: "P^A", meaning: "deterministic polynomial time with oracle A" },
      { symbol: "NP^A", meaning: "nondeterministic polynomial time with oracle A" },
    ],
  }),
  context("CN", "Natural proofs setting", {
    conventions:
      "Boolean function families F_n with truth-table length N = 2^n; density/constructivity/usefulness of M08; n and N are never confused.",
    notation: [
      { symbol: "F_n", meaning: "all Boolean functions on n variables" },
      { symbol: "N", meaning: "truth-table length 2^n" },
    ],
  }),
  context("CA", "Algebraic oracles (algebrization)", {
    conventions: "Boolean oracle A and low-degree extension Ã over specified fields/rings; asymmetric access as in M09 §2.",
    notation: [{ symbol: "Ã", meaning: "low-degree extension of the Boolean oracle A" }],
  }),
  context("CG", "Geometric complexity theory over ℂ", {
    conventions:
      "Algebraic complexity over ℂ: polynomials, padding, GL_(n²), coordinate rings/orbit closures and parameters n, m, d of M12; VP_ws is not equated with P.",
    notation: [
      { symbol: "Ω_n", meaning: "orbit closure of det_n under GL_(n²)" },
      { symbol: "Z_(n,m)", meaning: "orbit closure of the padded permanent" },
    ],
  }),
  context("CP", "Propositional proof complexity", {
    conventions: "Propositional TAUT, polynomial-time functions onto TAUT and proof size of M13; classical.",
    notation: [{ symbol: "TAUT", meaning: "propositional tautologies" }],
  }),
  context("CD", "Deolalikar 2010 alleged argument", {
    conventions:
      "Context of the alleged Deolalikar 2010 argument as discussed in M14–M15; the statement P≠NP is read in C0; details not fully recovered.",
  }),
  context("CW", "Williams algorithms-to-lower-bounds (C0+CC)", {
    imports: [r("C0"), r("CC")],
    conventions: "C0 + CC; circuit class C contains AC0 and is closed under composition; deterministic algorithms and the quantification of Theorem 1.3 of M06.",
    assumptions: [
      { id: "C_contains_AC0", expr: "the circuit class C contains AC0", variables: ["C"], scope: "global" },
      { id: "C_closed", expr: "C is closed under composition", variables: ["C"], scope: "global" },
    ],
  }),
  context("CTX_C0CC", "C0 + CC (uniform and non-uniform)", {
    imports: [r("C0"), r("CC")],
    conventions: "Rows marked 'C0+CC': uniform Turing-machine complexity together with non-uniform circuits.",
  }),
  context("CTX_C0CN", "C0 + CN", {
    imports: [r("C0"), r("CN")],
    conventions: "Rows marked 'C0+CN': uniform complexity together with the natural-proofs setting.",
  }),
  context("CTX_C0CP", "C0 + CP", {
    imports: [r("C0"), r("CP")],
    conventions: "Obligation O04 ('CP+C0'): uniform complexity together with propositional proof complexity.",
  }),
  context("CTX_COCA", "CO + CA", {
    imports: [r("CO"), r("CA")],
    conventions: "Diagnostic O06 ('CO/CA'): ordinary oracles and algebraic oracle extensions side by side.",
  }),
];

// ---------------------------------------------------------------- P01–P21

const P01_21: FixItem[] = [
  obj("P01", "Language L ⊆ {0,1}*", "C0", "A language is a set L ⊆ {0,1}* of finite binary strings.", { profile: "D", src: [["M01", "§1"]] }),
  obj("P02", "Deterministic Turing machine", "C0", "Deterministic machine: each configuration has a unique next configuration.", {
    profile: "D",
    src: [["M01", "Appendix"]],
    u: ["P01"],
  }),
  obj(
    "P03",
    "Nondeterministic Turing machine",
    "C0",
    "Nondeterministic machine: acceptance means existence of an accepting computation path.",
    { profile: "D", src: [["M01", "§1/Appendix"]], u: ["P01"], refs: [{ key: "P02", purpose: "background", role: "definition" }] },
  ),
  defn("P04", "Polynomial time", "C0", "A machine runs in polynomial time if ∃k such that T(n) ≤ n^k + k for every input length n.", {
    profile: "D",
    src: [["M01", "§1"]],
    u: ["P02"],
  }),
  defn("P05", "Class P", "C0", "P is the class of languages decided by a deterministic machine in polynomial time.", {
    profile: "D",
    src: [["M01", "§1"]],
    u: ["P01", "P02", "P04"],
  }),
  defn("P06", "Class NP (nondeterministic time)", "C0", "NP is the class of languages decided by a nondeterministic machine in polynomial time.", {
    profile: "D",
    src: [["M01", "§1"]],
    u: ["P01", "P03", "P04"],
  }),
  defn(
    "P07",
    "Class NP (verifier formulation)",
    "C0",
    "L ∈ NP iff there exist a polynomial-time relation R and a polynomial p such that x ∈ L ⇔ ∃y (length(y) ≤ p(length(x)) ∧ R(x,y)).",
    { profile: "D", src: [["M01", "§1"]], u: ["P01", "P05"], refs: [{ key: "P06", purpose: "background", role: "definition" }] },
    { variables: [{ name: "R", binder: "exists" }, { name: "p", binder: "exists" }, { name: "x", binder: "forall" }, { name: "y", binder: "exists" }] },
  ),
  rel(
    "P08",
    "P06 and P07 define the same class under C0",
    "C0",
    "equivalent_under",
    [sl("s1", "side", "P06"), sl("s2", "side", "P07")],
    {
      modality: "logical",
      interpretation: "The nondeterministic-time definition (P06) and the verifier definition (P07) define the same class of languages in C0; equivalence, not identity of the definitions.",
      scope: "C0",
    },
    { profile: "T", src: [["M01", "§1 (simulations described)"]] },
  ),
  argu(
    "P09",
    "Witness/verifier simulation argument",
    "C0",
    {
      targets: [r("P08")],
      summary:
        "The witness is the sequence of nondeterministic choices; the verifier simulates the machine on those choices; conversely the nondeterministic machine guesses the witness and runs the verifier.",
      steps: [
        { id: "s1", text: "(⊆) Encode an accepting path of the nondeterministic machine as a witness y; a deterministic verifier replays it.", uses: [r("P02"), r("P03")] },
        { id: "s2", text: "(⊇) A nondeterministic machine guesses y with length(y) ≤ p(length(x)) and runs R(x,y) deterministically.", uses: [r("P03"), r("P07")] },
      ],
    },
    {
      profile: "P",
      src: [["M01", "Standard argument reconstructed manually following M01 §1; not a new result"]],
      refs: [
        { key: "P02", purpose: "proof_local_use", role: "definition" },
        { key: "P03", purpose: "proof_local_use", role: "definition" },
        { key: "P07", purpose: "proof_local_use", role: "definition" },
      ],
    },
  ),
  defn(
    "P10",
    "Polynomial-time many-one reducibility ≤p",
    "C0",
    "L ≤p K iff there is a total polynomial-time computable f such that ∀x [x ∈ L ⇔ f(x) ∈ K]; the witness f is mandatory.",
    { profile: "D", src: [["M01", "Definition 3"]], u: ["P01", "P05"] },
    { variables: [{ name: "f", binder: "exists" }, { name: "x", binder: "forall" }] },
  ),
  defn(
    "P11",
    "NP-completeness",
    "C0",
    "L is NP-complete iff (membership) L ∈ NP and (hardness) K ≤p L for every K ∈ NP.",
    { profile: "D", src: [["M01", "Definition 4"]], u: ["P06", "P10"] },
  ),
  obj("P12", "SAT", "C0", "SAT: the set of (encodings of) Boolean formulas that admit a satisfying assignment.", {
    profile: "D",
    src: [["M01", "satisfiability passage"], ["M02", "satisfiability"]],
    u: ["P01"],
  }),
  prop("P13", "SAT ∈ NP", "C0", "SAT ∈ NP (a satisfying assignment is a polynomial-size witness).", ["theorem"], {
    profile: "T",
    src: [["M01", "§2"]],
    u: ["P07", "P12"],
  }),
  prop(
    "P14",
    "Cook–Levin theorem (modern formulation)",
    "C0",
    "SAT is NP-complete under polynomial-time many-one reducibility (modern formulation, distinguished from the historical statements P15 and P17).",
    ["theorem"],
    {
      profile: "T",
      src: [["M01", "§2"], ["M02", "Theorem 1"], ["M03", "Theorem 1"]],
      attribution: "Stephen Cook; Leonid Levin (modern formulation per M01)",
      u: ["P10", "P11", "P12", "P13"],
      refs: [
        { key: "P15", purpose: "citation", role: "statement" },
        { key: "P17", purpose: "citation", role: "statement" },
      ],
    },
  ),
  prop(
    "P15",
    "Cook 1971: NP reduces to tautologies",
    "CH",
    "Every language accepted by a nondeterministic machine in polynomial time is polynomial-time query-reducible to the set of tautologies (no automatic alias of P14).",
    ["theorem"],
    { profile: "T", src: [["M02", "Theorem 1"]], u: ["P03"] },
  ),
  argu(
    "P16",
    "Cook's tableau encoding",
    "CH",
    {
      targets: [r("P15")],
      summary:
        "Encode the tableau of an accepting computation as a satisfiable formula. Maps to the modern presentation P14 without an identity claim.",
      steps: [{ id: "s1", text: "Encode configurations and transitions of an accepting computation as clauses of a formula.", uses: [r("P03")] }],
    },
    { profile: "P", src: [["M02", "proof of Theorem 1"]], refs: [{ key: "P14", purpose: "background", role: "statement" }] },
  ),
  prop(
    "P17",
    "Levin: universality of six search problems",
    "CL",
    "Universality of six search/quasi-search problems (Levin), using Definitions 1–2 of the CL context; an independent historical contribution.",
    ["theorem"],
    { profile: "T", src: [["M03", "Theorem 1/Lemma 1"]] },
  ),
  rel(
    "P18",
    "Independent foundational contributions of Cook and Levin",
    "C0",
    "independent_contribution@fixture-1",
    [sl("c1", "contribution", "P15"), sl("c2", "contribution", "P17")],
    {
      modality: "historical",
      interpretation:
        "Cook (P15, 1971) and Levin (P17, 1973) made independent foundational contributions; historical strength only, not a proof of equivalence.",
      fields: {
        context_comparison: "unresolved",
        context_note: "Participants are interpreted in CH and CL respectively; no map between those frameworks and C0 is asserted.",
      },
    },
    {
      profile: "R",
      src: [["M01", "history"], ["M16", "attribution"], ["M02", "original date"], ["M03", "original date"]],
      attribution: "Stephen Cook (M01 history); Clay Mathematics Institute (M16)",
    },
  ),
  rel(
    "P19",
    "SAT ∈ P ⇔ P = NP",
    "C0",
    "equivalent_under",
    [sl("s1", "side", "S_SAT_IN_P"), sl("s2", "side", "S_P_EQ_NP")],
    { modality: "logical", interpretation: "SAT ∈ P holds iff P = NP, in C0.", scope: "C0" },
    { profile: "T", src: [["M01", "Proposition 1(c) and membership"]], u: ["P14", "P21", "P10"] },
  ),
  rel(
    "P20",
    "NP-complete L ∈ P and closure of P under ≤p entail P = NP",
    "C0",
    "entails",
    [
      sl("p1", "premise", "S_L_NPC"),
      sl("p2", "premise", "S_L_IN_P"),
      sl("p3", "premise", "S_P_CLOSED"),
      sl("c1", "conclusion", "S_P_EQ_NP"),
      sl("h1", "condition", "P21"),
    ],
    {
      modality: "logical",
      interpretation: "(L NP-complete ∧ L ∈ P ∧ P closed under ≤p) ⇒ P = NP, under P ⊆ NP; premises are conjunctive, not three separate implications.",
      grouping: { premise: { op: "AND", items: ["p1", "p2", "p3"] } },
      scope: "C0",
    },
    { profile: "T", src: [["M01", "Proposition 1; explicit derivation in the handoff (FN01)"]] },
  ),
  prop("P21", "P ⊆ NP", "C0", "P ⊆ NP (proof: ignore the witness).", ["theorem"], {
    profile: "T",
    src: [["M01", "§1"]],
    u: ["P05", "P07"],
  }),
];

// Helper propositions for §29 relations (participants that are not rows themselves).
const helperH = (key: string, title: string, ctx: string, statement: string, extra: Record<string, any> = {}, o: Opts = {}) =>
  make("declaration", key, title, ctx, { category: "propositional", statement, editorial_roles: ["hypothesis"], ...extra }, {
    profile: "H",
    src: [["M01", "statement used by the §29 relations"]],
    ...o,
  });

const PVNP_HELPERS: FixItem[] = [
  helperH("S_SAT_IN_P", "SAT ∈ P", "C0", "SAT ∈ P.", {}, { u: ["P12", "P05"] }),
  helperH("S_SAT_NOT_IN_P", "SAT ∉ P", "C0", "SAT ∉ P.", {}, { u: ["P12", "P05"] }),
  helperH("S_P_EQ_NP", "P = NP", "C0", "P = NP.", {}, { u: ["P05", "P06"] }),
  helperH("S_P_NEQ_NP", "P ≠ NP", "C0", "P ≠ NP.", {}, { u: ["P05", "P06"] }),
  helperH("S_NP_NOT_PPOLY", "NP ⊄ P/poly", "CTX_C0CC", "NP ⊄ P/poly.", {}, { u: ["P06", "P23"], src: [["M06", "§1"]] }),
  helperH("S_SAT_NOT_IN_PPOLY", "SAT ∉ P/poly", "CTX_C0CC", "SAT ∉ P/poly.", {}, { u: ["P12", "P23"], src: [["M06", "§1"]] }),
  helperH("S_NP_NEQ_CONP", "NP ≠ coNP", "CP", "NP ≠ coNP.", {}, { src: [["M13", "§1"]] }),
  helperH("S_NP_EQ_CONP", "NP = coNP", "CP", "NP = coNP.", {}, { src: [["M13", "Propositions 1.1, 1.4"]] }),
  helperH("S_PB_SYSTEM", "A polynomially bounded Cook–Reckhow proof system exists", "CP", "There exists a polynomially bounded Cook–Reckhow proof system (P76, P77).", {}, {
    u: ["P76", "P77"],
    src: [["M13", "Definition 1.3; Propositions 1.1, 1.4"]],
  }),
  helperH("S_L_NPC", "L is NP-complete (P11)", "C0", "L is NP-complete (in the sense of P11).", { usage: "hypothesis", variables: [{ name: "L", binder: "free" }] }, { u: ["P11"] }),
  helperH("S_L_IN_P", "L ∈ P", "C0", "L ∈ P.", { usage: "hypothesis", variables: [{ name: "L", binder: "free" }] }, { u: ["P05"] }),
  helperH("S_P_CLOSED", "P is closed under ≤p (P10)", "C0", "P is closed under ≤p: if K ≤p L and L ∈ P then K ∈ P.", { usage: "hypothesis" }, { u: ["P05", "P10"] }),
  make(
    "declaration",
    "S_PVNP_Q",
    "Is P = NP?",
    "C0",
    { category: "interrogative", statement: "Is P = NP?", editorial_roles: ["question"], answer_criterion: "A proof of P = NP or of P ≠ NP in C0." },
    { src: [["M16", "classification 'Unsolved'"]], u: ["P05", "P06"] },
  ),
];

// ---------------------------------------------------------------- P22–P38

const P22_38: FixItem[] = [
  obj("P22", "Circuit family", "CC", "A circuit family has one finite Boolean circuit per input length.", { profile: "D", src: [["M06", "§1–2"]], u: ["P01"] }),
  defn("P23", "P/poly", "CC", "P/poly: languages decided by families of Boolean circuits of polynomial size, with no uniformity requirement.", {
    profile: "D",
    src: [["M08", "notation"], ["M06", "§1"]],
    u: ["P22"],
  }),
  prop("P24", "P ⊆ P/poly", "CTX_C0CC", "P ⊆ P/poly, by simulating a time-bounded computation with circuits.", ["theorem"], {
    profile: "T",
    src: [["M06", "discussion of uniform vs non-uniform; elementary simulation"]],
    u: ["P02", "P04", "P22"],
  }),
  rel(
    "P25",
    "NP ⊄ P/poly ⇒ P ≠ NP",
    "CTX_C0CC",
    "entails",
    [sl("p1", "premise", "S_NP_NOT_PPOLY"), sl("h1", "condition", "P24"), sl("c1", "conclusion", "S_P_NEQ_NP")],
    { modality: "logical", interpretation: "The non-uniform separation NP ⊄ P/poly implies P ≠ NP (using P ⊆ P/poly); not a biconditional.", scope: "C0+CC" },
    { profile: "T", src: [["M06", "§1"]], u: ["P24"] },
  ),
  defn("P26", "AC0", "CC", "AC0: polynomial size, constant depth, unbounded fan-in AND/OR gates and NOT gates.", {
    profile: "D",
    src: [["M04", "definitions"], ["M05", "ch. 2"]],
    u: ["P22"],
  }),
  obj("P27", "PARITY", "CC", "PARITY_n(x) = Σ_i x_i mod 2.", { profile: "D", src: [["M04", "problem definition"]], u: ["P01"] }),
  prop("P28", "Parity needs superpolynomial size at fixed depth", "CC", "Parity requires superpolynomial size for circuits of any fixed depth.", ["theorem"], {
    profile: "T",
    src: [["M04", "abstract/main result"]],
    u: ["P26", "P27"],
  }),
  prop(
    "P29",
    "Parity needs size exp(Ω(n^(1/(d−1)))) at depth d",
    "CC",
    "For fixed depth d ≥ 2 and the standard basis, parity requires circuit size exp(Ω(n^(1/(d−1)))). Strengthens P28 (near-optimal version); does not refute it.",
    ["theorem"],
    {
      profile: "T",
      src: [["M05", "ch. 5"]],
      u: ["P26", "P27", "P33"],
      refs: [{ key: "P28", purpose: "explicit_informal", role: "statement" }],
    },
    { variables: [{ name: "d", domain: "ℕ, d ≥ 2 fixed", binder: "forall" }] },
  ),
  prop("P30", "PARITY ∉ AC0", "CC", "PARITY ∉ AC0.", ["theorem"], {
    profile: "T",
    src: [["M04", "main result"], ["M05", "ch. 5"]],
    attribution: "Furst, Saxe, Sipser; Johan Håstad (common consequence)",
    u: ["P26", "P27"],
  }),
  argu(
    "P31",
    "Furst–Saxe–Sipser parity lower bound proof",
    "CC",
    {
      targets: [r("P28"), r("P30")],
      summary: "Random restrictions followed by circuit simplification (source-reported; no formal run).",
      steps: [
        { id: "s1", text: "Apply restrictions to the input variables.", uses: [r("P27")] },
        { id: "s2", text: "Simplify the restricted constant-depth circuit; parity survives restrictions, yielding the lower bound.", uses: [r("P26")] },
      ],
    },
    { profile: "P", src: [["M04", "proof"]] },
  ),
  argu(
    "P32",
    "Håstad parity lower bound proof",
    "CC",
    {
      targets: [r("P29"), r("P30")],
      summary: "Switching-lemma based proof of the near-optimal parity lower bound (source-reported).",
      steps: [
        { id: "s1", text: "Apply the switching lemma (P33) layer by layer under random restrictions.", uses: [r("P33")] },
        { id: "s2", text: "Conclude the exp(Ω(n^(1/(d−1)))) size bound for depth-d circuits computing parity.", uses: [r("P27")] },
      ],
    },
    { profile: "P", src: [["M05", "ch. 4–5"]], refs: [{ key: "P33", purpose: "proof_local_use", role: "rule" }] },
  ),
  meth(
    "P33",
    "Switching lemma / random restrictions",
    "CC",
    "Random restrictions simplify CNF/DNF formulas in a parameterized regime (switching lemma).",
    { profile: "M", src: [["M05", "Lemma 4.1/4.2"]] },
    {
      parameters: [{ name: "t" }, { name: "s" }, { name: "p" }],
      regime: "Parameters t, s, p fixed as in M05 Lemma 4.1/4.2.",
      applicability: "Contracts as fixed in M05; not a universal simplification.",
    },
  ),
  defn("P34", "ACC0", "CC", "ACC0 adds MOD_m gates, for a constant m > 1, to constant-depth circuits (generalizes P26).", {
    profile: "D",
    src: [["M06", "abstract"]],
    u: ["P22"],
    refs: [{ key: "P26", purpose: "background", role: "definition" }],
  }),
  defn("P35", "NEXP", "C0", "NEXP = ⋃_k NTIME(2^(n^k)) (nondeterministic exponential time).", { profile: "D", src: [["M06", "preliminaries"]], u: ["P03"] }),
  prop("P36", "NEXP ⊄ polynomial-size ACC0", "CTX_C0CC", "NEXP does not have polynomial-size ACC0 circuits.", ["theorem"], {
    profile: "T",
    src: [["M06", "Theorem 1.1 and §5"]],
    u: ["P34", "P35"],
    refs: [{ key: "P37", purpose: "background", role: "definition" }],
  }),
  meth(
    "P37",
    "Faster SAT algorithms yield lower bounds (program)",
    "CW",
    "Program: faster circuit-SAT algorithms produce circuit lower bounds via contradiction with the nondeterministic time hierarchy. Candidate extension to stronger classes C.",
    { profile: "M", src: [["M06", "§1.1"]], u: ["P38"] },
  ),
  rel(
    "P38",
    "Williams Theorem 1.3: fast C-SAT ⇒ NTIME(2^n) ⊄ poly-size C",
    "CW",
    "entails",
    [
      sl("p1", "premise", "S_P38_ALG"),
      sl("p2", "premise", "S_P38_CLOSED"),
      sl("p3", "premise", "S_P38_AC0"),
      sl("c1", "conclusion", "S_NTIME_NOT_C"),
    ],
    {
      modality: "logical",
      interpretation:
        "∃k > 0 such that: if for every c, C-SAT on circuits of size n^c is decidable deterministically in time O(2^n/n^k), and C is closed under composition and contains AC0, then NTIME(2^n) ⊄ poly-size C. No conclusion about NP.",
      grouping: { premise: { op: "AND", items: ["p1", "p2", "p3"] } },
      hypotheses: [{ id: "k", text: "∃k > 0 is quantified outermost and scopes over premises and conclusion; ∀c lies inside premise p1." }],
      scope: "CW",
      fields: { quantifier_order: "∃k>0 [ (∀c: C-SAT_{n^c} ∈ DTIME(2^n/n^k)) ∧ closure ∧ AC0 ⊆ C ⇒ NTIME(2^n) ⊄ poly-size C ]" },
    },
    { profile: "T", src: [["M06", "Theorem 1.3"]] },
  ),
  make(
    "declaration",
    "S_P38_ALG",
    "Fast C-SAT algorithm hypothesis",
    "CW",
    {
      category: "propositional",
      statement: "For every c, C-SAT on circuits of size n^c is decidable deterministically in time O(2^n/n^k).",
      variables: [{ name: "k", domain: "k > 0, bound by the ∃k of P38", binder: "free" }, { name: "c", binder: "forall" }],
      editorial_roles: ["hypothesis"],
      usage: "hypothesis",
    },
    { profile: "H", src: [["M06", "Theorem 1.3 (premise)"]] },
  ),
  make(
    "declaration",
    "S_P38_CLOSED",
    "C is closed under composition",
    "CW",
    { category: "propositional", statement: "The circuit class C is closed under composition.", editorial_roles: ["hypothesis"], usage: "hypothesis" },
    { profile: "H", src: [["M06", "Theorem 1.3 (premise)"]] },
  ),
  make(
    "declaration",
    "S_P38_AC0",
    "C contains AC0",
    "CW",
    { category: "propositional", statement: "The circuit class C contains AC0.", editorial_roles: ["hypothesis"], usage: "hypothesis" },
    { profile: "H", src: [["M06", "Theorem 1.3 (premise)"]], u: ["P26"] },
  ),
  make(
    "declaration",
    "S_NTIME_NOT_C",
    "NTIME(2^n) ⊄ poly-size C",
    "CW",
    { category: "propositional", statement: "NTIME(2^n) does not have polynomial-size C circuits.", editorial_roles: ["proposition"] },
    { profile: "H", src: [["M06", "Theorem 1.3 (conclusion)"]] },
  ),
  rel(
    "R_P37_MOTIVATES_P36",
    "Program P37 motivates P36",
    "CW",
    "motivates",
    [sl("m1", "motivator", "P37"), sl("t1", "motivated", "P36")],
    {
      modality: "heuristic",
      interpretation: "The algorithms-to-lower-bounds program motivates the NEXP ⊄ ACC0 result; no validity propagation.",
      fields: { context_map: "P36 is read in C0+CC (CTX_C0CC), whose components C0 and CC are both imported by CW." },
    },
    { src: [["M06", "§1.1"]] },
  ),
];

// ---------------------------------------------------------------- P39–P51

const P39_51: FixItem[] = [
  obj("P39", "Oracle machine", "CO", "An oracle machine queries membership in A as a primitive operation of the model.", {
    profile: "D",
    src: [["M07", "definition in abstract"]],
    u: ["P02", "P03"],
  }),
  defn("P40", "P^A", "CO", "P^A: deterministic polynomial time with oracle A.", { profile: "D", src: [["M07", "abstract"]], u: ["P39", "P05"] }),
  defn("P41", "NP^A", "CO", "NP^A: nondeterministic polynomial time with oracle A.", { profile: "D", src: [["M07", "abstract"]], u: ["P39", "P06"] }),
  meth(
    "P42",
    "Relativizing argument",
    "CO",
    "A relativizing argument keeps its claim valid for every oracle of the regime. A property of arguments, not of statement text.",
    { profile: "D", src: [["M07", "abstract"], ["M09", "introduction"]], u: ["P40", "P41"] },
  ),
  prop("P43", "∃ recursive oracle A with P^A = NP^A", "CO", "There exists a recursive oracle A with P^A = NP^A.", ["theorem"], {
    profile: "T",
    statement_only: true,
    src: [["M07", "abstract (original paper)"]],
    u: ["P40", "P41"],
  }),
  prop("P44", "∃ recursive oracle B with P^B ≠ NP^B", "CO", "There exists a recursive oracle B with P^B ≠ NP^B.", ["theorem"], {
    profile: "T",
    statement_only: true,
    src: [["M07", "abstract"]],
    u: ["P40", "P41"],
  }),
  prop(
    "P45",
    "Relativization barrier",
    "CO",
    "Because of the oracles of P43 and P44, no argument that relativizes universally (P42) can resolve P vs NP (read in C0). It blocks a class of techniques, not the problem.",
    ["theorem", "barrier"],
    {
      profile: "T",
      src: [["M09", "introduction (explicit meta-consequence of M07)"], ["M07", "abstract"]],
      attribution: "Aaronson, Wigderson (meta-consequence of Baker, Gill, Solovay)",
      u: ["P43", "P44", "P42"],
    },
    {
      barrier: {
        predicate: "The argument relativizes universally (P42): its claim holds for every oracle A of the CO regime.",
        conditions: [
          "Oracles with conventional query cost, quantified externally (CO).",
          "Premises: ∃A P^A = NP^A (P43) and ∃B P^B ≠ NP^B (P44).",
          "Target statement P vs NP is interpreted in C0 (CO→C0).",
        ],
        restricts: "Universally relativizing techniques cannot resolve P vs NP; techniques outside the predicate are not restricted by this barrier.",
      },
    },
  ),
  obj(
    "P46",
    "Low-degree extension Ã",
    "CA",
    "Low-degree extension Ã of a Boolean oracle A over a specified field/ring with degree bounds; not an unrestricted free choice.",
    { profile: "D", src: [["M09", "§2"]], u: ["P39"] },
  ),
  defn("P47", "Algebrizing inclusion", "CA", "An inclusion C ⊆ D algebrizes if for all A, Ã: C^A ⊆ D^Ã.", { profile: "D", src: [["M09", "§2"]], u: ["P46"] }, {
    variables: [{ name: "A", binder: "forall" }, { name: "Ã", binder: "forall" }],
  }),
  defn(
    "P48",
    "Algebrizing separation",
    "CA",
    "A separation C ⊄ D algebrizes if for all A, Ã: C^Ã ⊄ D^A (oracle assignment differs from P47).",
    { profile: "D", src: [["M09", "§2"]], u: ["P46"], refs: [{ key: "P47", purpose: "background", role: "definition" }] },
    { variables: [{ name: "A", binder: "forall" }, { name: "Ã", binder: "forall" }] },
  ),
  prop("P49", "IP = PSPACE algebrizes", "CA", "IP = PSPACE algebrizes: PSPACE^A ⊆ IP^Ã.", ["theorem"], {
    profile: "T",
    src: [["M09", "Theorem 3.7"]],
    u: ["P46", "P47"],
  }),
  meth(
    "P50",
    "Arithmetization of protocols",
    "CA",
    "Arithmetization of interactive protocols avoids ordinary relativization in the IP results. Not a solution of P vs NP.",
    { profile: "M", src: [["M09", "§§1, 3"]] },
  ),
  prop(
    "P51",
    "Algebrization barrier",
    "CA",
    "Resolving P vs NP (read in C0) requires non-algebrizing techniques.",
    ["theorem", "barrier"],
    { profile: "T", src: [["M09", "Theorems 5.1, 5.3"]], u: ["P47", "P48"] },
    {
      barrier: {
        predicate: "The technique algebrizes in the sense of P47/P48 (claims survive replacing one oracle by its low-degree extension Ã as specified).",
        conditions: [
          "Algebraic oracles with the asymmetric access of M09 §2 (CA).",
          "Evidence: algebraic-oracle constructions of M09 Theorems 5.1, 5.3.",
          "Target statement P vs NP is interpreted in C0 (CA→C0).",
        ],
        restricts: "Algebrizing techniques cannot resolve P vs NP; non-algebrizing techniques are not restricted by this barrier.",
      },
    },
  ),
  rel(
    "R_P50_SUPPORTS_P49",
    "Arithmetization supports IP = PSPACE algebrizing",
    "CA",
    "supports",
    [sl("e1", "evidence", "P50"), sl("t1", "target", "P49")],
    { modality: "evidential", interpretation: "The arithmetization method underlies the IP = PSPACE result shown to algebrize.", scope: "M09 §3" },
    { src: [["M09", "§§1, 3"]] },
  ),
];

// ---------------------------------------------------------------- P52–P63

const P52_63: FixItem[] = [
  obj("P52", "Property family C_n ⊆ F_n", "CN", "A combinatorial property is a family C_n ⊆ F_n, where F_n is the set of all Boolean functions on n variables.", {
    profile: "D",
    src: [["M08", "§2"]],
    u: ["P22"],
  }),
  defn(
    "P53",
    "Constructivity",
    "CN",
    "Constructivity of a subset C′_n ⊆ C_n: membership f_n ∈ C′_n is decidable in time polynomial in the truth-table length N = 2^n (generalizable to a declared constructivity class).",
    { profile: "D", src: [["M08", "§2.1"]], u: ["P52"] },
  ),
  defn("P54", "Largeness", "CN", "Largeness of the same subset C′_n: density |C′_n|/|F_n| ≥ 2^(−O(n)).", {
    profile: "D",
    src: [["M08", "§§2.1–2.2"]],
    u: ["P52", "P53"],
  }),
  defn(
    "P55",
    "Useful against P/poly",
    "CN",
    "A property is useful against P/poly if every family of functions accepted by it infinitely often does not belong to P/poly.",
    { profile: "D", src: [["M08", "§2.2"]], u: ["P23", "P52"] },
  ),
  make(
    "declaration",
    "P56",
    "P56: Strong pseudorandom generator hypothesis",
    "CN",
    {
      category: "propositional",
      statement:
        "There is a PRG G_k: {0,1}^k → {0,1}^{2k} in P/poly whose hardness H(G_k) is not bounded by 2^(k^o(1)); hardness H means circuits of size S distinguish with advantage ≥ 1/S only for S ≥ H.",
      editorial_roles: ["hypothesis"],
      usage: "hypothesis",
    },
    { profile: "H", src: [["M08", "§4, Theorem 4.1 (not assumed proven)"]], attribution: "Razborov, Rudich" },
  ),
  prop(
    "P57",
    "Natural proofs barrier",
    "CN",
    "If a P/poly-natural property is useful against P/poly, then H(G_k) ≤ 2^(k^o(1)) for every PRG G_k in P/poly (conditional conflict with P56).",
    ["theorem", "barrier"],
    { profile: "T", src: [["M08", "Theorem 4.1"]], u: ["P53", "P54", "P55"], refs: [{ key: "P56", purpose: "explicit_informal", role: "statement" }] },
    {
      barrier: {
        predicate: "The lower-bound argument yields a P/poly-natural property useful against P/poly.",
        conditions: [
          "Constructivity (P53, here relaxed to P/poly in the truth-table length N = 2^n) and largeness (P54, density ≥ 2^(−O(n))) hold for the SAME subset witness C′_n.",
          "Usefulness against P/poly (P55).",
          "Hardness threshold: the conclusion is H(G_k) ≤ 2^(k^o(1)) for every PRG G_k in P/poly; it conflicts only with PRGs of hardness beyond 2^(k^o(1)) (P56), not with mere existence of one-way functions.",
        ],
        restricts:
          "Under P56, no P/poly-natural property is useful against P/poly; arguments that do not yield such a property (or vary constructivity/largeness/usefulness) are outside this barrier.",
      },
    },
  ),
  argu(
    "P58",
    "Natural property yields a distinguisher",
    "CN",
    {
      targets: [r("P57")],
      summary: "A natural property gives a distinguisher that contradicts strong PRG hardness.",
      steps: [
        { id: "s1", text: "Read outputs of the generator as truth tables of functions on n variables (N = 2^n).", uses: [r("P53")] },
        { id: "s2", text: "Largeness: random functions satisfy the property with non-negligible density.", uses: [r("P54")] },
        { id: "s3", text: "Usefulness: pseudorandom functions computed in P/poly do not satisfy it; the constructive test distinguishes.", uses: [r("P55")] },
      ],
    },
    { profile: "P", src: [["M08", "proof of Theorem 4.1"]] },
  ),
  meth(
    "P59",
    "Diagonalization (scope note w.r.t. natural proofs)",
    "CTX_C0CN",
    "Diagonalization does not automatically fit the natural pattern; P57 does not block it merely by name. Not-applicable holds only for the analyzed argument; diagonalization still faces the relativization issue (P45).",
    { profile: "M", src: [["M09", "§1"]], refs: [{ key: "P45", purpose: "background", role: "statement" }] },
  ),
  obj(
    "P60",
    "Almost-natural property",
    "CN",
    "Almost-natural property: density Ω(2^(−q(n))) with q quasipolynomial (changes largeness P54); quasi-useful means accepting eventually, not infinitely often.",
    { profile: "D", src: [["M10", "Definitions 4–5/Theorem 2"]], refs: [{ key: "P54", purpose: "background", role: "definition" }] },
  ),
  prop(
    "P61",
    "Chow Theorem 2",
    "CN",
    "If ∃ε > 0 and a 2^(n^ε)-hard PRG in P/poly, then a nearly-linear-natural property of density as in P60 separates NP from P/poly. Quasi-usefulness in the construction; not an unconditional separation.",
    ["theorem"],
    { profile: "T", src: [["M10", "Theorem 2"]], u: ["P60"] },
  ),
  argu(
    "P62",
    "Chow's proof with γ-discrimination",
    "CN",
    { targets: [r("P61")], summary: "Proof via γ-discrimination with γ(m) = m^e, e > 1 + c/ε when the PRG has size k^c." },
    { profile: "P", src: [["M10", "§3, proof of Theorem 2"]] },
  ),
  prop(
    "S_M10_THM5",
    "M10 Theorem 5 (attributed to Vadhan)",
    "CN",
    "If SAT has no circuits of size 2^(n^ε), γ(n) outstrips (log n)^(1/ε) and q = 2^γ, then there is a separating sublinear-natural property of density 2^(−q).",
    ["theorem"],
    { profile: "T", src: [["M10", "§5, Theorem 5"]], attribution: "Salil Vadhan (as attributed in M10)" },
  ),
  argu(
    "P63",
    "Vadhan's argument (M10 §5)",
    "CN",
    {
      targets: [r("S_M10_THM5")],
      summary:
        "SAT without circuits of size 2^(n^ε), γ(n) outstripping (log n)^(1/ε), q = 2^γ ⇒ a separating sublinear-natural property of density 2^(−q). Another technique under a different assumption than P62 (SAT hardness vs PRG hardness).",
    },
    { profile: "P", src: [["M10", "§5 (attribution to Vadhan)"]], attribution: "Salil Vadhan (as attributed in M10)", refs: [{ key: "P62", purpose: "background", role: "proof" }] },
  ),
];

// ---------------------------------------------------------------- P64–P80

const P64_80: FixItem[] = [
  research(
    "P64",
    "Geometric complexity theory program",
    "CG",
    { role: "program", goal: "Study geometric/representation-theoretic obstructions for algebraic lower bounds (GCT). Motivates goals; no equivalence with P ≠ NP." },
    { profile: "M", src: [["M11", "original abstract"]] },
  ),
  obj("P65", "Permanent per_m", "CG", "per_m = Σ_(π∈S_m) ∏_i X_(i,π(i)).", { profile: "D", src: [["M12", "§1 definition"]] }),
  obj("P66", "Determinant det_n", "CG", "det_n = Σ_(π∈S_n) sgn(π) ∏_i X_(i,π(i)).", { profile: "D", src: [["M12", "§1"]] }),
  obj(
    "P67",
    "Orbit closures Ω_n and Z_(n,m)",
    "CG",
    "Ω_n = closure(GL_(n²)·det_n); Z_(n,m) = orbit closure of the padded permanent; parameters and padding fixed as in M12.",
    { profile: "D", src: [["M12", "§1(a)"]], u: ["P65", "P66"] },
    [{ name: "n" }, { name: "m" }],
  ),
  meth("P68", "Occurrence obstruction", "CG", "Occurrence obstruction: an irreducible representation λ that occurs in ℂ[Z] but not in ℂ[Ω]; λ is the witness.", {
    profile: "D",
    src: [["M12", "§1(a)"]],
    u: ["P67"],
  }),
  meth("P69", "Multiplicity obstruction", "CG", "Multiplicity obstruction: compares multiplicities of λ, not only presence/absence. Alternative to P68.", {
    profile: "D",
    src: [["M12", "§1(d)"]],
    u: ["P67"],
    refs: [{ key: "P68", purpose: "background", role: "definition" }],
  }),
  make(
    "declaration",
    "P70",
    "P70: Occurrence obstruction conjecture",
    "CG",
    {
      category: "propositional",
      statement: "For every c ∈ ℕ≥1, for infinitely many m there is an occurrence obstruction with n = m^c. Historical conjecture.",
      variables: [{ name: "c", domain: "ℕ≥1", binder: "forall" }, { name: "m", binder: "exists", domain: "infinitely many m" }],
      editorial_roles: ["conjecture"],
    },
    { profile: "F", src: [["M12", "Conjecture 1.4"]], u: ["P68"] },
  ),
  prop(
    "P71",
    "No occurrence obstructions for n ≥ m^25",
    "CG",
    "For n ≥ m^25 and λ ⊢ nd: if λ occurs in ℂ[Z_(n,m)] then λ occurs in ℂ[Ω_n]. Refutes P70 asymptotically; does not refute the program P64.",
    ["theorem", "barrier"],
    { profile: "T", src: [["M12", "Theorem 1.5 (copy dated 2017-03-09)"]], u: ["P67"] },
    {
      variables: [{ name: "n", binder: "forall" }, { name: "m", binder: "forall" }, { name: "λ", binder: "forall", domain: "partitions of nd" }],
      barrier: {
        predicate: "The route relies only on occurrence obstructions (presence/absence of λ) to separate Z_(n,m) from Ω_n.",
        conditions: ["n ≥ m^25", "λ ⊢ nd", "occurrence only (multiplicities are not addressed)"],
        restricts: "In this regime no occurrence obstruction exists, so the occurrence route (P68) is blocked; multiplicity obstructions (P69) are not ruled out by this result.",
      },
    },
  ),
  rel(
    "R_P71_REFUTES_P70",
    "P71 refutes P70 asymptotically",
    "CG",
    "refutes",
    [sl("e1", "evidence", "P71"), sl("t1", "target", "P70")],
    {
      modality: "logical",
      interpretation: "P71 negates the occurrence-obstruction conjecture P70 for exponents c ≥ 25.",
      scope: "n ≥ m^25 (asymptotic); not a refutation of P64",
      fields: { negated: "P70: existence of occurrence obstructions with n = m^c for every c (fails for c ≥ 25)" },
    },
    { src: [["M12", "Theorem 1.5; §1(a)"]] },
  ),
  rel(
    "P72",
    "P71 blocks the occurrence route P68",
    "CG",
    "challenges",
    [sl("e1", "evidence", "P71"), sl("t1", "target", "P68")],
    {
      modality: "logical",
      interpretation: "P71 blocks the occurrence-obstruction route (P68) for the separation sought by P70, in the regime n ≥ m^25.",
      scope: "n ≥ m^25, occurrence obstructions only",
    },
    { profile: "T", src: [["M12", "§1(a), 1(d); relation transcription"]], refs: [{ key: "P70", purpose: "background", role: "statement" }] },
  ),
  rel(
    "P73",
    "P71 does not rule out the multiplicity route",
    "CG",
    "limits_scope@fixture-1",
    [sl("l1", "limit", "P69"), sl("t1", "target", "P72")],
    {
      modality: "logical",
      interpretation:
        "The blocking relation P72 concerns mere occurrence; the multiplicity route P69 remains possible. Not a positive proof that the route succeeds.",
      scope: "scope of P72",
    },
    { profile: "R", src: [["M12", "§1(d), explicit"]] },
  ),
  rel(
    "R_P64_PARTS",
    "GCT program parts",
    "CG",
    "has_part",
    [sl("w", "whole", "P64"), sl("p1", "part", "P67"), sl("p2", "part", "P68"), sl("p3", "part", "P69")],
    { modality: "editorial", interpretation: "The GCT program P64 has parts P67–P69." },
    { src: [["M11", "abstract"], ["M12", "§1"]] },
  ),
  research(
    "P74",
    "Proof complexity program",
    "CP",
    {
      role: "program",
      goal: "Proof complexity: lower bounds on proof lengths. Route toward NP ≠ coNP, which is sufficient toward P ≠ NP.",
    },
    { profile: "M", src: [["M13", "§1"]] },
  ),
  obj("P75", "TAUT", "CP", "TAUT: propositional formulas true under every assignment. Distinct from SAT (P12); the contexts share syntax.", {
    profile: "D",
    src: [["M13", "§1"]],
    refs: [{ key: "P12", purpose: "background", role: "definition" }],
  }),
  defn("P76", "Cook–Reckhow proof system", "CP", "A Cook–Reckhow proof system is a polynomial-time computable function onto TAUT (surjective; sound in its codomain).", {
    profile: "D",
    src: [["M13", "Definition 1.3"]],
    u: ["P75"],
  }),
  defn(
    "P77",
    "Polynomially bounded proof system",
    "CP",
    "f is polynomially bounded iff ∃ polynomial p ∀ tautology y ∃ proof x: f(x) = y ∧ length(x) ≤ p(length(y)). Quantifier order is essential.",
    { profile: "D", src: [["M13", "Definition 1.3"]], u: ["P76"] },
    { variables: [{ name: "p", binder: "exists" }, { name: "y", binder: "forall" }, { name: "x", binder: "exists" }] },
  ),
  rel(
    "P78",
    "NP = coNP iff a polynomially bounded proof system exists",
    "CP",
    "equivalent_under",
    [sl("s1", "side", "S_NP_EQ_CONP"), sl("s2", "side", "S_PB_SYSTEM")],
    { modality: "logical", interpretation: "NP = coNP iff there is a polynomially bounded Cook–Reckhow proof system. Not equivalent to P = NP.", scope: "CP" },
    { profile: "T", src: [["M13", "Propositions 1.1, 1.4"]], u: ["P77", "P14"] },
  ),
  rel(
    "R_P74_PARTS",
    "Proof complexity program parts",
    "CP",
    "has_part",
    [sl("w", "whole", "P74"), sl("p1", "part", "P75"), sl("p2", "part", "P76"), sl("p3", "part", "P77"), sl("p4", "part", "P78")],
    { modality: "editorial", interpretation: "The proof-complexity program P74 has parts P75–P78." },
    { src: [["M13", "§1"]] },
  ),
  research(
    "P79",
    "Deolalikar 2010 claimed proof of P ≠ NP",
    "CD",
    {
      role: "attempt",
      goal: "Claimed proof of P ≠ NP (Deolalikar, 2010), with public discussion and objections.",
      target: r("S_P_NEQ_NP"),
      attempt: {
        strategy: "Claimed proof of P ≠ NP as discussed publicly in M14–M15 (including the k-SAT vs k-XORSAT interaction raised by critics); details not fully recovered.",
        result: "partial",
        observed: "claimed proof; public objections; author maintained the claim (M15)",
        artifacts_missing_reason: "original draft not fully recovered; no exact revision pinned",
      },
    },
    { profile: "F", src: [["M14", "critiques and signed comments"], ["M15", "author's response"]], attribution: "Deolalikar (claim as reported in M14–M15)" },
  ),
  rel(
    "P80",
    "Critiques of the P79 argument",
    "CD",
    "challenges",
    [sl("e1", "evidence", "M14"), sl("t1", "target", "P79")],
    {
      modality: "historical",
      interpretation:
        "Critiques of steps/scope of the P79 argument, including the k-SAT/k-XORSAT interaction. Historical review evidence, not a contractual Review without a pinned revision; not a new impossibility theorem.",
      scope: "public discussion Aug 2010; exact original revision unresolved",
      fields: { context_comparison: "unresolved" },
    },
    { profile: "F", src: [["M14", "signed comments"]] },
  ),
];

// ---------------------------------------------------------------- evaluations on literature rows

const LIT_EVALS: FixItem[] = [
  evaluation(
    "P45#applicability#P50",
    "Relativization barrier P45 does not apply to arithmetization P50",
    "CA",
    {
      eval_kind: "applicability",
      subject: r("P50"),
      barrier: r("P45"),
      predicate: "The technique relativizes universally (P42).",
      value: "does_not_apply",
      scope: "arithmetization as used in the IP results (M09 §§1, 3); says nothing about other barriers",
      reason: "Arithmetization avoids ordinary relativization.",
      evidence: [r("P49")],
      assessor: { descriptor: "Aaronson, Wigderson — via M09 (transcribed)" },
    },
    { src: [["M09", "§§1, 3"]] },
  ),
  evaluation(
    "P51#applicability#P50",
    "Algebrization barrier P51 applies to arithmetization P50",
    "CA",
    {
      eval_kind: "applicability",
      subject: r("P50"),
      barrier: r("P51"),
      predicate: "The technique algebrizes (P47/P48).",
      value: "applies",
      scope: "arithmetization-based techniques as analyzed in M09 (e.g. IP = PSPACE algebrizes, P49)",
      reason: "M09 shows arithmetization-based results algebrize; overcoming relativization does not overcome algebrization.",
      evidence: [r("P49")],
      assessor: { descriptor: "Aaronson, Wigderson — via M09 (transcribed)" },
    },
    { src: [["M09", "Theorem 3.7; §§1, 5"]] },
  ),
  evaluation(
    "P57#applicability#P59",
    "Natural-proofs barrier P57 does not apply to the analyzed diagonalization P59",
    "CTX_C0CN",
    {
      eval_kind: "applicability",
      subject: r("P59"),
      barrier: r("P57"),
      predicate: "The argument yields a P/poly-natural property useful against P/poly.",
      value: "does_not_apply",
      scope: "only the analyzed diagonalization argument; no universal endorsement; relativization (P45) still applies separately",
      assessor: { descriptor: "Aaronson, Wigderson — via M09 §1 (transcribed)" },
    },
    { src: [["M09", "§1"]] },
  ),
  evaluation(
    "P70#refuted",
    "Logical status of P70: refuted (per M12)",
    "CG",
    {
      eval_kind: "assessment",
      subject: r("P70"),
      dimension: "logical",
      value: "refuted",
      scope: "as reported by M12 (copy dated 2017-03-09): fails for n ≥ m^25",
      evidence: [r("P71"), r("R_P71_REFUTES_P70")],
      assessor: { descriptor: "Bürgisser, Ikenmeyer, Panova — via M12 (transcribed)" },
    },
    { src: [["M12", "Theorem 1.5"]] },
  ),
  evaluation(
    "P79#provenance",
    "Provenance of P79: partial",
    "CD",
    {
      eval_kind: "assessment",
      subject: r("P79"),
      dimension: "provenance",
      value: "partial",
      scope: "original draft not fully recovered; no exact revision pinned",
      assessor: { descriptor: "Handoff transcription assistant (AI)" },
    },
    { src: [["M14", "discussion"], ["M15", "response"]] },
  ),
];

// ---------------------------------------------------------------- product scenarios (synthetic)

const S = { label: SYN } as const;

const SCENARIOS: FixItem[] = [
  research(
    "O01",
    "Objective: answer P vs NP in C0",
    "C0",
    {
      role: "objective",
      goal: "answer P vs NP in C0",
      target: r("S_PVNP_Q"),
      answer_criterion: "A proof of P = NP or of P ≠ NP in C0, with an assessment of that proof.",
      closure_criterion: "An accepted answer statement with an assessed proof; candidate routes O02–O05 are not declared exhaustive.",
    },
    { ...S, src: [["M16", "opening source: classification 'Unsolved'"]] },
  ),
  research(
    "O02",
    "Obligation: prove SAT ∉ P",
    "C0",
    {
      role: "obligation",
      goal: "Prove SAT ∉ P (sufficient route to P ≠ NP via P19).",
      target: r("S_SAT_NOT_IN_P"),
      closure_criterion: "An exact proof of SAT ∉ P (or an exact counter-answer), assessed.",
    },
    { ...S, u: ["P19"] },
  ),
  research(
    "O03",
    "Obligation: prove SAT ∉ P/poly",
    "CTX_C0CC",
    {
      role: "obligation",
      goal: "Prove SAT ∉ P/poly (stronger sufficient route via P25/P14). Examine P57/P51 according to the technique used, never by name.",
      target: r("S_SAT_NOT_IN_PPOLY"),
      closure_criterion: "An exact proof of SAT ∉ P/poly, assessed, with barrier applicability (P57, P51) evaluated for its technique.",
    },
    { ...S, u: ["P25", "P14"] },
  ),
  research(
    "O04",
    "Obligation: prove NP ≠ coNP",
    "CTX_C0CP",
    {
      role: "obligation",
      goal: "Prove NP ≠ coNP; sufficient for P ≠ NP because P is closed under complement. Uses P78; proof-complexity approach P74.",
      target: r("S_NP_NEQ_CONP"),
      closure_criterion: "An exact proof of NP ≠ coNP (e.g. super-polynomial lower bounds for every Cook–Reckhow system), assessed.",
    },
    { ...S, u: ["P78"], refs: [{ key: "P74", purpose: "background", role: "definition" }] },
  ),
  research(
    "O05",
    "Objective: permanent vs determinant (GCT)",
    "CG",
    {
      role: "objective",
      goal: "Permanent vs determinant in CG via the GCT program P64. Candidate relevance to O01 with a bridge explicitly NOT established in this sample; no false equivalence.",
      answer_criterion: "A determination of the determinantal complexity of per_m relative to det_n in CG.",
      closure_criterion: "An assessed super-polynomial lower bound (or its negation) for the padded permanent vs determinant in CG.",
    },
    { ...S, u: ["P64", "P65", "P66"] },
  ),
  research(
    "O06",
    "Diagnostic: does the concrete argument relativize or algebrize?",
    "CTX_COCA",
    {
      role: "obligation",
      goal: "Diagnostic: does the concrete argument satisfy P42 (relativizes) or P47/P48 (algebrizes)? May unblock evaluation of O02 and O03.",
      closure_criterion: "An applicability assessment (eval_kind applicability) with evidence for the concrete argument against P45/P42 and P51/P47/P48.",
    },
    { ...S, u: ["P42", "P47", "P48"] },
  ),
  research(
    "O07",
    "Inquiry line: occurrence vs multiplicity obstructions",
    "CG",
    {
      role: "inquiry_line",
      goal: "Branch of O05 through occurrence obstructions (P68) or multiplicity obstructions (P69). Local OR of strategies; P72 blocks the first in its regime, the second is not blocked by that result.",
    },
    { ...S, u: ["P68", "P69"], refs: [{ key: "P72", purpose: "background", role: "statement" }] },
  ),
  research(
    "O08",
    "Obligation: extend P37 to a more expressive C",
    "CW",
    {
      role: "obligation",
      goal: "Extend the method P37 to a more expressive circuit class C (definition of C fixed). Only yields the conclusion of P38, not O01 automatically.",
      target: r("S_NTIME_NOT_C"),
      closure_criterion: "A fixed class C satisfying the closure conditions of P38 and an assessed fast C-SAT algorithm, giving NTIME(2^n) ⊄ poly-size C.",
    },
    { ...S, u: ["P37", "P38"] },
  ),
  research(
    "R_OCC",
    "Occurrence-obstruction route",
    "CG",
    { role: "approach", goal: "occurrence-obstruction route: separate Z_(n,m) from Ω_n by occurrence obstructions (P68)." },
    { ...S, u: ["P68"] },
  ),
  research(
    "R_MULT",
    "Multiplicity-obstruction route",
    "CG",
    { role: "approach", goal: "multiplicity-obstruction route: separate Z_(n,m) from Ω_n by multiplicity obstructions (P69)." },
    { ...S, u: ["P69"] },
  ),
  rel(
    "R_PLAN_O01",
    "Plan for O01 (local OR of candidate routes)",
    "C0",
    "decomposes_into",
    [
      sl("w", "whole", "O01"),
      sl("p1", "part", "O02", { modality: "proven_sufficient" }),
      sl("p2", "part", "O03", { modality: "proven_sufficient" }),
      sl("p3", "part", "O04", { modality: "proven_sufficient" }),
      sl("p4", "part", "O05", { modality: "candidate_route", note: "bridge to O01 not established" }),
    ],
    {
      modality: "heuristic",
      interpretation: "O01 may be answered (toward P ≠ NP) via O02, O03 or O04 (each proven sufficient), or O05 as a candidate route. OR is local; not exhaustive.",
      fields: {
        plan_mode: "OR",
        context_map: "O03 and O04 live in C0+CC and C0+CP, which import C0; O05 lives in CG with an explicitly unestablished bridge to C0.",
      },
    },
    S,
  ),
  rel(
    "R_PLAN_O02",
    "Plan for O02: diagnostic O06",
    "C0",
    "decomposes_into",
    [sl("w", "whole", "O02"), sl("p1", "part", "O06", { modality: "diagnostic" })],
    {
      modality: "heuristic",
      interpretation: "Barrier diagnosis O06 unblocks evaluation of techniques for O02; it does not prove O02.",
      fields: { plan_mode: "AND", context_map: "O06 is posed in CO/CA about arguments whose target statements are read in C0." },
    },
    S,
  ),
  rel(
    "R_PLAN_O03",
    "Plan for O03: diagnostic O06",
    "CTX_C0CC",
    "decomposes_into",
    [sl("w", "whole", "O03"), sl("p1", "part", "O06", { modality: "diagnostic" })],
    {
      modality: "heuristic",
      interpretation: "Barrier diagnosis O06 unblocks evaluation of techniques for O03; it does not prove O03.",
      fields: { plan_mode: "AND", context_map: "O06 is posed in CO/CA about arguments whose target statements are read in C0+CC." },
    },
    S,
  ),
  rel(
    "R_PLAN_O05",
    "Plan for O05: inquiry line O07",
    "CG",
    "decomposes_into",
    [sl("w", "whole", "O05"), sl("p1", "part", "O07", { modality: "strategy" })],
    { modality: "heuristic", interpretation: "O05 is pursued through the inquiry line O07.", fields: { plan_mode: "OR" } },
    S,
  ),
  rel(
    "R_PLAN_O07",
    "Plan for O07: occurrence OR multiplicity",
    "CG",
    "decomposes_into",
    [sl("w", "whole", "O07"), sl("p1", "part", "R_OCC", { modality: "candidate_route" }), sl("p2", "part", "R_MULT", { modality: "candidate_route" })],
    { modality: "heuristic", interpretation: "Local OR of two routes; P72 blocks the occurrence route in its regime, the multiplicity route is not blocked by that result.", fields: { plan_mode: "OR" } },
    S,
  ),
  evaluation(
    "P71#applicability#R_OCC",
    "P71 applies to the occurrence route",
    "CG",
    {
      eval_kind: "applicability",
      subject: r("R_OCC"),
      barrier: r("P71"),
      predicate: "The route relies only on occurrence obstructions with n ≥ m^25.",
      value: "applies",
      scope: "n ≥ m^25, λ ⊢ nd, occurrence only",
      evidence: [r("P72")],
      assessor: { descriptor: "Handoff author (scenario), per M12 Theorem 1.5" },
    },
    { ...S, src: [["M12", "Theorem 1.5; §1(a)"]] },
  ),
  evaluation(
    "P71#applicability#R_MULT",
    "P71 does not apply to the multiplicity route",
    "CG",
    {
      eval_kind: "applicability",
      subject: r("R_MULT"),
      barrier: r("P71"),
      predicate: "The route relies only on occurrence obstructions with n ≥ m^25.",
      value: "does_not_apply",
      scope: "P71 concerns occurrence only; multiplicity obstructions are not ruled out by it (no positive claim of success)",
      evidence: [r("P73")],
      assessor: { descriptor: "Handoff author (scenario), per M12 §1(d)" },
    },
    { ...S, src: [["M12", "§1(d)"]] },
  ),
  // N01 + its motivates relation stay in the candidate inbox.
  prop(
    "N01",
    "Proposed dispersion measure (candidate)",
    "CC",
    "A proposed 'dispersion measure' score of Boolean functions correlates with circuit hardness (hypothetical scenario content; no proof; relation to P vs NP unknown).",
    ["conjecture"],
    { ...S, candidate_only: true },
  ),
  rel(
    "R_N01_MOTIVATES_O03",
    "N01 motivates O03 (candidate)",
    "CTX_C0CC",
    "motivates",
    [sl("m1", "motivator", "N01"), sl("t1", "motivated", "O03")],
    { modality: "heuristic", interpretation: "The proposed measure N01 motivates work on O03; no entailment and no bridge to P vs NP." },
    { ...S, candidate_only: true },
  ),
  rel(
    "R_INFERRED_P36_P33",
    "Inferred dependency P36 → P33 (proposal)",
    "CTX_C0CC",
    "depends_on",
    [sl("c", "consumer", "P36"), sl("i1", "input", "P33")],
    {
      modality: "heuristic",
      interpretation: "proposed by topical proximity",
      fields: { dependency_kind: "inferred", inference_method: "topical proximity (circuit lower bounds)" },
    },
    { ...S, candidate_only: true },
  ),
  // FA01 / CE01 / RV01 / FL01: incorrect proof, counterexample to its step, review, failed attempt.
  argu(
    "FA01",
    "Incorrect proof fixture of P ≠ NP",
    "C0",
    {
      targets: [r("S_P_NEQ_NP")],
      completeness: "complete",
      summary: "'SAT has 2^n assignments; enumerating them takes exponential time; therefore SAT ∉ P.' Explicitly invalid in the jump enumeration → all algorithms. The conclusion is NOT refuted.",
      steps: [
        { id: "s1", text: "Counting: a formula with n variables has 2^n assignments.", uses: [r("P12")] },
        { id: "s2", text: "Enumeration: checking every assignment takes exponential time.", uses: [] },
        { id: "s3", text: "Invalid inference: therefore every algorithm for SAT takes exponential time, so SAT ∉ P and P ≠ NP.", uses: [] },
      ],
    },
    { ...S, u: ["P12"] },
  ),
  evaluation(
    "FA01#logical",
    "Logical status of FA01: proof claimed (synthetic)",
    "C0",
    {
      eval_kind: "assessment",
      subject: r("FA01"),
      dimension: "logical",
      value: "proof_claimed",
      scope: "as claimed by the synthetic fixture; see RV01 for the defect",
      assessor: { descriptor: "Handoff author (scenario)" },
    },
    S,
  ),
  rel(
    "R_FA01_PROVES",
    "FA01 allegedly proves P ≠ NP",
    "C0",
    "proves",
    [sl("e1", "evidence", "FA01"), sl("t1", "target", "S_P_NEQ_NP")],
    { modality: "logical", assertion: "claimed", interpretation: "FA01 purports a complete derivation of P ≠ NP (claimed; see RV01)." },
    S,
  ),
  argu(
    "CE01",
    "Counterexample to FA01's inference pattern",
    "CTX_C0CC",
    {
      targets: [r("FA01")],
      argument_kind: "counterexample",
      completeness: "complete",
      summary:
        "Finding an n-bit assignment with prescribed parity by enumeration considers 2^n candidates, but constructing one takes O(n): n−1 zeros and a last bit equal to the prescribed parity. Refutes the jump 'many candidates ⇒ every solution is exponential', not P ≠ NP.",
      steps: [
        { id: "s1", text: "Fix n and a prescribed parity b; enumeration considers 2^n candidate assignments.", uses: [r("P27")] },
        { id: "s2", text: "The assignment 0^(n−1)b has parity b and is produced in O(n) steps.", uses: [] },
        { id: "s3", text: "Hence the number of candidates does not bound the cost of every solution method.", uses: [] },
      ],
    },
    S,
  ),
  rel(
    "R_CE01_REFUTES_STEP",
    "CE01 refutes step s3 of FA01",
    "CTX_C0CC",
    "refutes",
    [sl("e1", "evidence", "CE01"), sl("t1", "target", "FA01")],
    {
      modality: "logical",
      interpretation: "CE01 negates the validity of FA01's step s3; it does not refute FA01's conclusion P ≠ NP.",
      scope: "step s3 of FA01 only",
      fields: { negated: "validity of step s3 ('many candidates ⇒ every solution exponential')" },
    },
    S,
  ),
  evaluation(
    "RV01",
    "RV01: Review of FA01",
    "C0",
    {
      eval_kind: "review",
      subject: r("FA01"),
      locator: "s3",
      scope: "FA01 r1 as a derivation of P ≠ NP; the conclusion remains open",
      findings: [
        { dimension: "correctness", value: "defect_found", locator: "s3", text: "The jump from enumeration cost to all algorithms is invalid (CE01).", source_verdict: "failed" },
        { dimension: "completeness", value: "gaps_found", locator: "s3", text: "No argument covers algorithms other than enumeration." },
      ],
      evidence: [r("CE01")],
      assessor: { descriptor: "Handoff author (no expert certification)" },
    },
    S,
  ),
  rel(
    "RR01",
    "RV01 challenges the alleged proof FA01 → P ≠ NP",
    "C0",
    "challenges",
    [sl("e1", "evidence", "RV01"), sl("t1", "target", "R_FA01_PROVES")],
    {
      modality: "logical",
      interpretation: "The review challenges the alleged support relation, not the statement P ≠ NP (relation on relation).",
      scope: "the claimed proves relation R_FA01_PROVES",
    },
    S,
  ),
  research(
    "O_REPAIR",
    "Obligation: repair FA01 step s3",
    "C0",
    {
      role: "obligation",
      goal: "Repair step s3 of FA01: replace the invalid inference with a valid argument covering all algorithms, or abandon the strategy.",
      target: r("FA01"),
      closure_criterion: "A revised FA01 whose step s3 is replaced by an assessed valid argument, or an explicit abandonment decision.",
    },
    S,
  ),
  research(
    "FL01",
    "Failed attempt: SAT ∉ P by enumeration",
    "C0",
    {
      role: "attempt",
      goal: "Attempt on O02 via the enumeration strategy FA01.",
      target: r("O02"),
      attempt: {
        strategy: "FA01",
        steps: [
          { id: "s1", text: "counting of assignments" },
          { id: "s2", text: "enumeration cost" },
          { id: "s3", text: "invalid inference to all algorithms" },
        ],
        artifacts: [r("FA01")],
        result: "failed",
        observed: "Step s3 is an invalid inference (CE01, RV01).",
        failure: {
          kind: "logical_error",
          defect_locator: "step s3 of FA01",
          observed: "The inference 'many candidates ⇒ every solution exponential' fails (CE01).",
          allowed_negative_conclusion: "this inference does not establish a lower bound",
          non_conclusions: ["SAT ∈ P", "P ≠ NP is false", "no technique works"],
          barrier_applicability: { status: "none_known" },
          successors: [r("O_REPAIR")],
          evaluator: "Handoff author",
          evaluated_at: "2026-10-01",
        },
      },
    },
    S,
  ),
  rel(
    "R_FL01_CONTAINS",
    "FL01 contains FA01, CE01, RV01",
    "CTX_C0CC",
    "contains",
    [sl("w", "whole", "FL01"), sl("p1", "part", "FA01"), sl("p2", "part", "CE01"), sl("p3", "part", "RV01")],
    { modality: "editorial", interpretation: "The failed attempt FL01 is composed of FA01, CE01 and RV01." },
    S,
  ),
  // SD01: correction of our own transcription (r1 → r2 in post).
  defn(
    "SD01",
    "Transcription of P53 constructivity",
    "CN",
    "Constructivity (transcription of P53): membership in the subset C′_n ⊆ C_n is decidable in time polynomial in n.",
    { ...S, refs: [{ key: "P53", purpose: "background", role: "definition" }] },
  ),
  prop("ST01", "PARITY ∉ AC0 (scenario statement)", "CC", "PARITY ∉ AC0.", ["conjecture"], {
    ...S,
    profile: "H",
    attribution: "Handoff product scenario (synthetic; not a reconstruction of the real history)",
    u: ["P26", "P27"],
  }),
  rel(
    "RP01",
    "P32 proves P30",
    "CC",
    "proves",
    [sl("e1", "evidence", "P32"), sl("t1", "target", "P30")],
    { modality: "logical", interpretation: "Håstad's proof P32 establishes PARITY ∉ AC0 (P30); handoff synthesis, source-supported." },
    { ...S, profile: "R", src: [["M05", "ch. 4–5"]], attribution: "Johan Håstad (via M05; handoff synthesis)" },
  ),
  argu(
    "FN01",
    "Manual formal derivation of P20",
    "C0",
    {
      targets: [r("P20")],
      argument_kind: "formal_proof",
      completeness: "complete",
      summary:
        "Manual natural-deduction derivation of P20 written in the handoff; NOT machine-checked and no checker extraction is claimed. Proves P = NP from the premises, not P ≠ NP or P = NP outright.",
      steps: [
        { id: "s1", text: "Let K ∈ NP be arbitrary.", uses: [] },
        { id: "s2", text: "NP-completeness of L, ∀elim at K and ⇒elim with K ∈ NP: K ≤p L.", uses: [r("S_L_NPC")] },
        { id: "s3", text: "Closure of P under ≤p, ∀elim and ⇒elim with K ≤p L and L ∈ P: K ∈ P.", uses: [r("S_P_CLOSED"), r("S_L_IN_P")] },
        { id: "s4", text: "∀intro on K: NP ⊆ P.", uses: [] },
        { id: "s5", text: "Subset antisymmetry with P ⊆ NP: P = NP.", uses: [r("P21")] },
      ],
      dependency_sets: [
        {
          id: "D1",
          members: [r("S_L_NPC"), r("S_L_IN_P"), r("S_P_CLOSED"), r("P21")],
          rules: ["∀elim", "⇒elim", "∀intro", "subset antisymmetry"],
          scope: "this derivation only",
          minimality: "none_claimed",
          completeness: "exact_for_this_derivation",
        },
      ],
    },
    {
      ...S,
      refs: [
        { key: "S_L_NPC", purpose: "formal", role: "statement" },
        { key: "S_L_IN_P", purpose: "formal", role: "statement" },
        { key: "S_P_CLOSED", purpose: "formal", role: "statement" },
        { key: "P21", purpose: "formal", role: "statement" },
      ],
    },
  ),
];

const PVNP_POST: PostOp[] = [
  {
    op: "revise",
    key: "SD01r2",
    of: "SD01",
    payload: {
      statement: "Constructivity (transcription of P53): membership in the subset C′_n ⊆ C_n is decidable in time polynomial in the truth-table length N = 2^n.",
    },
    change_summary: "Corrects resource parameter n → N=2^n (our transcription error, not an erratum of Razborov–Rudich)",
    corrects: { defect_locator: "resource parameter", scope: "transcription of P53" },
    comparison: {
      changes: [
        { class: "changed_resource_parameter", description: "n → N = 2^n", status: "declared" },
        { class: "corrected_statement", description: "repairs transcription defect", status: "declared" },
      ],
      verdict: "comparable",
      scope: "SD01 r1→r2",
    },
  },
  {
    op: "validity",
    subject: "P28",
    action: "superseded_in_scope",
    by: "P29",
    scope: "bound navigation (curatorial, local)",
    reason: "P29 gives the near-optimal bound; P28 remains valid and is not refuted",
  },
  { op: "gate", subject: "R_INFERRED_P36_P33", to: "rejected", reason: "No source evidence of use; topical proximity only." },
  { op: "gate", subject: "N01", to: "quarantined", reason: "Hypothetical product-scenario claim without proof or source; kept outside the real corpus." },
];

export const PVNP_FIXTURE: Fixture = {
  name: "P vs NP manual stress test (§29)",
  description:
    "Manual conceptual transcription of the handoff's P vs NP corpus (sources M01–M17, contexts, P01–P80) plus synthetic product scenarios (O01–O08, N01, FA01, CE01, RV01, FL01, SD01, SU01, ST01, RP01, RR01, FN01). Not an automated extraction nor a re-verification of the proofs.",
  contracts: [
    {
      id: "limits_scope",
      version: "fixture-1",
      roles: [
        { role: "limit", card: { min: 1, max: null } },
        { role: "target", card: { min: 1, max: null } },
      ],
      description: "The limit restricts the scope of the target relation/claim; no inference.",
    },
    {
      id: "independent_contribution",
      version: "fixture-1",
      roles: [{ role: "contribution", card: { min: 2, max: null } }],
      description: "Historical relation: the participants are independent contributions to the same development; no equivalence or identity claim.",
    },
  ],
  items: finalize([...PVNP_SOURCES, ...PVNP_CONTEXTS, ...P01_21, ...PVNP_HELPERS, ...P22_38, ...P39_51, ...P52_63, ...P64_80, ...LIT_EVALS, ...SCENARIOS]),
  post: PVNP_POST,
};

// ================================================================== §30 cross-domain

const X_SOURCES: FixItem[] = [
  source("X01", "Hatcher, Algebraic Topology, chapter 1", {
    source_kind: "book",
    citation: "Allen Hatcher, Algebraic Topology, chapter 1, §1.1, Proposition 1.5.",
    authors: ["Allen Hatcher"],
    attribution: "Allen Hatcher",
    url: "https://pi.math.cornell.edu/~hatcher/AT/ATch1.pdf",
    locator: "§1.1, Proposition 1.5 (change of basepoint along a path)",
    unknown: "Author-hosted chapter PDF; no edition or version identifier pinned by the handoff.",
  }),
  source("X02", "Tao, 245A Notes 5: Differentiation theorems", {
    source_kind: "web",
    citation: "Terence Tao, 245A Notes 5: Differentiation theorems, blog notes, 16 October 2010.",
    authors: ["Terence Tao"],
    attribution: "Terence Tao",
    url: "https://terrytao.wordpress.com/2010/10/16/245a-notes-5-differentiation-theorems/",
    locator: "second FTC / Theorem 89 and examples of singular functions",
    published: "2010-10-16",
    exact: "blog notes dated 2010-10-16",
  }),
  source("X03", "Oliveira e Silva, Herzog, Pardi, Goldbach verification to 4×10^18", {
    source_kind: "paper",
    citation: "Oliveira e Silva, Herzog and Pardi, Math. Comp. 83 (2014), 2033–2060; plus the computation site maintained by the author.",
    authors: ["Oliveira e Silva", "Herzog", "Pardi"],
    attribution: "Oliveira e Silva, Herzog, Pardi",
    url: "https://sweet.ua.pt/tos/bib/4.12.html",
    locator: "paper record; computation site https://sweet.ua.pt/tos/goldbach.html",
    edition: "Math. Comp. 83 (2014), 2033–2060. Note: the dataset was NOT downloaded/verified and the computation was not reproduced in this sprint.",
    published: "2014",
    exact: "Math. Comp. 83 (2014), 2033–2060",
  }),
  source("X04", "OEIS A002372", {
    source_kind: "web",
    citation: "OEIS Foundation and contributors, A002372: definition, offset, examples and linked history.",
    authors: ["OEIS Foundation and contributors"],
    attribution: "OEIS Foundation and contributors",
    url: "https://oeis.org/A002372",
    retrieved_at: "2026-10-01",
    unknown: "Page consulted 2026-10-01; no complete historical OEIS revision ID was captured.",
  }),
  source("X05", "Gödel, consistency of AC and GCH (PNAS 1938, 1939)", {
    source_kind: "paper",
    citation:
      "Kurt Gödel, The Consistency of the Axiom of Choice and of the Generalized Continuum-Hypothesis, PNAS 24 (1938), 556–557; Consistency-Proof for the Generalized Continuum-Hypothesis, PNAS 25 (1939), 220–224.",
    authors: ["Kurt Gödel"],
    attribution: "Kurt Gödel",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1077160/",
    locator: "original publications; relative consistency restated in modern notation (not a formal transcription of the historical system)",
    published: "1938",
    exact: "PNAS 24 (1938), 556–557; PNAS 25 (1939), 220–224",
  }),
  source("X06", "Cohen, The Independence of the Continuum Hypothesis (PNAS 1963, 1964)", {
    source_kind: "paper",
    citation: "Paul J. Cohen, The Independence of the Continuum Hypothesis, PNAS 50 (1963), 1143–1148; part II, PNAS 51 (1964), 105–110.",
    authors: ["Paul J. Cohen"],
    attribution: "Paul J. Cohen",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC221287/",
    locator: "originals identified; viewer access limited; not imported as a newly examined step-by-step proof",
    published: "1963",
    exact: "PNAS 50 (1963), 1143–1148; PNAS 51 (1964), 105–110",
    availability: "restricted",
  }),
  source("X07", "Wenzel, Nipkow, Isabelle2021 HOL/ex/Sqrt.thy", {
    source_kind: "formal_library",
    citation: "Wenzel and Nipkow, Isabelle2021, HOL/ex/Sqrt.thy, official archived presentation.",
    authors: ["Wenzel", "Nipkow"],
    attribution: "Wenzel, Nipkow",
    url: "https://isabelle.in.tum.de/website-Isabelle2021/dist/library/HOL/HOL-ex/Sqrt.html",
    locator: "exact text of statements, imports and two proofs; Isabelle was not run in this sprint",
    exact: "Isabelle2021 distribution, HOL/ex/Sqrt.thy",
  }),
];

const X_CONTEXTS: FixItem[] = [
  context("CTOP", "Topology: paths and based fundamental groups (§30A 'CA')", {
    conventions:
      "Topological spaces, paths and homotopies relative to endpoints; based fundamental groups. A path h from x₀ to x₁ induces β_h: π₁(X,x₁)→π₁(X,x₀), [f]↦[h·f·h̄]; the chosen path matters; no canonical identification.",
    notation: [
      { symbol: "π₁(X,x)", meaning: "fundamental group of X based at x" },
      { symbol: "β_h", meaning: "change-of-basepoint isomorphism along the path h" },
      { symbol: "h̄", meaning: "reverse path of h" },
    ],
  }),
  context("CB", "Real analysis on [a,b] with Lebesgue measure", {
    conventions: "Compact interval [a,b] ⊂ ℝ, a < b; Lebesgue measure and integral; a.e. statements carry their null-set scope explicitly.",
    notation: [{ symbol: "a.e.", meaning: "outside a Lebesgue-null set (scope stated per statement)" }],
  }),
  context("CNT", "Elementary number theory (§30C 'CC')", {
    conventions: "Integers, exact primality and sums of two primes.",
  }),
  context("CEXEC_C", "Computational execution context for the Goldbach verification", {
    parent: r("CNT"),
    profile: "computational",
    conventions: "Execution context of the X03 computation as referenced by its paper/site; values not recorded by the handoff are unknown.",
    execution: {
      software: "unknown (algorithms/implementations referenced in X03, not transcribed)",
      hardware: "unknown",
      seed: "unknown",
      data: "X03 published results; dataset not downloaded",
      parameters: "verification range up to 4×10^18",
      precision: "unknown",
    },
    trust_boundary: "Results as reported by the X03 authors; not reproduced in this sprint.",
  }),
  context("CD0", "ZFC", { profile: "custom", foundations: "ZFC (classical first-order logic)" }),
  context("CDPLUS", "ZFC + CH", {
    profile: "custom",
    foundations: "ZFC (classical first-order logic)",
    parent: r("CD0"),
    assumptions: [{ id: "CH", expr: "2^ℵ₀ = ℵ₁", scope: "global" }],
  }),
  context("CDMINUS", "ZFC + ¬CH", {
    profile: "custom",
    foundations: "ZFC (classical first-order logic)",
    parent: r("CD0"),
    assumptions: [{ id: "notCH", expr: "2^ℵ₀ ≠ ℵ₁", scope: "global" }],
  }),
  context("CM", "Metacontext for consistency claims", {
    conventions:
      "Metamathematical context: Con(T) means the theory T derives no contradiction. Separates truth-in-model, derivability-in-theory, axiom assumption and consistency claims; consistency is never inferred from absence of a recorded contradiction.",
  }),
  context("E06", "Isabelle2021 HOL, theory Sqrt", {
    profile: "formal",
    foundations: "Isabelle/HOL (higher-order logic), Isabelle2021",
    conventions: "Theory Sqrt with direct imports fixed to the Isabelle2021 edition; the full kernel-dependency closure is not extracted.",
    execution: { kernel: "Isabelle2021 HOL", libraries: "Complex_Main; HOL-Computational_Algebra.Primes" },
    trust_boundary: "Isabelle2021 kernel as distributed; checks reported by the distribution, not replayed here; kernel dependencies not extracted.",
  }),
];

const A_ROWS: FixItem[] = [
  obj("A01", "Space X with basepoints x₀, x₁ and path contract", "CTOP", "A topological space X, points x₀, x₁ ∈ X and paths [0,1]→X with fixed endpoints; bound parameters, not global names.", {
    profile: "D",
    src: [["X01", "§1.1"]],
  }, [
    { name: "X", binder: "free", domain: "topological spaces" },
    { name: "x₀", binder: "free", domain: "X" },
    { name: "x₁", binder: "free", domain: "X" },
  ]),
  obj("S_PI1_X0", "π₁(X,x₀)", "CTOP", "The fundamental group π₁(X,x₀): homotopy classes of loops at x₀ with concatenation.", { profile: "D", src: [["X01", "§1.1"]], u: ["A01"] }),
  obj("S_PI1_X1", "π₁(X,x₁)", "CTOP", "The fundamental group π₁(X,x₁): homotopy classes of loops at x₁ with concatenation.", { profile: "D", src: [["X01", "§1.1"]], u: ["A01"] }),
  make(
    "collection",
    "A02",
    "A02: Fundamental groups π₁(X,x₀) and π₁(X,x₁)",
    "CTOP",
    {
      purpose: "collection",
      description: "π₁(X,x₀) and π₁(X,x₁), representation of loops and their product. Equality of the two groups is not assumed.",
      manifest: [
        { slot: "g0", ref: r("S_PI1_X0"), relation: "has_part", order: 1 },
        { slot: "g1", ref: r("S_PI1_X1"), relation: "has_part", order: 2 },
      ],
    },
    { src: [["X01", "§1.1"]] },
  ),
  defn(
    "A03",
    "Choice of a path h and the induced map β_h",
    "CTOP",
    "Choose a path h with h(0) = x₀ and h(1) = x₁ (endpoints certified by this declaration); β_h: π₁(X,x₁)→π₁(X,x₀), [f]↦[h·f·h̄]. Another choice h′ is another witness.",
    { profile: "D", src: [["X01", "§1.1, before Proposition 1.5"]], u: ["A01"] },
    { variables: [{ name: "h", binder: "free", domain: "paths from x₀ to x₁" }] },
  ),
  rel(
    "A04",
    "β_h: π₁(X,x₁) ≅ π₁(X,x₀)",
    "CTOP",
    "isomorphic_to",
    [
      sl("src", "side", "S_PI1_X1", { order: 1, note: "source (domain of β_h)" }),
      sl("tgt", "side", "S_PI1_X0", { order: 2, note: "target (codomain of β_h)" }),
      sl("w", "witness", "A03", { note: "β_h with inverse β_h̄ = β_h⁻¹" }),
    ],
    {
      modality: "logical",
      interpretation: "β_h is an isomorphism π₁(X,x₁)→π₁(X,x₀) with inverse β_h̄; the isomorphism depends on the chosen h and is not a canonical identification.",
      scope: "CTOP; for the path h of A03",
    },
    { profile: "R", src: [["X01", "Proposition 1.5"]] },
  ),
  prop(
    "A05",
    "Change of basepoint commutes with induced maps",
    "CTOP",
    "For a continuous map g: X→Y, the change-of-basepoint square commutes: g_*∘β_h = β_{g∘h}∘g_*.",
    ["proposition"],
    {
      profile: "T",
      src: [["X01", "§1.1 (change of basepoint); square reconstructed elementarily in the handoff"]],
      attribution: "Handoff author (elementary reconstruction by path concatenation; cf. X01 §1.1)",
      u: ["A03"],
      representations: [
        { id: "text", modality: "text", content: "For continuous g: X→Y and a path h from x₀ to x₁: g_* ∘ β_h = β_{g∘h} ∘ g_* as maps π₁(X,x₁) → π₁(Y,g(x₀)).", meaning_role: "statement" },
        {
          id: "diag",
          modality: "diagram",
          content: "commuting square",
          meaning_role: "drawing",
          diagram: {
            vertices: [
              { id: "v1", label: "π₁(X,x₁)" },
              { id: "v2", label: "π₁(X,x₀)" },
              { id: "v3", label: "π₁(Y,g(x₁))" },
              { id: "v4", label: "π₁(Y,g(x₀))" },
            ],
            arrows: [
              { id: "a1", from: "v1", to: "v2", label: "β_h" },
              { id: "a2", from: "v1", to: "v3", label: "g_* (at x₁)" },
              { id: "a3", from: "v2", to: "v4", label: "g_* (at x₀)" },
              { id: "a4", from: "v3", to: "v4", label: "β_{g∘h}" },
            ],
            faces: [{ id: "F1", arrows: ["a1", "a3", "a2", "a4"] }],
            equations: ["g_*∘β_h = β_{g∘h}∘g_*"],
          },
        },
      ],
    },
    { variables: [{ name: "g", binder: "forall", domain: "continuous maps X→Y" }, { name: "h", binder: "free", domain: "paths from x₀ to x₁" }] },
  ),
  prop(
    "S_A06_EQ",
    "β_{h′} = conj([h′·h̄]) ∘ β_h",
    "CTOP",
    "For paths h, h′ from x₀ to x₁: β_{h′} = c_{[h′·h̄]} ∘ β_h, where c_γ(u) = γ·u·γ⁻¹ is conjugation in π₁(X,x₀). Not an automatic equality of maps.",
    ["proposition"],
    { u: ["A03"] },
    { variables: [{ name: "h", binder: "forall" }, { name: "h′", binder: "forall" }] },
  ),
  rel(
    "A06",
    "Two path choices differ by conjugation",
    "CTOP",
    "entails",
    [sl("p1", "premise", "A04"), sl("h1", "condition", "A03"), sl("c1", "conclusion", "S_A06_EQ")],
    {
      modality: "logical",
      interpretation: "From A04 by cancellation of paths: [h′·f·h̄′] = [h′·h̄]·[h·f·h̄]·[h′·h̄]⁻¹, so β_{h′} = conj([h′·h̄])∘β_h in π₁(X,x₀).",
      scope: "CTOP",
    },
    { profile: "R", src: [["X01", "Proposition 1.5"]], attribution: "Handoff author (elementary derivation; cf. X01 Proposition 1.5)" },
  ),
];

const FTC2 = (hyp: string) =>
  `If F: [a,b]→ℝ is ${hyp}, then F′ exists almost everywhere, F′ is Lebesgue integrable on [a,b], and F(x) = F(a) + ∫_a^x F′ for EVERY x ∈ [a,b].`;
const FTC_VARS = [{ name: "F", binder: "forall", domain: "functions [a,b]→ℝ" }, { name: "x", binder: "forall", domain: "[a,b]" }];

const B_ROWS: FixItem[] = [
  prop("B01", "Second fundamental theorem of calculus (Lebesgue)", "CB", FTC2("absolutely continuous"), ["theorem"], {
    profile: "T",
    src: [["X02", "second FTC / Theorem 89"]],
  }, { variables: FTC_VARS, assumptions: [{ id: "AC", expr: "F is absolutely continuous on [a,b]", variables: ["F"] }] }),
  prop(
    "B02",
    "Cantor function",
    "CB",
    "The Cantor function on [0,1] is continuous and non-constant, yet its derivative is 0 almost everywhere.",
    ["example"],
    { profile: "T", src: [["X02", "examples of singular functions"]] },
  ),
  prop("B03", "Wrong revision fixture: FTC for merely continuous F", "CB", FTC2("continuous"), ["theorem"], {
    label: SYN,
    refs: [{ key: "B01", purpose: "background", role: "statement" }],
  }, { variables: FTC_VARS, assumptions: [{ id: "C", expr: "F is continuous on [a,b]", variables: ["F"] }] }),
  rel(
    "R_B02_CHALLENGES_B03",
    "Cantor function challenges the substitution AC → continuous",
    "CB",
    "challenges",
    [sl("e1", "evidence", "B02"), sl("t1", "target", "B03")],
    {
      modality: "logical",
      interpretation: "The Cantor function questions replacing 'absolutely continuous' by 'continuous'; it does not challenge or refute B01.",
      scope: "the substitution 'absolutely continuous' → 'continuous'",
    },
    { label: SYN, src: [["X02", "singular functions"]] },
  ),
  rel(
    "R_B02_REFUTES_B03",
    "Cantor function refutes B03",
    "CB",
    "refutes",
    [sl("e1", "evidence", "B02"), sl("t1", "target", "B03")],
    {
      modality: "logical",
      interpretation: "With F the Cantor function: F continuous, F′ = 0 a.e., but F(1) = 1 ≠ 0 = F(0) + ∫_0^1 F′.",
      scope: "exact context CB (with [a,b] = [0,1])",
      fields: { negated: "B03: F(x) = F(a) + ∫_a^x F′ for every continuous F" },
    },
    { label: SYN, src: [["X02", "singular functions"]] },
  ),
  evaluation(
    "B03#logical",
    "Logical status of B03: refuted",
    "CB",
    {
      eval_kind: "assessment",
      subject: r("B03"),
      dimension: "logical",
      value: "refuted",
      scope: "exact context CB",
      evidence: [r("B02"), r("R_B02_REFUTES_B03")],
      assessor: { descriptor: "Handoff author (scenario)" },
    },
    { label: SYN },
  ),
  prop(
    "B05",
    "Lipschitz functions are differentiable a.e.",
    "CB",
    "If f: [a,b]→ℝ is L-Lipschitz, then f is differentiable at almost every x ∈ [a,b] and |f′(x)| ≤ L wherever f′(x) exists.",
    ["theorem"],
    { profile: "T", src: [["X02", "differentiation theorems (Lipschitz case)"]] },
    {
      variables: [
        { name: "L", binder: "free", domain: "L ≥ 0 (parameter, not an editorial badge)" },
        { name: "f", binder: "forall", domain: "L-Lipschitz functions [a,b]→ℝ" },
        { name: "x", binder: "ae", domain: "[a,b]" },
      ],
    },
  ),
  prop(
    "S_B05_EVERYWHERE",
    "'Everywhere' variant of B05",
    "CB",
    "If f: [a,b]→ℝ is L-Lipschitz, then f is differentiable at EVERY x ∈ [a,b] with |f′(x)| ≤ L.",
    ["conjecture"],
    { label: SYN, refs: [{ key: "B05", purpose: "background", role: "statement" }] },
    { variables: [{ name: "L", binder: "free" }, { name: "f", binder: "forall" }, { name: "x", binder: "forall", domain: "[a,b]" }] },
  ),
  argu(
    "B06",
    "Counterexample f(x) = |x| on [−1,1]",
    "CB",
    {
      targets: [r("S_B05_EVERYWHERE")],
      argument_kind: "counterexample",
      completeness: "complete",
      summary: "f(x) = |x| on [−1,1] is 1-Lipschitz but not differentiable at 0: the left derivative is −1 and the right derivative is +1.",
      steps: [
        { id: "s1", text: "| |x| − |y| | ≤ |x − y|, so f is 1-Lipschitz (L = 1)." },
        { id: "s2", text: "At 0 the one-sided derivatives are −1 and +1, so f′(0) does not exist." },
      ],
    },
    { attribution: "Handoff author (elementary counterexample)" },
  ),
  rel(
    "R_B06_REFUTES",
    "B06 refutes the 'everywhere' variant of B05",
    "CB",
    "refutes",
    [sl("e1", "evidence", "B06"), sl("t1", "target", "S_B05_EVERYWHERE")],
    {
      modality: "logical",
      interpretation: "|x| on [−1,1] refutes everywhere-differentiability of Lipschitz functions; B05 (a.e.) is untouched.",
      scope: "the 'everywhere' variant only",
      fields: { negated: "differentiability at every point of [a,b] for L-Lipschitz f" },
    },
    { attribution: "Handoff author (elementary counterexample)" },
  ),
  obj(
    "B07",
    "Family g_a = indicator of {a}",
    "CB",
    "g_a: [0,1]→ℝ, g_a(x) = 1 if x = a and 0 otherwise, for a, x ∈ [0,1]. Each g_a is 0 a.e. (∀a, a.e. x), but there is no common null set outside which all g_a vanish (a.e. x, ∀a fails).",
    { attribution: "Handoff author (elementary example)" },
    [
      { name: "a", domain: "[0,1]", binder: "forall" },
      { name: "x", domain: "[0,1]", binder: "ae" },
    ],
  ),
  prop("S_B07_EACH_AE", "∀a, a.e. x: g_a(x) = 0", "CB", "For every a ∈ [0,1], g_a(x) = 0 for almost every x ∈ [0,1].", ["proposition"], { u: ["B07"] }, {
    variables: [
      { name: "a", domain: "[0,1]", binder: "forall" },
      { name: "x", domain: "[0,1]", binder: "ae" },
    ],
  }),
  prop(
    "S_B07_NO_COMMON",
    "Not (a.e. x, ∀a: g_a(x) = 0)",
    "CB",
    "It is not the case that for almost every x ∈ [0,1], g_a(x) = 0 for all a ∈ [0,1]: there is no common null set outside which every g_a vanishes.",
    ["proposition"],
    { u: ["B07"] },
    {
      variables: [
        { name: "x", domain: "[0,1]", binder: "ae" },
        { name: "a", domain: "[0,1]", binder: "forall" },
      ],
    },
  ),
  argu(
    "S_B07_ARG",
    "Quantifier order for g_a (choose a = x)",
    "CB",
    {
      targets: [r("S_B07_EACH_AE"), r("S_B07_NO_COMMON")],
      completeness: "complete",
      summary: "{x : g_a(x) ≠ 0} = {a} is null for each a; but for every x, choosing a = x gives g_x(x) = 1, so the set where some g_a is non-zero is all of [0,1].",
      steps: [
        { id: "s1", text: "For fixed a, g_a ≠ 0 only on {a}, a null set.", uses: [r("B07")] },
        { id: "s2", text: "For any x, take a = x: g_x(x) = 1, so no x outside a null set has g_a(x) = 0 for all a.", uses: [r("B07")] },
      ],
    },
    { attribution: "Handoff author (elementary argument)" },
  ),
];

const C_ROWS: FixItem[] = [
  prop("C01", "Goldbach conjecture", "CNT", "Every even integer n ≥ 4 is the sum of two primes.", ["conjecture"], {
    profile: "H",
    src: [["X03", "context of the verification"]],
    attribution: "Goldbach (historical conjecture)",
  }, { variables: [{ name: "n", binder: "forall", domain: "even integers ≥ 4" }] }),
  prop(
    "C02",
    "Goldbach verified up to 4×10^18",
    "CNT",
    "Every even integer n with 4 ≤ n ≤ 4×10^18 is the sum of two primes (finite statement).",
    ["theorem"],
    { profile: "T", src: [["X03", "paper record and computation site"]] },
    { variables: [{ name: "n", binder: "forall", domain: "even integers, 4 ≤ n ≤ 4×10^18" }] },
  ),
  argu(
    "S_C02_COMPUTATION",
    "Computation behind C02",
    "CEXEC_C",
    {
      targets: [r("C02")],
      argument_kind: "computation",
      completeness: "source_reported",
      summary: "Computer verification reported by X03; supports the finite statement C02 only.",
      protocol: {
        description: "Computation, algorithms/implementations and controls as referred to by the X03 paper and author-maintained site (not transcribed).",
        range: "even n with 4 ≤ n ≤ 4×10^18 (up to 4×10^18)",
        artifacts: "dataset not downloaded or verified; no checksum, seed or hardware recorded here",
      },
    },
    { profile: "P", src: [["X03", "paper and computation site"]] },
  ),
  evaluation(
    "C02#reproducibility",
    "Reproducibility of C02: reproduction reported by source",
    "CEXEC_C",
    {
      eval_kind: "assessment",
      subject: r("C02"),
      dimension: "reproducibility",
      value: "reproduction_reported",
      scope: "as reported by X03; not independently reproduced in this sprint",
      assessor: { descriptor: "Oliveira e Silva, Herzog, Pardi — via X03 (transcribed)" },
    },
    { src: [["X03", "computation site"]] },
  ),
  research(
    "C03",
    "Goldbach verification experiment/protocol",
    "CEXEC_C",
    {
      role: "experiment",
      goal: "Record the calculation, range, algorithms/implementations and controls referred to by the X03 paper/site.",
      target: r("C02"),
      attempt: {
        strategy: "Large-scale computer verification of the even Goldbach statement up to 4×10^18, as described by X03.",
        protocol: "calculation, range, algorithms/implementations and controls as referred to in the X03 paper/site (not transcribed)",
        outputs: [r("C02")],
        result: "succeeded",
        observed: "Verification reported complete up to 4×10^18 (per X03).",
        artifacts_missing_reason: "Artifacts partial: no checksum, seed or hardware recorded here (none invented).",
      },
    },
    { src: [["X03", "paper and computation site"]] },
  ),
  source("C04", "OEIS A002372 snapshot descriptor", {
    source_kind: "dataset",
    citation: "OEIS A002372: number of ordered decompositions of 2n into two odd primes (external dataset snapshot descriptor).",
    authors: ["OEIS Foundation and contributors"],
    attribution: "OEIS Foundation and contributors",
    url: "https://oeis.org/A002372",
    retrieved_at: "2026-10-01",
    locator: "definition, offset, examples",
    unknown: "Stable source identity, but no exact native OEIS revision captured; retrieval dated 2026-10-01.",
  }),
  rel(
    "C05",
    "Finite verification C02 supports the Goldbach conjecture C01",
    "CNT",
    "supports",
    [sl("e1", "evidence", "C02"), sl("t1", "target", "C01")],
    {
      modality: "evidential",
      interpretation: "The finite verification supports (never proves) the unbounded conjecture. C03 produces C02 (recorded as the experiment's output).",
      quantitative_scope: "finite: even n ≤ 4×10^18",
      scope: "finite range only",
    },
    { profile: "R", src: [["X03", "verification range"]] },
  ),
  evaluation(
    "C01#evidence",
    "Evidence for C01: computation",
    "CNT",
    {
      eval_kind: "assessment",
      subject: r("C01"),
      dimension: "evidence",
      value: "computation",
      scope: "finite verification up to 4×10^18; no universal proof imported",
      evidence: [r("C02"), r("C05")],
      assessor: { descriptor: "Handoff transcription assistant (AI)" },
    },
    { src: [["X03", "verification range"]] },
  ),
  prop(
    "C06",
    "Goldbach decompositions and A002372 indexing",
    "CNT",
    "6 = 3+3 and 8 = 3+5 = 5+3. A002372 is indexed by n (it counts decompositions of 2n) and counts ordered pairs of odd primes; A002372(2) = 0 does not contradict 4 = 2+2, because the sequence excludes the prime 2.",
    ["example"],
    { profile: "T", src: [["X04", "definition, offset, examples"], ["C04", "snapshot descriptor"]] },
  ),
];

const D_ROWS: FixItem[] = [
  prop("D01", "Continuum hypothesis", "CD0", "CH: 2^ℵ₀ = ℵ₁.", ["hypothesis"], { src: [["X05", "statement (modern notation)"], ["X06", "statement"]], attribution: "Cantor's continuum hypothesis (as stated in X05/X06)" }),
  prop("S_CON_ZFC", "Con(ZFC)", "CM", "Con(ZFC): ZFC does not derive a contradiction.", ["hypothesis"], { src: [["X05", "metamathematical hypothesis"]] }, { usage: "hypothesis" }),
  prop(
    "D02",
    "Con(ZFC) ⇒ Con(ZFC + CH)",
    "CM",
    "If ZFC is consistent, then ZFC + CH is consistent (modern restatement of Gödel's relative consistency result).",
    ["theorem"],
    { profile: "T", statement_only: true, src: [["X05", "PNAS 1938/1939, restated in modern notation"]], u: ["D01"] },
    { assumptions: [{ id: "ConZFC", expr: "Con(ZFC)" }] },
  ),
  meth("S_FORCING", "Forcing", "CD0", "Cohen's forcing method for building models of ZFC + ¬CH (method entity of its own).", { profile: "M", src: [["X06", "method"]] }),
  prop(
    "D03",
    "Con(ZFC) ⇒ Con(ZFC + ¬CH)",
    "CM",
    "If ZFC is consistent, then ZFC + ¬CH is consistent (modern restatement of Cohen's result).",
    ["theorem"],
    { profile: "T", statement_only: true, src: [["X06", "PNAS 1963/1964, restated in modern notation"]], u: ["D01"], refs: [{ key: "S_FORCING", purpose: "background", role: "rule" }] },
    { assumptions: [{ id: "ConZFC", expr: "Con(ZFC)" }] },
  ),
  rel(
    "R_D02_DERIVED_FROM_X05",
    "D02 derived from Gödel (X05)",
    "CM",
    "derived_from",
    [sl("n", "new", "D02"), sl("o", "old", "X05")],
    {
      modality: "historical",
      interpretation: "D02 restates in modern notation a consequence of Gödel's 1938–39 consistency work.",
      fields: { context_map: "Gödel's historical system and notation ↦ modern ZFC with Con(·); fidelity beyond 'claimed' requires an assessment." },
    },
    { src: [["X05", "original publications"]] },
  ),
  rel(
    "R_D03_DERIVED_FROM_X06",
    "D03 derived from Cohen (X06)",
    "CM",
    "derived_from",
    [sl("n", "new", "D03"), sl("o", "old", "X06")],
    {
      modality: "historical",
      interpretation: "D03 restates in modern notation a consequence of Cohen's 1963–64 independence work.",
      fields: { context_map: "Cohen's papers ↦ modern ZFC with Con(·); fidelity beyond 'claimed' requires an assessment." },
    },
    { src: [["X06", "original publications"]] },
  ),
  prop(
    "S_CH_INDEP",
    "CH is independent of ZFC (if ZFC is consistent)",
    "CM",
    "ZFC proves neither CH nor ¬CH, provided ZFC is consistent. This does not prove Con(ZFC) and does not make CH false.",
    ["theorem"],
    { refs: [{ key: "D01", purpose: "background", role: "statement" }] },
  ),
  rel(
    "D04",
    "D02 ∧ D03 under Con(ZFC) ⇒ independence of CH",
    "CM",
    "entails",
    [sl("p1", "premise", "D02"), sl("p2", "premise", "D03"), sl("h1", "condition", "S_CON_ZFC"), sl("c1", "conclusion", "S_CH_INDEP")],
    {
      modality: "logical",
      interpretation: "(Con(ZFC) ⇒ Con(ZFC+CH)) ∧ (Con(ZFC) ⇒ Con(ZFC+¬CH)), under Con(ZFC), entail that ZFC decides neither CH nor ¬CH. D01's text is unchanged; independence is not falsity.",
      grouping: { premise: { op: "AND", items: ["p1", "p2"] } },
      scope: "metacontext CM",
    },
    { profile: "R", src: [["X05", "relative consistency"], ["X06", "relative consistency"]], attribution: "Gödel; Cohen (modern consequence)" },
  ),
  evaluation(
    "D01#logical",
    "Logical status of CH in ZFC: relative independence",
    "CD0",
    {
      eval_kind: "assessment",
      subject: r("D01"),
      dimension: "logical",
      value: "relative_independence",
      scope: "relative to Con(ZFC), stated in metacontext CM; no truth value is assigned without a context",
      evidence: [r("D02"), r("D03"), r("D04")],
      assessor: { descriptor: "Gödel; Cohen — via X05, X06 (transcribed)" },
    },
    { src: [["X05", "relative consistency"], ["X06", "relative consistency"]] },
  ),
  prop("S_D05_PLUS", "CH assumed (ZFC + CH)", "CDPLUS", "CH holds: 2^ℵ₀ = ℵ₁ (by the assumption of context ZFC + CH).", ["axiom"], {
    refs: [{ key: "D01", purpose: "background", role: "statement" }],
  }, { usage: "axiom" }),
  prop("S_D05_MINUS", "CH negated (ZFC + ¬CH)", "CDMINUS", "¬CH holds: 2^ℵ₀ ≠ ℵ₁ (by the assumption of context ZFC + ¬CH).", ["axiom"], {
    refs: [{ key: "D01", purpose: "background", role: "statement" }],
  }, { usage: "axiom" }),
  make(
    "collection",
    "D05",
    "D05: Two contextualizations of CH",
    "CD0",
    {
      purpose: "collection",
      description: "D01 contextualized twice: assumed in ZFC + CH and negated in ZFC + ¬CH. Each imports CD0 with its exact assumption; the contexts are not merged.",
      manifest: [
        { slot: "plus", ref: r("S_D05_PLUS"), relation: "has_part", order: 1 },
        { slot: "minus", ref: r("S_D05_MINUS"), relation: "has_part", order: 2 },
      ],
    },
  ),
];

const E_ROWS: FixItem[] = [
  prop(
    "E01",
    "Square roots of primes are irrational",
    "CNT",
    "The positive real square root of every prime natural number is irrational.",
    ["theorem"],
    {
      profile: "T",
      src: [["X07", "human reading of sqrt_prime_irrational"]],
      representations: [{ id: "nl", modality: "text", content: "For every prime p ∈ ℕ, √p ∉ ℚ (√p the positive real square root).", meaning_role: "statement" }],
    },
  ),
  prop(
    "E02",
    "sqrt_prime_irrational (Isabelle2021 formal statement)",
    "E06",
    "For p of type nat with prime p: sqrt (real p) ∉ ℚ, with sqrt and ℚ interpreted in HOL.",
    ["theorem"],
    // Profile F (no generated defaults): E02's fidelity is explicitly not_evaluated (E07), so the
    // T-profile defaults are written out below with that one change.
    { profile: "F", src: [["X07", "HOL/ex/Sqrt.thy, theorem sqrt_prime_irrational"]] },
    {
      formal: {
        system: "Isabelle/HOL",
        text: "theorem sqrt_prime_irrational: assumes prime (p::nat) shows sqrt (real p) ∉ ℚ",
        identifiers: ["sqrt_prime_irrational"],
      },
    },
  ),
  evaluation(
    "E02#logical",
    "Logical status of E02 (supported_derivation, per X07)",
    "E06",
    {
      eval_kind: "assessment",
      subject: r("E02"),
      dimension: "logical",
      value: "supported_derivation",
      scope: "as reported by the cited source (Isabelle2021 distribution); not replayed in this transcription",
      assessor: { descriptor: "Wenzel, Nipkow — via X07 (transcribed)" },
    },
    { src: [["X07", "HOL/ex/Sqrt.thy"]] },
  ),
  evaluation(
    "E02#fidelity",
    "Fidelity of E02 to E01: not evaluated",
    "E06",
    {
      eval_kind: "assessment",
      subject: r("E02"),
      dimension: "fidelity",
      value: "not_evaluated",
      scope: "correspondence of root, real type, primality and coercions to E01; no independent reviewer yet (E07)",
      assessor: { descriptor: "Handoff transcription assistant (AI)" },
    },
    { src: [["X07", "HOL/ex/Sqrt.thy"]] },
  ),
  evaluation(
    "E02#novelty",
    "Novelty of E02",
    "E06",
    {
      eval_kind: "assessment",
      subject: r("E02"),
      dimension: "novelty",
      value: "prior_art_found",
      scope: "this sample: content is prior library material, no new discovery claimed",
      assessor: { descriptor: "Handoff transcription assistant (AI)" },
    },
    { src: [["X07", "HOL/ex/Sqrt.thy"]] },
  ),
  rel(
    "R_E02_FORMALIZES_E01",
    "E02 formalizes E01",
    "E06",
    "formalizes",
    [sl("f", "formal", "E02"), sl("m", "meaning", "E01")],
    {
      modality: "formal_mapping",
      interpretation: "The Isabelle statement E02 formalizes the human statement E01; fidelity is not certified by this relation.",
      fields: {
        context_map: "p::nat ↦ natural number p; prime ↦ primality of naturals (HOL-Computational_Algebra.Primes); sqrt (real p) ↦ positive real square root via the coercion nat→real; ℚ ↦ HOL set of rationals.",
      },
    },
    { src: [["X07", "Sqrt.thy"]] },
  ),
  argu(
    "E03",
    "Main structured proof of sqrt_prime_irrational",
    "E06",
    {
      targets: [r("E02")],
      argument_kind: "formal_proof",
      completeness: "complete",
      summary: "Structured proof: non-zero denominator/coprimality and divisibility.",
      formal: { system: "Isabelle/HOL", environment: r("E06"), identifiers: ["sqrt_prime_irrational"], kernel_dependencies: "not_extracted" },
    },
    { profile: "P", src: [["X07", "HOL/ex/Sqrt.thy, main proof of sqrt_prime_irrational"]] },
  ),
  evaluation(
    "E03#formalization",
    "Formalization status of E03: check pass reported",
    "E06",
    {
      eval_kind: "assessment",
      subject: r("E03"),
      dimension: "formalization",
      value: "check_pass_reported",
      scope: "Isabelle2021 distribution; not check_pass_reproduced here",
      assessor: { descriptor: "Isabelle2021 distribution (reported, not replayed here)" },
    },
    { src: [["X07", "Isabelle2021 distribution"]] },
  ),
  prop(
    "E04",
    "Corollary: √2 ∉ ℚ",
    "E06",
    "sqrt 2 ∉ ℚ (corollary of E02 by specialization p = 2).",
    ["corollary"],
    { profile: "T", src: [["X07", "HOL/ex/Sqrt.thy, corollary after sqrt_prime_irrational"]] },
    { formal: { system: "Isabelle/HOL", text: "corollary: sqrt 2 ∉ ℚ", identifiers: [] } },
  ),
  argu(
    "S_E04_PROOF",
    "Proof of the corollary √2 ∉ ℚ",
    "E06",
    {
      targets: [r("E04")],
      argument_kind: "formal_proof",
      completeness: "complete",
      summary: "using sqrt_prime_irrational[of 2] (explicit source-local formal use of E02).",
      steps: [{ id: "s1", text: "using sqrt_prime_irrational[of 2]", uses: [r("E02")] }],
      formal: { system: "Isabelle/HOL", environment: r("E06"), identifiers: ["sqrt_prime_irrational"], kernel_dependencies: "not_extracted" },
    },
    {
      profile: "P",
      src: [["X07", "HOL/ex/Sqrt.thy, corollary proof"]],
      refs: [{ key: "E02", purpose: "formal", role: "statement", locator: "using sqrt_prime_irrational[of 2]" }],
    },
  ),
  rel(
    "R_E04_SPECIALIZES_E02",
    "E04 specializes E02 at p = 2",
    "E06",
    "specializes",
    [sl("s", "source", "E02"), sl("t", "target", "E04")],
    {
      modality: "logical",
      interpretation: "The corollary is the instance p := 2 of the general theorem; distinct statements, not identity by title.",
      fields: { instantiation: "p := 2" },
    },
    { src: [["X07", "Sqrt.thy"]] },
  ),
  argu(
    "E05",
    "Alternative proof by forward reasoning",
    "E06",
    {
      targets: [r("E02")],
      argument_kind: "formal_proof",
      completeness: "complete",
      summary:
        "Alternative proof of the same formal statement by mostly forward reasoning; anonymous theorem in the same theory, identified by its anchor in this theory revision. No novelty attributed to the importer.",
      formal: { system: "Isabelle/HOL", environment: r("E06"), identifiers: [], kernel_dependencies: "not_extracted" },
    },
    { profile: "P", src: [["X07", "HOL/ex/Sqrt.thy, alternative (unnamed) proof"]] },
  ),
  evaluation(
    "R_E02_FORMALIZES_E01#fidelity",
    "Fidelity of E02 w.r.t. E01: not evaluated",
    "E06",
    {
      eval_kind: "assessment",
      subject: r("R_E02_FORMALIZES_E01"),
      dimension: "fidelity",
      value: "not_evaluated",
      scope: "no independent fidelity review yet (E07); formal checks do not close it",
      assessor: { descriptor: "Handoff transcription assistant (AI)" },
    },
  ),
  research(
    "E07",
    "Fidelity review obligation for E02 ↔ E01",
    "E06",
    {
      role: "obligation",
      goal: "Review the correspondence of 'root', real type, primality and coercions between E02 and E01.",
      target: r("R_E02_FORMALIZES_E01"),
      closure_criterion: "An independent fidelity review (eval_kind review with a fidelity finding) of E02 against E01 covering root, real type, primality and nat→real coercion; formal checks alone do not close it.",
    },
  ),
];

export const CROSS_DOMAIN_FIXTURE: Fixture = {
  name: "Cross-domain stress tests (§30)",
  description:
    "Manual representation tests across topology (A), analysis (B), number theory/computation (C), foundations (D) and community formalization (E); sources X01–X07. Not independent verifications of the proofs.",
  items: finalize([...X_SOURCES, ...X_CONTEXTS, ...A_ROWS, ...B_ROWS, ...C_ROWS, ...D_ROWS, ...E_ROWS]),
  post: [
    {
      op: "revise",
      key: "B04",
      of: "B03",
      title: "B04: Correction of B03 — FTC with absolute continuity restored",
      payload: {
        statement: FTC2("absolutely continuous"),
        assumptions: [{ id: "AC", expr: "F is absolutely continuous on [a,b]", variables: ["F"] }],
      },
      change_summary: "Restores the hypothesis 'absolutely continuous' in place of 'continuous'; historical text of B03 is preserved.",
      corrects: { defect_locator: "hypothesis: 'continuous' must be 'absolutely continuous'", scope: "B03 wrong-revision fixture" },
      comparison: {
        changes: [
          { class: "strengthened_assumption", description: "continuous → absolutely continuous", status: "declared" },
          { class: "corrected_statement", description: "repairs the false statement refuted by B02", status: "declared" },
        ],
        verdict: "comparable",
        scope: "B03 r1 → B04",
      },
    },
  ],
};

export const FIXTURES: Fixture[] = [PVNP_FIXTURE, CROSS_DOMAIN_FIXTURE];
