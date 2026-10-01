// Guided authoring. Saving a draft needs only content and the inherited context; contract
// fields are asked for when they matter, and sealing validates everything with readable reasons.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, rpc } from "../api.ts";
import { Chip, ErrorBox, Field, KindBadge, Loading, RefPicker, Section, Select, fromRef, toRef, useAction, useRefTitles, useRpc, useSession, type PickedRef } from "../ui.tsx";

// ------------------------------------------------------------------ new item chooser

const TEMPLATES: { id: string; label: string; help: string; kind: string; payload: (q: URLSearchParams) => any; facets?: string[] }[] = [
  { id: "statement", label: "Statement / claim", help: "A theorem, conjecture, lemma or observation — with variables, assumptions and context.", kind: "declaration", payload: () => ({ category: "propositional", statement: "", editorial_roles: [], assumptions: [], variables: [] }) },
  { id: "definition", label: "Definition", help: "Introduces meaning; not a truth claim.", kind: "declaration", payload: () => ({ category: "definitional", statement: "", editorial_roles: ["definition"], assumptions: [], variables: [] }) },
  { id: "question", label: "Question / problem statement", help: "Interrogative content; answers are separate claims.", kind: "declaration", payload: () => ({ category: "interrogative", statement: "", answer_criterion: "", editorial_roles: ["question"] }) },
  { id: "object", label: "Object / construction", help: "A mathematical object or construction with parameters.", kind: "object", payload: () => ({ description: "", parameters: [] }) },
  { id: "method", label: "Method / technique", help: "A technique with regime and applicability.", kind: "method", payload: () => ({ description: "", parameters: [] }) },
  { id: "argument", label: "Proof / argument / evidence", help: "Its own entity with exact targets, steps, gaps and dependencies.", kind: "argument", payload: (q) => ({ targets: q.get("target") ? [{ rev: q.get("target") }] : [], argument_kind: "natural_language_proof", completeness: "partial", steps: [], gaps: [], dependency_sets: [] }) },
  { id: "relation", label: "Connection (relation)", help: "A first-class n-ary relation with contract, roles, conditions and scope.", kind: "relation", payload: (q) => relationTemplate(q) },
  { id: "objective", label: "Objective / problem", help: "What you want to answer, and what would count as an answer.", kind: "research", payload: (q) => ({ role: q.get("role") ?? "objective", goal: "", answer_criterion: "", closure_criterion: "" }) },
  { id: "obligation", label: "Obligation", help: "A local task tied to a target, with a closure criterion.", kind: "research", payload: () => ({ role: "obligation", goal: "", closure_criterion: "" }) },
  { id: "attempt", label: "Attempt / experiment", help: "Executed work on a target; failures require bounded conclusions.", kind: "research", payload: () => ({ role: "attempt", goal: "", attempt: { strategy: "", steps: [], outputs: [], result: "in_progress", artifacts: [] } }) },
  { id: "inquiry_line", label: "Inquiry line (private branch)", help: "A pinned selection to explore; not a Git branch.", kind: "research", payload: () => ({ role: "inquiry_line", goal: "", selection: [] }) },
  { id: "review", label: "Review / assessment", help: "Attributed, scoped evaluation of an exact revision.", kind: "evaluation", payload: (q) => ({ eval_kind: "review", subject: q.get("target") ? { rev: q.get("target") } : undefined, scope: "", findings: [], evidence: [] }) },
  { id: "narrative", label: "Narrative / notes / paper", help: "Prose with exact transclusions; readable without opening each entity.", kind: "collection", payload: () => ({ purpose: "narrative", narrative: [{ id: "b1", type: "prose", text: "" }], manifest: [] }), facets: ["collection", "narrative"] },
  { id: "context", label: "Context", help: "Foundations, assumptions, imports, notation, execution environment.", kind: "context", payload: () => ({ foundations: "", axioms: [], assumptions: [], imports: [], definitions: [], notation: [], resolutions: [] }) },
  { id: "source", label: "Literature source", help: "Bibliographic identity, edition, locator, rights and availability.", kind: "source", payload: () => ({ source_kind: "paper", citation: "", authors: [], rights: { status: "unknown" }, availability: "available", revision_identity: { status: "unknown", reason: "" } }) },
];

function relationTemplate(q: URLSearchParams) {
  const contract = q.get("contract") ?? "supports";
  const slots: any[] = [];
  if (q.get("target")) slots.push({ slot: "t1", role: "target", ref: { rev: q.get("target") } });
  if (q.get("participant")) slots.push({ slot: "s1", role: "", ref: { rev: q.get("participant") } });
  return { contract: { id: contract, version: "core@1" }, slots, grouping: {}, hypotheses: [], modality: contract === "refutes" ? "logical" : "logical", interpretation: "", fields: contract === "decomposes_into" ? { plan_mode: "OR" } : {}, assertion: "asserted" };
}

export function NewItem() {
  const { ws } = useParams();
  const [q] = useSearchParams();
  const nav = useNavigate();
  const { data: wsData } = useRpc("workspace", { workspace_id: ws });
  const [title, setTitle] = useState("");
  const [access, setAccess] = useState("team");
  const initial = q.get("kind") === "research" ? (q.get("role") === "obligation" ? "obligation" : q.get("role") === "attempt" ? "attempt" : q.get("role") === "inquiry_line" ? "inquiry_line" : "objective") : TEMPLATES.find((t) => t.kind === q.get("kind"))?.id;
  const [tpl, setTpl] = useState<string | undefined>(initial);
  const act = useAction();
  const t = TEMPLATES.find((x) => x.id === tpl);
  const create = () =>
    act.run(async () => {
      if (!t || !wsData) return;
      const r = await rpc("createEntity", {
        workspace_id: ws,
        kind: t.kind,
        title,
        facets: t.facets,
        access: { mode: access },
        content: { context: { rev: wsData.workspace.root_context_rev }, payload: t.payload(q) },
      });
      nav(`/draft/${r.draft_id}`);
    });
  return (
    <div className="page">
      <h1>Write something new</h1>
      <p className="hint">Saving needs only content; the workspace root context is inherited and shown. Detailed metadata is asked for when you seal or publish.</p>
      <div className="cards small-cards">
        {TEMPLATES.map((x) => (
          <button key={x.id} className={`card ${tpl === x.id ? "selected" : ""}`} onClick={() => setTpl(x.id)}>
            <KindBadge kind={x.kind} />
            <h4>{x.label}</h4>
            <p className="small">{x.help}</p>
          </button>
        ))}
      </div>
      {t && (
        <Section title={`New ${t.label.toLowerCase()}`}>
          <ErrorBox error={act.error} />
          <div className="row wrap">
            <Field label="Working title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </Field>
            <Field label="Visibility" hint="Private/team now; public only by publishing a sealed revision.">
              <select value={access} onChange={(e) => setAccess(e.target.value)}>
                <option value="team">Team (workspace members)</option>
                <option value="owner">Only me</option>
              </select>
            </Field>
            <button disabled={!title || act.busy} onClick={create}>
              Create draft
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editor

const DraftsCtx = createContext<{ drafts: any[]; ws?: string }>({ drafts: [] });

function Ref({ value, onChange, kinds, placeholder }: { value: any; onChange: (r: any) => void; kinds?: string[]; placeholder?: string }) {
  const { ws, drafts } = useContext(DraftsCtx);
  const titles = useRefTitles(value);
  if (value?.draft)
    return (
      <span className="picked">
        draft “{drafts.find((d) => d.id === value.draft)?.title ?? value.draft}” (joint snapshot)
        <button className="link" onClick={() => onChange(undefined)}>
          clear
        </button>
      </span>
    );
  return (
    <span className="refwrap">
      <RefPicker workspace={ws} value={fromRef(value, titles)} onChange={(p: PickedRef | null) => onChange(toRef(p))} kinds={kinds} placeholder={placeholder} />
      {drafts.length > 0 && !value && (
        <select className="small" value="" onChange={(e) => e.target.value && onChange({ draft: e.target.value })} title="Reference another open draft; both must be sealed together">
          <option value="">…or a draft</option>
          {drafts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

function ListEditor<T>({ items, onChange, render, make, addLabel }: { items: T[]; onChange: (v: T[]) => void; render: (item: T, set: (v: T) => void, i: number) => ReactNode; make: () => T; addLabel: string }) {
  return (
    <div className="listedit">
      {items.map((it, i) => (
        <div key={i} className="listrow">
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}
          <button className="link small" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            remove
          </button>
        </div>
      ))}
      <button className="small ghost" onClick={() => onChange([...items, make()])}>
        + {addLabel}
      </button>
    </div>
  );
}

const nextId = (prefix: string, items: any[], key = "id") => {
  let n = items.length + 1;
  while (items.some((x) => x[key] === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

export function DraftEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error, reload } = useRpc("draft", { draft_id: id });
  const [content, setContent] = useState<any>(null);
  const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [cohort, setCohort] = useState<string[]>([]);
  const [raw, setRaw] = useState(false);
  const [resolutions, setResolutions] = useState<any[] | null>(null);
  const act = useAction();
  const { data: drafts } = useRpc(data ? "myDrafts" : null, { workspace_id: data?.workspace_id }, [data?.workspace_id]);
  useEffect(() => {
    if (data) {
      setContent(data.content);
      setGeneration(data.generation);
      setDirty(false);
    }
  }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data || !content) return <Loading />;
  if (data.status !== "editing")
    return (
      <div className="page">
        <p>
          This draft is {data.status}. {data.sealed_rev && <Link to={`/r/${data.sealed_rev}`}>Open the sealed revision</Link>}
        </p>
      </div>
    );
  const set = (patch: any) => {
    setContent({ ...content, ...patch });
    setDirty(true);
  };
  const setP = (patch: any) => set({ payload: { ...content.payload, ...patch } });
  const save = async () => {
    try {
      const r = await rpc("saveDraft", { draft_id: id, content, generation });
      setGeneration(r.generation);
      setDirty(false);
      setConflict(null);
      return true;
    } catch (e) {
      if ((e as ApiError).code === "stale_draft") setConflict((e as ApiError).details);
      throw e;
    }
  };
  const otherDrafts = (drafts ?? []).filter((d: any) => d.id !== id);
  return (
    <DraftsCtx.Provider value={{ drafts: otherDrafts, ws: data.workspace_id }}>
      <div className="page draft">
        <div className="entity-head">
          <KindBadge kind={data.entity.kind} />
          <h1>
            Draft: <input className="titleinput" value={content.title ?? ""} onChange={(e) => set({ title: e.target.value })} />
          </h1>
        </div>
        <div className="small muted">
          Draft <code>{data.id}</code> of entity <Link to={`/e/${data.entity.id}`}>{data.entity.id}</Link> ({data.entity.namespace}) · author {data.author?.name} · generation {generation} · visibility {data.entity.access.mode}
          {data.base_revs.length > 0 && <> · based on {data.base_revs.map((r: string) => <Link key={r} to={`/r/${r}`}> {r}</Link>)}</>}
          {dirty && <strong> · unsaved changes</strong>}
        </div>
        <div className="banner">A draft is not a stable reference. Sealing creates an immutable revision; earlier revisions are never modified.</div>
        <ErrorBox error={act.error} />
        {conflict && (
          <div className="error">
            <strong>Someone else saved this draft meanwhile.</strong> Your text was not saved over theirs.
            <div className="row">
              <button onClick={() => act.run(async () => nav(`/draft/${(await rpc("saveAsAlternativeDraft", { draft_id: id, content })).draft_id}`))}>Save mine as an alternative draft</button>
              <button className="ghost" onClick={() => (setConflict(null), reload())}>
                Discard mine and load theirs
              </button>
            </div>
          </div>
        )}
        {resolutions && (
          <div className="notice">
            Live selectors resolved explicitly:
            <ul>
              {resolutions.map((r, i) => (
                <li key={i}>
                  {r.entity} ({r.selector}) → {r.rev ? <Link to={`/r/${r.rev}`}>{r.rev}</Link> : "unresolved"} — {r.basis}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="toolbar">
          <button disabled={act.busy} onClick={() => act.run(save)}>
            Save draft
          </button>
          <button
            className="ghost"
            onClick={() =>
              act.run(async () => {
                if (dirty) await save();
                const r = await rpc("resolveSelectors", { draft_id: id });
                setResolutions(r.resolutions);
                reload();
              })
            }
          >
            Resolve “latest” references
          </button>
          <button
            className="primary"
            disabled={act.busy}
            onClick={() =>
              act.run(async () => {
                if (dirty) await save();
                const r = await rpc("seal", { drafts: [id, ...cohort] });
                nav(`/r/${r.revisions[0]}`);
              })
            }
          >
            Seal{cohort.length ? ` jointly (${cohort.length + 1})` : ""}
          </button>
          <button className="ghost danger" onClick={() => confirm("Discard this draft? Sealed revisions are unaffected.") && act.run(async () => (await rpc("discardDraft", { draft_id: id }), nav(-1)))}>
            Discard
          </button>
          <label className="small">
            <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw content
          </label>
        </div>
        {otherDrafts.length > 0 && (
          <details className="small">
            <summary>Joint snapshot: seal together with other drafts ({cohort.length} selected)</summary>
            <p className="hint">Mutually referencing drafts are sealed atomically: all become citable revisions, or none does.</p>
            {otherDrafts.map((d: any) => (
              <label key={d.id} className="block">
                <input type="checkbox" checked={cohort.includes(d.id)} onChange={(e) => setCohort(e.target.checked ? [...cohort, d.id] : cohort.filter((x) => x !== d.id))} /> {d.title} ({d.kind})
              </label>
            ))}
          </details>
        )}
        {raw ? (
          <textarea
            className="raw"
            rows={30}
            defaultValue={JSON.stringify(content, null, 2)}
            onBlur={(e) => {
              try {
                setContent(JSON.parse(e.target.value));
                setDirty(true);
              } catch {
                alert("Invalid JSON; not applied.");
              }
            }}
          />
        ) : (
          <>
            <KindForm kind={data.entity.kind} p={content.payload ?? {}} setP={setP} />
            <CommonForm content={content} set={set} kind={data.entity.kind} />
          </>
        )}
      </div>
    </DraftsCtx.Provider>
  );
}

// ------------------------------------------------------------------ common metadata

function CommonForm({ content, set, kind }: { content: any; set: (p: any) => void; kind: string }) {
  const { vocab } = useSession();
  const prov = content.provenance ?? {};
  const setProv = (patch: any) => set({ provenance: { ...prov, ...patch } });
  return (
    <>
      <Section title="Context" hint="The exact context revision that fixes interpretation. Inherited by default; change only if this belongs to another context.">
        {content.context?.self ? <em>Self-describing root context</em> : <Ref value={content.context} onChange={(r) => set({ context: r })} kinds={["context"]} placeholder="Context revision" />}
      </Section>
      <Section title="References" hint="Typed references with exact revisions. Citations and influence never carry logical invalidity; inferred dependencies stay inferred.">
        <ListEditor
          items={content.references ?? []}
          onChange={(v) => set({ references: v })}
          make={() => ({ ref: undefined, purpose: "explicit_informal", origin: "explicit" })}
          addLabel="reference"
          render={(u: any, setU) => (
            <div className="row wrap">
              <Ref value={u.ref} onChange={(r) => setU({ ...u, ref: r })} />
              <Select value={u.purpose} options={[...(vocab?.dep_kinds ?? []), "evidence", "example", "background"]} onChange={(x) => setU({ ...u, purpose: x })} />
              <Select value={u.role} options={["statement", "proof", "definition", "rule", "environment"]} onChange={(x) => setU({ ...u, role: x || undefined })} allowEmpty="role…" />
              <Select value={u.origin} options={["explicit", "inferred", "formal"]} onChange={(x) => setU({ ...u, origin: x })} />
              <input placeholder="locator (step, §, line)" value={u.locator ?? ""} onChange={(e) => setU({ ...u, locator: e.target.value || undefined })} />
              {u.origin === "inferred" && <input placeholder="inference method & reason" value={u.inference?.reason ?? ""} onChange={(e) => setU({ ...u, inference: { method: "manual suggestion", reason: e.target.value } })} />}
            </div>
          )}
        />
      </Section>
      <Section title="Provenance & credit" hint="Who did what, from where. Importing someone's result does not make you its author.">
        <div className="row wrap">
          <Field label="Origin">
            <Select value={prov.origin} options={["human", "ai", "human_ai", "deterministic"]} onChange={(x) => setProv({ origin: x })} />
          </Field>
          <Field label="Acquisition">
            <Select value={prov.acquisition} options={["authorship", "import", "extraction", "inference", "formal_check", "computation", "editorial_transformation"]} onChange={(x) => setProv({ acquisition: x })} />
          </Field>
          <Field label="Original attribution (authors of the content)">
            <input value={prov.original_attribution ?? ""} onChange={(e) => setProv({ original_attribution: e.target.value || undefined })} />
          </Field>
          <Field label="Discovery claimed at (or 'unknown')">
            <input value={prov.dates?.discovery_claimed_at ?? ""} onChange={(e) => setProv({ dates: { ...prov.dates, discovery_claimed_at: e.target.value || undefined } })} />
          </Field>
        </div>
        <h4>Sources</h4>
        <ListEditor
          items={prov.sources ?? []}
          onChange={(v) => setProv({ sources: v })}
          make={() => ({ source: undefined, locator: "" })}
          addLabel="source"
          render={(s: any, setS) => (
            <div className="row">
              <Ref value={s.source} onChange={(r) => setS({ ...s, source: r })} kinds={["source"]} placeholder="Source record" />
              <input placeholder="locator (page, theorem, §)" value={s.locator} onChange={(e) => setS({ ...s, locator: e.target.value })} />
            </div>
          )}
        />
        <h4>Contributions</h4>
        <ListEditor
          items={content.contributions ?? []}
          onChange={(v) => set({ contributions: v })}
          make={() => ({ descriptor: "", roles: ["statement"], character: "claimed" })}
          addLabel="contribution"
          render={(c: any, setC) => (
            <div className="row wrap">
              <input placeholder="contributor (name or descriptor)" value={c.descriptor ?? ""} onChange={(e) => setC({ ...c, descriptor: e.target.value })} />
              <select multiple size={3} value={c.roles} onChange={(e) => setC({ ...c, roles: [...e.target.selectedOptions].map((o) => o.value) })}>
                {(vocab?.contribution_roles ?? []).map((r: string) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <Select value={c.character} options={["claimed", "acknowledged", "disputed"]} onChange={(x) => setC({ ...c, character: x })} />
            </div>
          )}
        />
        <Field label="Change summary (for this revision)">
          <input value={content.change_summary ?? ""} onChange={(e) => set({ change_summary: e.target.value })} />
        </Field>
      </Section>
      {kind !== "collection" && (
        <Section title="Additional representations" hint="LaTeX, formal text or computational artifacts of the same content. Two representations are not declared equivalent by sharing a container.">
          <ListEditor
            items={(content.representations ?? []).filter((r: any) => r.id !== "readable")}
            onChange={(v) => set({ representations: v })}
            make={() => ({ id: nextId("rep", content.representations ?? []), modality: "latex", content: "", meaning_role: "statement", bindings: [] })}
            addLabel="representation"
            render={(r: any, setR) => (
              <div className="row wrap">
                <Select value={r.modality} options={["text", "latex", "formal", "computational"]} onChange={(x) => setR({ ...r, modality: x })} />
                {r.modality === "formal" && <input placeholder="system (e.g. Lean 4, Isabelle/HOL)" value={r.system ?? ""} onChange={(e) => setR({ ...r, system: e.target.value })} />}
                <textarea rows={2} value={r.content} onChange={(e) => setR({ ...r, content: e.target.value })} />
              </div>
            )}
          />
        </Section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ kind-specific forms

function KindForm({ kind, p, setP }: { kind: string; p: any; setP: (patch: any) => void }) {
  const { vocab } = useSession();
  switch (kind) {
    case "declaration":
      return (
        <Section title="Statement">
          <Field label="Statement (prose or LaTeX; keep quantifiers, domains and assumptions explicit)">
            <textarea rows={4} value={p.statement ?? ""} onChange={(e) => setP({ statement: e.target.value })} />
          </Field>
          <div className="row wrap">
            <Field label="Semantic category">
              <Select value={p.category} options={["propositional", "definitional", "interrogative"]} onChange={(x) => setP({ category: x })} />
            </Field>
            <Field label="Editorial roles (attributions, not status)">
              <select multiple size={4} value={p.editorial_roles ?? []} onChange={(e) => setP({ editorial_roles: [...e.target.selectedOptions].map((o) => o.value) })}>
                {(vocab?.editorial_roles ?? []).map((r: string) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Usage">
              <Select value={p.usage} options={["axiom", "hypothesis"]} onChange={(x) => setP({ usage: x || undefined })} allowEmpty="—" />
            </Field>
          </div>
          {p.category === "interrogative" && (
            <Field label="What would count as an answer">
              <input value={p.answer_criterion ?? ""} onChange={(e) => setP({ answer_criterion: e.target.value })} />
            </Field>
          )}
          <h4>Variables and binders</h4>
          <ListEditor
            items={p.variables ?? []}
            onChange={(v) => setP({ variables: v })}
            make={() => ({ name: "", domain: "", binder: "forall" })}
            addLabel="variable"
            render={(v: any, setV) => (
              <div className="row">
                <Select value={v.binder} options={["forall", "exists", "ae", "free"]} onChange={(x) => setV({ ...v, binder: x })} />
                <input placeholder="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
                <input placeholder="domain" value={v.domain ?? ""} onChange={(e) => setV({ ...v, domain: e.target.value })} />
              </div>
            )}
          />
          <h4>Assumptions</h4>
          <ListEditor
            items={p.assumptions ?? []}
            onChange={(v) => setP({ assumptions: v })}
            make={() => ({ id: nextId("H", p.assumptions ?? []), expr: "", scope: "local", variables: [] })}
            addLabel="assumption"
            render={(a: any, setA) => (
              <div className="row">
                <code>{a.id}</code>
                <input placeholder="expression" value={a.expr} onChange={(e) => setA({ ...a, expr: e.target.value })} />
                <Select value={a.scope} options={["local", "global"]} onChange={(x) => setA({ ...a, scope: x })} />
                <input placeholder="discharge condition" value={a.discharge ?? ""} onChange={(e) => setA({ ...a, discharge: e.target.value || undefined })} />
              </div>
            )}
          />
          <details>
            <summary>Barrier contract (if this result restricts a family of techniques)</summary>
            <Field label="Applicability predicate">
              <input value={p.barrier?.predicate ?? ""} onChange={(e) => setP({ barrier: e.target.value ? { ...(p.barrier ?? { conditions: [], restricts: "" }), predicate: e.target.value } : undefined })} />
            </Field>
            <Field label="What it restricts">
              <input value={p.barrier?.restricts ?? ""} onChange={(e) => setP({ barrier: { ...(p.barrier ?? { conditions: [], predicate: "" }), restricts: e.target.value } })} />
            </Field>
          </details>
          <details>
            <summary>Formal statement</summary>
            <div className="row">
              <input placeholder="system" value={p.formal?.system ?? ""} onChange={(e) => setP({ formal: { ...(p.formal ?? { text: "", identifiers: [] }), system: e.target.value } })} />
              <textarea rows={2} placeholder="formal text" value={p.formal?.text ?? ""} onChange={(e) => setP({ formal: { ...(p.formal ?? { system: "", identifiers: [] }), text: e.target.value } })} />
            </div>
          </details>
        </Section>
      );
    case "object":
    case "method":
      return (
        <Section title={kind === "object" ? "Object" : "Method"}>
          <Field label="Description">
            <textarea rows={4} value={p.description ?? ""} onChange={(e) => setP({ description: e.target.value })} />
          </Field>
          {kind === "method" && (
            <div className="row">
              <Field label="Regime / parameters">
                <input value={p.regime ?? ""} onChange={(e) => setP({ regime: e.target.value })} />
              </Field>
              <Field label="Applicability">
                <input value={p.applicability ?? ""} onChange={(e) => setP({ applicability: e.target.value })} />
              </Field>
            </div>
          )}
        </Section>
      );
    case "argument":
      return <ArgumentForm p={p} setP={setP} />;
    case "relation":
      return <RelationForm p={p} setP={setP} />;
    case "research":
      return <ResearchForm p={p} setP={setP} />;
    case "evaluation":
      return <EvaluationForm p={p} setP={setP} />;
    case "collection":
      return <CollectionForm p={p} setP={setP} />;
    case "context":
      return <ContextForm p={p} setP={setP} />;
    case "source":
      return (
        <Section title="Source">
          <Field label="Citation">
            <input value={p.citation ?? ""} onChange={(e) => setP({ citation: e.target.value })} />
          </Field>
          <div className="row wrap">
            <Field label="Kind">
              <Select value={p.source_kind} options={["paper", "book", "preprint", "web", "dataset", "formal_library", "discussion", "thesis", "other"]} onChange={(x) => setP({ source_kind: x })} />
            </Field>
            <Field label="Authors (comma separated)">
              <input value={(p.authors ?? []).join(", ")} onChange={(e) => setP({ authors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Edition / version">
              <input value={p.edition ?? ""} onChange={(e) => setP({ edition: e.target.value })} />
            </Field>
            <Field label="URL">
              <input value={p.url ?? ""} onChange={(e) => setP({ url: e.target.value })} />
            </Field>
            <Field label="Consulted on">
              <input value={p.retrieved_at ?? ""} onChange={(e) => setP({ retrieved_at: e.target.value })} />
            </Field>
            <Field label="Availability">
              <Select value={p.availability} options={["available", "restricted", "unavailable", "unknown"]} onChange={(x) => setP({ availability: x })} />
            </Field>
            <Field label="Rights">
              <Select value={p.rights?.status} options={["known", "unknown"]} onChange={(x) => setP({ rights: { ...p.rights, status: x } })} />
            </Field>
            <Field label="Exact source edition identity?">
              <Select value={p.revision_identity?.status} options={["exact", "unknown"]} onChange={(x) => setP({ revision_identity: { ...p.revision_identity, status: x } })} />
            </Field>
            <Field label={p.revision_identity?.status === "exact" ? "Edition identifier" : "Why unknown"}>
              <input value={(p.revision_identity?.status === "exact" ? p.revision_identity?.value : p.revision_identity?.reason) ?? ""} onChange={(e) => setP({ revision_identity: { ...p.revision_identity, [p.revision_identity?.status === "exact" ? "value" : "reason"]: e.target.value } })} />
            </Field>
          </div>
        </Section>
      );
  }
  return null;
}

function ArgumentForm({ p, setP }: { p: any; setP: (x: any) => void }) {
  const { vocab } = useSession();
  return (
    <Section title="Argument" hint="Each proof is its own entity: invalidating it withdraws this support only, never refutes its target.">
      <h4>Targets (exact revisions it argues for)</h4>
      <ListEditor items={p.targets ?? []} onChange={(v) => setP({ targets: v })} make={() => undefined as any} addLabel="target" render={(t: any, setT) => <Ref value={t} onChange={setT} />} />
      <div className="row wrap">
        <Field label="Kind of evidence">
          <Select value={p.argument_kind} options={vocab?.argument_kinds ?? []} onChange={(x) => setP({ argument_kind: x })} />
        </Field>
        <Field label="Completeness claimed">
          <Select value={p.completeness} options={["complete", "partial", "sketch", "source_reported"]} onChange={(x) => setP({ completeness: x })} />
        </Field>
      </div>
      <Field label="Summary / prose">
        <textarea rows={3} value={p.summary ?? ""} onChange={(e) => setP({ summary: e.target.value })} />
      </Field>
      <h4>Steps (stable local ids; uses are exact references)</h4>
      <ListEditor
        items={p.steps ?? []}
        onChange={(v) => setP({ steps: v })}
        make={() => ({ id: nextId("s", p.steps ?? []), text: "", uses: [] })}
        addLabel="step"
        render={(s: any, setS) => (
          <div className="step-edit">
            <code>{s.id}</code>
            <textarea rows={2} value={s.text} onChange={(e) => setS({ ...s, text: e.target.value })} />
            <ListEditor items={s.uses ?? []} onChange={(v) => setS({ ...s, uses: v })} make={() => undefined as any} addLabel="use" render={(u: any, setU) => <Ref value={u} onChange={setU} />} />
          </div>
        )}
      />
      <h4>Gaps (become obligations)</h4>
      <ListEditor items={p.gaps ?? []} onChange={(v) => setP({ gaps: v })} make={() => ({ id: nextId("g", p.gaps ?? []), text: "" })} addLabel="gap" render={(g: any, setG) => <input value={g.text} onChange={(e) => setG({ ...g, text: e.target.value })} placeholder={g.id} />} />
      <details>
        <summary>Dependency sets (with scope; minimality only with method/certificate)</summary>
        <ListEditor
          items={p.dependency_sets ?? []}
          onChange={(v) => setP({ dependency_sets: v })}
          make={() => ({ id: nextId("D", p.dependency_sets ?? []), members: [], rules: [], scope: "this derivation only", minimality: "none_claimed", completeness: "declared_partial" })}
          addLabel="dependency set"
          render={(d: any, setD) => (
            <div>
              <code>{d.id}</code>
              <ListEditor items={d.members} onChange={(v) => setD({ ...d, members: v })} make={() => undefined as any} addLabel="member" render={(m: any, setM) => <Ref value={m} onChange={setM} />} />
              <div className="row wrap">
                <input placeholder="scope" value={d.scope} onChange={(e) => setD({ ...d, scope: e.target.value })} />
                <Select value={d.minimality} options={["none_claimed", "inclusion_minimal", "cardinal_minimum"]} onChange={(x) => setD({ ...d, minimality: x })} />
                <input placeholder="method" value={d.method ?? ""} onChange={(e) => setD({ ...d, method: e.target.value || undefined })} />
                <input placeholder="certificate" value={d.certificate ?? ""} onChange={(e) => setD({ ...d, certificate: e.target.value || undefined })} />
                <Select value={d.completeness} options={["exact_for_this_derivation", "declared_partial", "not_extracted"]} onChange={(x) => setD({ ...d, completeness: x })} />
              </div>
            </div>
          )}
        />
      </details>
      <details>
        <summary>Formal / computational details</summary>
        <div className="row wrap">
          <input placeholder="formal system" value={p.formal?.system ?? ""} onChange={(e) => setP({ formal: e.target.value ? { ...(p.formal ?? { identifiers: [], kernel_dependencies: "not_extracted" }), system: e.target.value } : undefined })} />
          {p.formal && <Ref value={p.formal.environment} onChange={(r) => setP({ formal: { ...p.formal, environment: r } })} kinds={["context"]} placeholder="execution environment (context)" />}
          <input placeholder="protocol description" value={p.protocol?.description ?? ""} onChange={(e) => setP({ protocol: e.target.value ? { ...(p.protocol ?? {}), description: e.target.value } : undefined })} />
          {p.protocol && <input placeholder="range" value={p.protocol.range ?? ""} onChange={(e) => setP({ protocol: { ...p.protocol, range: e.target.value } })} />}
        </div>
      </details>
    </Section>
  );
}

function RelationForm({ p, setP }: { p: any; setP: (x: any) => void }) {
  const { vocab } = useSession();
  const contracts = vocab?.contracts ?? [];
  const contract = contracts.find((c: any) => c.id === p.contract?.id && c.version === p.contract?.version) ?? contracts.find((c: any) => c.id === p.contract?.id);
  const roles: string[] = contract?.roles.map((r: any) => r.role) ?? [];
  const slots: any[] = p.slots ?? [];
  const groupedRoles: string[] = contract?.grouped ?? [];
  const autoGroup = (newSlots: any[], op: "AND" | "OR" = "AND") => {
    const grouping: any = { ...(p.grouping ?? {}) };
    for (const role of groupedRoles) {
      const ids = newSlots.filter((s) => s.role === role).map((s) => s.slot);
      if (ids.length > 1) grouping[role] = { op: grouping[role]?.op ?? op, items: ids };
      else delete grouping[role];
    }
    return grouping;
  };
  const setSlots = (v: any[]) => setP({ slots: v, grouping: autoGroup(v) });
  return (
    <Section title="Relation" hint="Choose the contract by meaning; roles, cardinalities and required fields come from it. Participants are exact revisions, possibly other relations.">
      <div className="row wrap">
        <Field label="Contract">
          <select
            value={contract ? `${contract.id}@${contract.version}` : ""}
            onChange={(e) => {
              const [cid, ver] = e.target.value.split("@");
              setP({ contract: { id: cid, version: ver }, fields: cid === "decomposes_into" ? { plan_mode: "OR", ...(p.fields ?? {}) } : (p.fields ?? {}) });
            }}
          >
            <option value="">choose…</option>
            {contracts.map((c: any) => (
              <option key={`${c.id}@${c.version}`} value={`${c.id}@${c.version}`}>
                {c.family}: {c.id}
                {c.extension ? ` (extension ${c.version})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Modality (strength)">
          <Select value={p.modality} options={["logical", "evidential", "heuristic", "editorial", "historical", "formal_mapping"]} onChange={(x) => setP({ modality: x })} />
        </Field>
        <Field label="Assertion">
          <Select value={p.assertion} options={["asserted", "claimed", "conjectured"]} onChange={(x) => setP({ assertion: x })} />
        </Field>
      </div>
      {contract && <p className="hint">{contract.description}</p>}
      {contract && (
        <div className="small">
          Roles:{" "}
          {contract.roles.map((r: any) => (
            <Chip key={r.role} value="role" label={`${r.role} [${r.card.min}..${r.card.max ?? "n"}]`} />
          ))}
          {contract.required_fields?.length > 0 && <> · required fields: {contract.required_fields.join(", ")}</>}
        </div>
      )}
      <Field label="Interpretation (human formula)">
        <textarea rows={2} value={p.interpretation ?? ""} onChange={(e) => setP({ interpretation: e.target.value })} />
      </Field>
      <h4>Participants</h4>
      <ListEditor
        items={slots}
        onChange={setSlots}
        make={() => ({ slot: nextId("s", slots, "slot"), role: roles[0] ?? "", ref: undefined })}
        addLabel="participant"
        render={(s: any, setS) => (
          <div className="row wrap">
            <code>{s.slot}</code>
            <Select value={s.role} options={roles} onChange={(x) => setS({ ...s, role: x })} allowEmpty="role…" />
            <Ref value={s.ref} onChange={(r) => setS({ ...s, ref: r })} />
            {p.contract?.id === "decomposes_into" && s.role === "part" && <Select value={s.modality} options={vocab?.plan_modalities ?? []} onChange={(x) => setS({ ...s, modality: x })} allowEmpty="modality…" />}
            <input className="small" style={{ width: 60 }} placeholder="order" value={s.order ?? ""} onChange={(e) => setS({ ...s, order: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        )}
      />
      {Object.entries(p.grouping ?? {}).map(([role, g]: any) => (
        <div key={role} className="row small">
          Logical grouping of <strong>{role}</strong>:{" "}
          <Select value={g.op} options={["AND", "OR"]} onChange={(op) => setP({ grouping: { ...p.grouping, [role]: { ...g, op } } })} /> over {g.items.join(", ")}
        </div>
      ))}
      <h4>Hypotheses / conditions</h4>
      <ListEditor items={p.hypotheses ?? []} onChange={(v) => setP({ hypotheses: v })} make={() => ({ id: nextId("h", p.hypotheses ?? []), text: "" })} addLabel="hypothesis" render={(h: any, setH) => <input value={h.text} onChange={(e) => setH({ ...h, text: e.target.value })} placeholder={h.id} />} />
      <div className="row wrap">
        <Field label="Scope">
          <input value={p.scope ?? ""} onChange={(e) => setP({ scope: e.target.value })} />
        </Field>
        <Field label="Quantitative scope">
          <input value={p.quantitative_scope ?? ""} onChange={(e) => setP({ quantitative_scope: e.target.value })} />
        </Field>
      </div>
      <h4>Contract fields</h4>
      <div className="row wrap">
        {[...new Set([...(contract?.required_fields ?? []), ...Object.keys(p.fields ?? {}), "context_map"])].map((f: string) => (
          <Field key={f} label={f.replace(/_/g, " ")}>
            {f === "plan_mode" ? (
              <Select value={p.fields?.[f]} options={["AND", "OR"]} onChange={(x) => setP({ fields: { ...p.fields, [f]: x } })} />
            ) : f === "dependency_kind" ? (
              <Select value={p.fields?.[f]} options={vocab?.dep_kinds ?? []} onChange={(x) => setP({ fields: { ...p.fields, [f]: x } })} allowEmpty="…" />
            ) : (
              <input value={p.fields?.[f] ?? ""} onChange={(e) => setP({ fields: { ...p.fields, [f]: e.target.value } })} />
            )}
          </Field>
        ))}
        {["isomorphic_to", "reduces_to"].includes(p.contract?.id) && (
          <label className="small">
            <input type="checkbox" checked={!!p.witness_not_provided} onChange={(e) => setP({ witness_not_provided: e.target.checked || undefined })} /> witness not yet provided (shown)
          </label>
        )}
        {p.contract?.id === "equivalent_under" && (
          <Field label="Pairing (3+ sides)">
            <Select value={p.pairing} options={["all_pairs", "listed_pairs"]} onChange={(x) => setP({ pairing: x || undefined })} allowEmpty="—" />
          </Field>
        )}
      </div>
    </Section>
  );
}

function ResearchForm({ p, setP }: { p: any; setP: (x: any) => void }) {
  const { vocab } = useSession();
  const { data: agents } = useRpc("agents", {});
  const a = p.attempt;
  const setA = (patch: any) => setP({ attempt: { ...a, ...patch } });
  const f = a?.failure;
  const setF = (patch: any) => setA({ failure: { ...f, ...patch } });
  return (
    <Section title="Research item" hint="Work state is tracked by events, not edited here. Plans are decomposition relations with one modality per part.">
      <div className="row wrap">
        <Field label="Role">
          <Select value={p.role} options={vocab?.research_roles ?? []} onChange={(x) => setP({ role: x })} />
        </Field>
        <Field label="Responsible">
          <select value={p.responsible ?? ""} onChange={(e) => setP({ responsible: e.target.value || undefined })}>
            <option value="">unassigned</option>
            {(agents ?? []).filter((x: any) => x.kind === "human").map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Goal / question">
        <textarea rows={3} value={p.goal ?? ""} onChange={(e) => setP({ goal: e.target.value })} />
      </Field>
      <Field label="Exact target">
        <Ref value={p.target} onChange={(r) => setP({ target: r })} />
      </Field>
      <div className="row wrap">
        <Field label="Closure criterion">
          <input value={p.closure_criterion ?? ""} onChange={(e) => setP({ closure_criterion: e.target.value })} />
        </Field>
        <Field label="Answer criterion">
          <input value={p.answer_criterion ?? ""} onChange={(e) => setP({ answer_criterion: e.target.value })} />
        </Field>
      </div>
      {p.role === "inquiry_line" && (
        <>
          <h4>Selection (pinned revisions)</h4>
          <ListEditor items={p.selection ?? []} onChange={(v) => setP({ selection: v })} make={() => undefined as any} addLabel="item" render={(s: any, setS) => <Ref value={s} onChange={setS} />} />
          <Field label="Baseline note">
            <input value={p.baseline ?? ""} onChange={(e) => setP({ baseline: e.target.value })} />
          </Field>
        </>
      )}
      {["attempt", "experiment"].includes(p.role) && (
        <div className="attempt-edit">
          {!a && <button onClick={() => setP({ attempt: { strategy: "", steps: [], outputs: [], result: "in_progress", artifacts: [] } })}>Add attempt record</button>}
          {a && (
            <>
              <div className="row wrap">
                <Field label="Strategy">
                  <input value={a.strategy} onChange={(e) => setA({ strategy: e.target.value })} />
                </Field>
                <Field label="Approach">
                  <input value={a.approach ?? ""} onChange={(e) => setA({ approach: e.target.value })} />
                </Field>
                <Field label="Protocol">
                  <input value={a.protocol ?? ""} onChange={(e) => setA({ protocol: e.target.value })} />
                </Field>
                <Field label="Result">
                  <Select
                    value={a.result}
                    options={["in_progress", "succeeded", "partial", "failed"]}
                    onChange={(x) =>
                      setA({
                        result: x,
                        failure:
                          x === "failed"
                            ? (a.failure ?? { kind: "logical_error", defect_locator: "", observed: "", allowed_negative_conclusion: "", non_conclusions: [""], barrier_applicability: { status: "not_evaluated" }, successors: "none_recorded", evaluator: "", evaluated_at: new Date().toISOString().slice(0, 10) })
                            : undefined,
                      })
                    }
                  />
                </Field>
              </div>
              <h4>Steps</h4>
              <ListEditor items={a.steps ?? []} onChange={(v) => setA({ steps: v })} make={() => ({ id: nextId("s", a.steps ?? []), text: "" })} addLabel="step" render={(s: any, setS) => <input value={s.text} onChange={(e) => setS({ ...s, text: e.target.value })} placeholder={s.id} />} />
              <Field label="Observed">
                <input value={a.observed ?? ""} onChange={(e) => setA({ observed: e.target.value })} />
              </Field>
              <h4>Artifacts / outputs</h4>
              <ListEditor items={a.artifacts ?? []} onChange={(v) => setA({ artifacts: v })} make={() => undefined as any} addLabel="artifact" render={(x: any, setX) => <Ref value={x} onChange={setX} />} />
              <Field label="If artifacts are missing, why">
                <input value={a.artifacts_missing_reason ?? ""} onChange={(e) => setA({ artifacts_missing_reason: e.target.value || undefined })} />
              </Field>
              {f && (
                <div className="failure">
                  <h4>Failure record (required to seal a failed attempt)</h4>
                  <div className="row wrap">
                    <Field label="Failure kind">
                      <Select value={f.kind} options={vocab?.failure_kinds ?? []} onChange={(x) => setF({ kind: x })} />
                    </Field>
                    <Field label="Defect / failure locator">
                      <input value={f.defect_locator} onChange={(e) => setF({ defect_locator: e.target.value })} />
                    </Field>
                    <Field label="Observed result">
                      <input value={f.observed} onChange={(e) => setF({ observed: e.target.value })} />
                    </Field>
                    {f.kind === "finite_search_no_hit" && (
                      <Field label="Searched range / protocol">
                        <input value={f.range ?? ""} onChange={(e) => setF({ range: e.target.value })} />
                      </Field>
                    )}
                  </div>
                  <Field label="Maximal negative conclusion allowed">
                    <input value={f.allowed_negative_conclusion} onChange={(e) => setF({ allowed_negative_conclusion: e.target.value })} />
                  </Field>
                  <h4>Non-conclusions (what this does NOT establish)</h4>
                  <ListEditor items={f.non_conclusions} onChange={(v) => setF({ non_conclusions: v })} make={() => ""} addLabel="non-conclusion" render={(s: string, setS) => <input value={s} onChange={(e) => setS(e.target.value)} />} />
                  <div className="row wrap">
                    <Field label="Barrier applicability">
                      <Select value={f.barrier_applicability.status} options={["none_known", "not_evaluated", "evaluated"]} onChange={(x) => setF({ barrier_applicability: { ...f.barrier_applicability, status: x } })} />
                    </Field>
                    {f.barrier_applicability.status === "evaluated" && <Ref value={f.barrier_applicability.barrier} onChange={(r) => setF({ barrier_applicability: { ...f.barrier_applicability, barrier: r } })} />}
                    <Field label="Evaluator">
                      <input value={f.evaluator} onChange={(e) => setF({ evaluator: e.target.value })} />
                    </Field>
                    <Field label="Evaluated at">
                      <input value={f.evaluated_at} onChange={(e) => setF({ evaluated_at: e.target.value })} />
                    </Field>
                  </div>
                  <label className="small">
                    <input type="checkbox" checked={f.successors === "none_recorded"} onChange={(e) => setF({ successors: e.target.checked ? "none_recorded" : [] })} /> no successor recorded
                  </label>
                  {f.successors !== "none_recorded" && <ListEditor items={f.successors} onChange={(v) => setF({ successors: v })} make={() => undefined as any} addLabel="successor" render={(x: any, setX) => <Ref value={x} onChange={setX} />} />}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function EvaluationForm({ p, setP }: { p: any; setP: (x: any) => void }) {
  const { vocab } = useSession();
  const dims = vocab ? [...new Set([...Object.keys(vocab.status_values), ...Object.keys(vocab.finding_values)])] : [];
  const valuesFor = (d: string) => (vocab ? (vocab.status_values[d] ?? vocab.finding_values[d] ?? []) : []);
  return (
    <Section title="Evaluation" hint="Attributed to you, scoped, about one exact revision. It never modifies what it evaluates; reviews of r1 do not carry to r2.">
      <div className="row wrap">
        <Field label="Kind">
          <Select value={p.eval_kind} options={["review", "assessment", "applicability", "consistency", "comparison"]} onChange={(x) => setP({ eval_kind: x })} />
        </Field>
        <Field label="Subject (exact revision)">
          <Ref value={p.subject} onChange={(r) => setP({ subject: r })} />
        </Field>
        <Field label="Locator (step/slot/anchor)">
          <input value={p.locator ?? ""} onChange={(e) => setP({ locator: e.target.value || undefined })} />
        </Field>
      </div>
      <Field label="Scope">
        <input value={p.scope ?? ""} onChange={(e) => setP({ scope: e.target.value })} />
      </Field>
      {p.eval_kind === "assessment" && (
        <div className="row">
          <Select value={p.dimension} options={dims} onChange={(x) => setP({ dimension: x, value: undefined })} allowEmpty="dimension…" />
          <Select value={p.value} options={valuesFor(p.dimension)} onChange={(x) => setP({ value: x })} allowEmpty="value…" />
          <input placeholder="source verdict (verbatim, if imported)" value={p.source_verdict ?? ""} onChange={(e) => setP({ source_verdict: e.target.value || undefined })} />
        </div>
      )}
      {["applicability", "consistency"].includes(p.eval_kind) && (
        <div className="row wrap">
          {p.eval_kind === "applicability" && <Ref value={p.barrier} onChange={(r) => setP({ barrier: r })} placeholder="Barrier" />}
          {p.eval_kind === "applicability" && <input placeholder="predicate tested" value={p.predicate ?? ""} onChange={(e) => setP({ predicate: e.target.value })} />}
          <Select value={p.value} options={valuesFor(p.eval_kind === "applicability" ? "barrier_applicability" : "context_consistency")} onChange={(x) => setP({ value: x })} allowEmpty="value…" />
        </div>
      )}
      {p.eval_kind === "review" && (
        <>
          <h4>Findings per dimension</h4>
          <ListEditor
            items={p.findings ?? []}
            onChange={(v) => setP({ findings: v })}
            make={() => ({ dimension: "correctness", value: "undetermined", text: "" })}
            addLabel="finding"
            render={(f: any, setF) => (
              <div className="row wrap">
                <Select value={f.dimension} options={dims} onChange={(x) => setF({ ...f, dimension: x, value: valuesFor(x)[0] })} />
                <Select value={f.value} options={valuesFor(f.dimension)} onChange={(x) => setF({ ...f, value: x })} />
                <input placeholder="locator" value={f.locator ?? ""} onChange={(e) => setF({ ...f, locator: e.target.value || undefined })} />
                <input placeholder="finding" value={f.text ?? ""} onChange={(e) => setF({ ...f, text: e.target.value })} />
              </div>
            )}
          />
        </>
      )}
      <Field label="Reason / argument">
        <textarea rows={2} value={p.reason ?? ""} onChange={(e) => setP({ reason: e.target.value })} />
      </Field>
      <h4>Evidence</h4>
      <ListEditor items={p.evidence ?? []} onChange={(v) => setP({ evidence: v })} make={() => undefined as any} addLabel="evidence" render={(x: any, setX) => <Ref value={x} onChange={setX} />} />
      <Field label="Conflicts of interest / independence">
        <input value={p.conflicts_of_interest ?? ""} onChange={(e) => setP({ conflicts_of_interest: e.target.value || undefined })} />
      </Field>
    </Section>
  );
}

function CollectionForm({ p, setP }: { p: any; setP: (x: any) => void }) {
  const blocks: any[] = p.narrative ?? [];
  const setBlocks = (v: any[]) => {
    // Keep the manifest in step with transclusions: exact references, editorial membership.
    const trans = v.filter((b) => b.type === "transclusion" && b.ref);
    const others = (p.manifest ?? []).filter((m: any) => m.role !== "transcluded");
    setP({ narrative: v, manifest: [...others, ...trans.map((b, i) => ({ slot: `t${i + 1}`, ref: b.ref, role: "transcluded", relation: "references" }))] });
  };
  return (
    <Section title="Narrative" hint="Write prose and transclude exact revisions. Transcluded content is pinned; updating a component never changes this narrative once sealed.">
      <div className="row wrap">
        <Field label="Purpose">
          <Select value={p.purpose} options={["narrative", "paper", "package", "theory", "program", "collection"]} onChange={(x) => setP({ purpose: x })} />
        </Field>
        <Field label="Description">
          <input value={p.description ?? ""} onChange={(e) => setP({ description: e.target.value })} />
        </Field>
      </div>
      <ListEditor
        items={blocks}
        onChange={setBlocks}
        make={() => ({ id: nextId("b", blocks), type: "prose", text: "" })}
        addLabel="block"
        render={(b: any, setB) => (
          <div className="block-edit">
            <Select value={b.type} options={["prose", "heading", "transclusion"]} onChange={(x) => setB({ ...b, type: x })} />
            {b.type === "transclusion" ? <Ref value={b.ref} onChange={(r) => setB({ ...b, ref: r })} /> : <textarea rows={b.type === "heading" ? 1 : 4} value={b.text ?? ""} onChange={(e) => setB({ ...b, text: e.target.value })} />}
          </div>
        )}
      />
      <h4>Other manifest components</h4>
      <ListEditor
        items={(p.manifest ?? []).filter((m: any) => m.role !== "transcluded")}
        onChange={(v) => setP({ manifest: [...v, ...(p.manifest ?? []).filter((m: any) => m.role === "transcluded")] })}
        make={() => ({ slot: nextId("m", p.manifest ?? [], "slot"), ref: undefined, role: "component", relation: "contains" })}
        addLabel="component"
        render={(m: any, setM) => (
          <div className="row wrap">
            <Ref value={m.ref} onChange={(r) => setM({ ...m, ref: r })} />
            <Select value={m.relation} options={["has_part", "contains", "imports", "uses", "summarizes", "references"]} onChange={(x) => setM({ ...m, relation: x })} />
            <input placeholder="role" value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })} />
          </div>
        )}
      />
    </Section>
  );
}

function ContextForm({ p, setP }: { p: any; setP: (x: any) => void }) {
  return (
    <Section title="Context" hint="Inheritance is an explicit expansion: conflicting symbols, axioms, foundations or versions need a resolution — never 'last wins'.">
      <Field label="Foundations ('unknown' allowed)">
        <input value={p.foundations ?? ""} onChange={(e) => setP({ foundations: e.target.value })} />
      </Field>
      <div className="row wrap">
        <Field label="Parent context">
          <Ref value={p.parent} onChange={(r) => setP({ parent: r })} kinds={["context"]} />
        </Field>
        <Field label="Conventions">
          <input value={p.conventions ?? ""} onChange={(e) => setP({ conventions: e.target.value })} />
        </Field>
      </div>
      <h4>Imports (exact context revisions)</h4>
      <ListEditor items={p.imports ?? []} onChange={(v) => setP({ imports: v })} make={() => undefined as any} addLabel="import" render={(x: any, setX) => <Ref value={x} onChange={setX} kinds={["context"]} />} />
      <h4>Assumptions</h4>
      <ListEditor
        items={p.assumptions ?? []}
        onChange={(v) => setP({ assumptions: v })}
        make={() => ({ id: nextId("A", p.assumptions ?? []), expr: "", scope: "global", variables: [] })}
        addLabel="assumption"
        render={(a: any, setA) => (
          <div className="row">
            <code>{a.id}</code>
            <input value={a.expr} onChange={(e) => setA({ ...a, expr: e.target.value })} />
            <Select value={a.scope} options={["local", "global"]} onChange={(x) => setA({ ...a, scope: x })} />
          </div>
        )}
      />
      <h4>Axioms</h4>
      <ListEditor items={p.axioms ?? []} onChange={(v) => setP({ axioms: v })} make={() => ({ id: nextId("ax", p.axioms ?? []), text: "" })} addLabel="axiom" render={(a: any, setA) => <input value={a.text} onChange={(e) => setA({ ...a, text: e.target.value })} placeholder={a.id} />} />
      <h4>Notation</h4>
      <ListEditor
        items={p.notation ?? []}
        onChange={(v) => setP({ notation: v })}
        make={() => ({ symbol: "", meaning: "" })}
        addLabel="symbol"
        render={(b: any, setB) => (
          <div className="row">
            <input placeholder="symbol" value={b.symbol} onChange={(e) => setB({ ...b, symbol: e.target.value })} />
            <input placeholder="meaning" value={b.meaning} onChange={(e) => setB({ ...b, meaning: e.target.value })} />
          </div>
        )}
      />
      <h4>Conflict resolutions</h4>
      <ListEditor
        items={p.resolutions ?? []}
        onChange={(v) => setP({ resolutions: v })}
        make={() => ({ symbol: "", choice: "" })}
        addLabel="resolution"
        render={(b: any, setB) => (
          <div className="row">
            <input placeholder="symbol / axiom id / version:<entity> / foundations" value={b.symbol} onChange={(e) => setB({ ...b, symbol: e.target.value })} />
            <input placeholder="choice, renaming or mapping" value={b.choice} onChange={(e) => setB({ ...b, choice: e.target.value })} />
          </div>
        )}
      />
      <details>
        <summary>Execution context (kernel, libraries, hardware…)</summary>
        <div className="row wrap">
          {["kernel", "libraries", "software", "data", "precision", "seed", "parameters", "hardware"].map((f) => (
            <Field key={f} label={f}>
              <input value={p.execution?.[f] ?? ""} onChange={(e) => setP({ execution: { ...(p.execution ?? {}), [f]: e.target.value || undefined } })} />
            </Field>
          ))}
        </div>
        <Field label="Trust boundary">
          <input value={p.trust_boundary ?? ""} onChange={(e) => setP({ trust_boundary: e.target.value })} />
        </Field>
      </details>
    </Section>
  );
}
