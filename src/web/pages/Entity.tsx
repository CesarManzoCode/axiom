import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Chip, Empty, EntityLink, ErrorBox, Field, Json, KindBadge, Loading, RefPicker, RevLink, Section, Select, StatusVector, Tabs, Time, useAction, useRpc, useSession, type PickedRef } from "../ui.tsx";
import { KindView, Narrative } from "./KindView.tsx";
import { PlanTree } from "./Research.tsx";
import { LocalGraph } from "./Graph.tsx";

export function EntityPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const rev = sp.get("rev") ?? undefined;
  const [policy, setPolicy] = useState<string>("workspace_curator_selection@1");
  const [cut, setCut] = useState<string>("");
  const [tab, setTab] = useState("overview");
  const args = useMemo(() => ({ entity_id: id, rev, policy, ...(cut ? { cut: new Date(cut).toISOString() } : {}) }), [id, rev, policy, cut]);
  const { data, error, reload } = useRpc("entity", args);
  const { agent } = useSession();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const e = data.entity;
  const r = data.revision;
  const c = r?.content;
  const member = !!e.workspace_id;
  return (
    <div className="page entity">
      {e.namespace === "candidate" && (
        <div className="banner candidate">
          Candidate — outside the curated corpus. It is not used as an accepted premise and does not appear in curated answers. Gate state: <Chip value={e.gate?.state ?? "proposed"} />{" "}
          {member && <Link to={`/w/${e.workspace_id}/candidates`}>Open inbox</Link>}
        </div>
      )}
      {(e.fixture_label === "synthetic_product_fixture" || r?.fixture_label === "synthetic_product_fixture") && <div className="banner synthetic">Synthetic product fixture — a test scenario, not mathematical literature.</div>}
      <div className="entity-head">
        <KindBadge kind={e.kind} role={c?.payload?.role ?? c?.payload?.contract?.id} />
        <h1>{r?.title ?? e.title}</h1>
      </div>
      <div className="small muted">
        Entity <code>{e.id}</code>
        {r && (
          <>
            {" "}
            · revision <code>{r.id}</code> r{r.seq} · sealed <Time at={r.sealed_at} /> by {r.sealed_by?.name} · context <RevLink rev={r.context.rev} title={r.context.self ? "self (root profile)" : r.context.title} />
          </>
        )}
        {e.steward && <> · steward {e.steward.name}</>}
        {e.access && <> · visibility {e.access.mode}</>}
      </div>
      <div className="revbar">
        <span className="small">Showing: {data.shown_basis}.</span>{" "}
        {data.revisions.map((x: any) => (
          <button key={x.id} className={`small ${x.id === data.shown_rev ? "" : "ghost"}`} onClick={() => setSp({ rev: x.id })} title={x.change_summary ?? ""}>
            r{x.seq}
            {x.id === data.preferred ? " ★" : ""}
            {x.validity.filter((v: string) => v !== "active").map((v: string) => ` · ${v.replace(/_/g, " ")}`)}
            {x.published.includes("public") ? " · public" : ""}
          </button>
        ))}
        {data.drafts.map((d: any) => (
          <Link key={d.id} className="button small ghost" to={`/draft/${d.id}`}>
            draft by {d.author.name}
          </Link>
        ))}
      </div>
      {r?.withheld && (
        <div className="banner withheld">
          Availability restricted: {r.withheld.reason}. The citation remains: {r.withheld.tombstone.title} ({r.withheld.tombstone.revision}).
        </div>
      )}
      <div className="row wrap policybar">
        <Field label="Assessment policy">
          <Select value={policy} options={["workspace_curator_selection@1", "attributed_positions@1", "author_only@1"]} onChange={setPolicy} />
        </Field>
        <Field label="Known as of (time cut)" hint="Reconstructs what was recorded by then">
          <input type="datetime-local" value={cut} onChange={(ev) => setCut(ev.target.value)} />
        </Field>
      </div>
      {!r ? (
        <Empty>No sealed revision visible yet.</Empty>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "relations", label: `Relations (${data.relations.participates_in.length})` },
              { id: "deps", label: "Dependencies" },
              { id: "history", label: "History" },
              { id: "provenance", label: "Provenance & credit" },
              { id: "graph", label: "Local graph" },
              ...(agent && member ? [{ id: "act", label: "Act" }] : []),
            ]}
          />
          {tab === "overview" && <Overview data={data} reload={reload} />}
          {tab === "relations" && <Relations data={data} />}
          {tab === "deps" && <Dependencies data={data} />}
          {tab === "history" && <History data={data} />}
          {tab === "provenance" && <Provenance data={data} />}
          {tab === "graph" && <LocalGraph rev={r.id} />}
          {tab === "act" && <Act data={data} reload={reload} />}
        </>
      )}
    </div>
  );
}

function Overview({ data, reload }: { data: any; reload: () => void }) {
  const r = data.revision;
  const c = r.content;
  return (
    <>
      <Section title="What it says, and in which context">
        {c && <KindView content={c} />}
        {data.manifest && <Narrative manifest={data.manifest} />}
      </Section>
      <Section title="Why we believe it — attributed status" hint="Ten independent dimensions. Nothing is 'verified'; each value is attributed to an assessor under a policy and time cut.">
        <StatusVector status={data.status} compact />
      </Section>
      <Section title={`Support (${data.support.entries.length}) and counter-evidence (${data.support.counter_evidence.length})`} hint="Each argument is an alternative support branch. Losing one never refutes the statement.">
        <div>
          Support summary: <Chip value={data.support.summary} /> {data.support.note && <span className="muted small">{data.support.note}</span>}
        </div>
        {data.support.entries.length > 0 && (
          <table className="list">
            <thead>
              <tr>
                <th>Support</th>
                <th>Kind</th>
                <th>Completeness</th>
                <th>Correctness (attributed)</th>
                <th>Status</th>
                <th>Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {data.support.entries.map((s: any) => (
                <tr key={s.rev}>
                  <td>
                    <RevLink rev={s.rev} title={s.title} /> {s.contract && <span className="muted small">({s.contract})</span>}
                  </td>
                  <td className="small">{s.argument_kind ?? s.evidence_modality}</td>
                  <td className="small">{s.completeness ?? "—"}</td>
                  <td>
                    <Chip value={s.correctness.summary} /> <span className="small muted">{s.correctness.attributed_to.join(", ")}</span>
                  </td>
                  <td>
                    <Chip value={s.status} />
                  </td>
                  <td className="small">{s.validity.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.support.counter_evidence.map((x: any) => (
          <div key={x.rev} className="counter">
            <Chip value={x.contract} /> <RevLink rev={x.rev} title={x.title} /> {x.negated && <span className="small">— negates: {x.negated}</span>}
          </div>
        ))}
        <div className="row">
          <Link className="button small ghost" to={`/w/${data.entity.workspace_id}/new?kind=argument&target=${r.id}`}>
            Add a proof / argument
          </Link>
          <Link className="button small ghost" to={`/w/${data.entity.workspace_id}/new?kind=relation&contract=refutes&target=${r.id}`}>
            Propose a refutation
          </Link>
        </div>
      </Section>
      {data.equivalences?.claims.length > 0 && (
        <Section title="Equivalences and correspondences" hint="Equivalence holds only with its context and conditions; anchors are never merged.">
          {data.equivalences.claims.map((q: any) => (
            <div key={q.rev}>
              <Chip value={q.contract.id} /> <RevLink rev={q.rev} title={q.title} /> {q.conditions.length > 0 && <span className="small">under {q.conditions.map((h: any) => h.text).join("; ")}</span>} <span className="muted small">{q.note}</span>
            </div>
          ))}
        </Section>
      )}
      {data.work && <ResearchPanel data={data} reload={reload} />}
      {data.barrier && (
        <Section title="Where this barrier applies" hint={data.barrier.note}>
          <table className="list">
            <tbody>
              {[...data.barrier.applies_to, ...data.barrier.does_not_apply_to, ...data.barrier.undetermined].map((a: any) => (
                <tr key={a.assessment_rev}>
                  <td>
                    <RevLink rev={a.subject.rev} title={a.subject.title} />
                  </td>
                  <td>
                    <Chip value={a.value} />
                  </td>
                  <td className="small">{a.predicate}</td>
                  <td className="small muted">
                    {a.scope} — {a.assessor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {data.formalization && (data.formalization.relations.length > 0 || data.formalization.formal_statement || data.formalization.formal_arguments.length > 0) && (
        <Section title="Formalization and fidelity" hint={data.formalization.note}>
          <div>
            Formalization: <Chip value={data.formalization.formalization.summary} /> · Fidelity: <Chip value={data.formalization.fidelity.summary} />
          </div>
          {data.formalization.relations.map((x: any) => (
            <div key={x.rev}>
              <Chip value={x.contract.id} /> <RevLink rev={x.rev} title={x.title} />
            </div>
          ))}
          {data.formalization.formal_arguments.map((x: any) => (
            <div key={x.rev} className="small">
              {x.kind}: <RevLink rev={x.rev} title={x.title} /> — environment {x.environment ? <RevLink rev={x.environment.rev} title={x.environment.title} /> : "unspecified"}; kernel dependencies {x.kernel_dependencies.replace(/_/g, " ")}
            </div>
          ))}
        </Section>
      )}
      {data.reproducibility && (data.reproducibility.protocol || data.reproducibility.execution_context) && (
        <Section title="Reproducibility" hint={data.reproducibility.note}>
          <Json value={{ protocol: data.reproducibility.protocol, execution: data.reproducibility.execution_context, reproducibility: data.reproducibility.reproducibility.summary, sources: data.reproducibility.sources }} />
        </Section>
      )}
      {data.failed_attempts?.length > 0 && (
        <Section title="What did not work (bounded)" hint="Failed attempts on this item, with their maximal negative conclusions and non-conclusions.">
          {data.failed_attempts.map((f: any) => (
            <div key={f.rev} className="failure">
              <RevLink rev={f.rev} title={f.title} /> — {f.failure?.kind?.replace(/_/g, " ")} at {f.failure?.defect_locator}. Allowed: “{f.failure?.allowed_negative_conclusion}”. Not established: {f.failure?.non_conclusions?.join("; ")}.
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function ResearchPanel({ data, reload }: { data: any; reload: () => void }) {
  const { vocab, agent } = useSession();
  const act = useAction();
  const [to, setTo] = useState("active");
  const [reason, setReason] = useState("");
  const [artifact, setArtifact] = useState<PickedRef | null>(null);
  const [criterion, setCriterion] = useState(data.revision.content?.payload?.closure_criterion ?? "");
  const pending = data.work.closures.filter((x: any) => !x.decision);
  const entityId = data.entity.id;
  return (
    <Section
      title={
        <>
          Work state <Chip value={data.work.state} /> {data.route && <Chip value={data.route.liveness} />}
        </>
      }
      hint="Work state is not logical state. Completion needs a closure proposal citing an exact artifact, accepted by the responsible person or a curator."
      actions={
        <Link className="button small ghost" to={`/bundle/${data.revision.id}`}>
          Context bundle
        </Link>
      }
    >
      <ErrorBox error={act.error} />
      {data.plans?.length > 0 && <PlanTree plans={data.plans} />}
      {agent && (
        <div className="grid2">
          <div>
            <h4>Change work state</h4>
            <div className="row wrap">
              <Select value={to} options={(vocab?.work_states ?? []).filter((s: string) => !["completed", "completion_claimed"].includes(s))} onChange={setTo} />
              <input placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button disabled={!reason} onClick={() => act.run(() => rpc("transitionWork", { entity_id: entityId, to, reason }).then(reload))}>
                Record
              </button>
              {["completed", "abandoned"].includes(data.work.state) && (
                <button className="ghost" disabled={!reason} onClick={() => act.run(() => rpc("reopen", { entity_id: entityId, reason }).then(reload))}>
                  Reopen
                </button>
              )}
            </div>
          </div>
          <div>
            <h4>Propose closure</h4>
            <RefPicker workspace={data.entity.workspace_id} value={artifact} onChange={setArtifact} allowLive={false} placeholder="Exact artifact (proof, counterexample, assessment…)" />
            <input placeholder="criterion met" value={criterion} onChange={(e) => setCriterion(e.target.value)} />
            <button disabled={!artifact?.rev || !criterion} onClick={() => act.run(() => rpc("proposeClosure", { entity_id: entityId, artifact: artifact!.rev, criterion }).then(reload))}>
              Propose closure
            </button>
          </div>
        </div>
      )}
      {data.work.closures.length > 0 && (
        <table className="list">
          <thead>
            <tr>
              <th>Closure proposal</th>
              <th>Criterion</th>
              <th>By</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {data.work.closures.map((x: any) => (
              <tr key={x.id}>
                <td>
                  <RevLink rev={x.artifact} title="artifact" />
                </td>
                <td className="small">{x.criterion}</td>
                <td className="small">{x.proposed_by?.name}</td>
                <td>
                  {x.decision ? (
                    <>
                      <Chip value={x.decision.accepted ? "accepted" : "rejected"} /> {x.decision.by?.name}: {x.decision.reason}
                    </>
                  ) : agent ? (
                    <>
                      <button className="small" onClick={() => act.run(() => rpc("decideClosure", { entity_id: entityId, proposal: x.id, accepted: true, reason: reason || "criterion satisfied" }).then(reload))}>
                        Accept
                      </button>{" "}
                      <button className="small ghost" onClick={() => act.run(() => rpc("decideClosure", { entity_id: entityId, proposal: x.id, accepted: false, reason: reason || "criterion not met" }).then(reload))}>
                        Reject
                      </button>
                    </>
                  ) : (
                    "pending"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pending.length === 0 && data.work.history.length > 0 && (
        <details>
          <summary>Work history ({data.work.history.length})</summary>
          <ul>
            {data.work.history.map((h: any) => (
              <li key={h.id} className="small">
                <Time at={h.at} /> {h.kind.replace(/_/g, " ")} {h.payload.to ? `→ ${h.payload.to}` : ""} — {h.actor?.name}: {h.payload.reason ?? h.payload.criterion}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function Relations({ data }: { data: any }) {
  const rels = data.relations.participates_in;
  return (
    <Section title="Relations this revision participates in" hint="Relations are entities with contracts, roles, conditions and their own status. Your position in each is shown.">
      {rels.length === 0 && <Empty>No recorded relation involves this exact revision.</Empty>}
      <table className="list">
        <thead>
          <tr>
            <th>Relation</th>
            <th>Contract</th>
            <th>Role here</th>
            <th>Other participants (role)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rels.map((x: any) => (
            <tr key={x.rev + x.here?.slot}>
              <td>
                <RevLink rev={x.rev} title={x.title} />
                <div className="small muted">{x.interpretation}</div>
                {x.hypotheses?.length > 0 && <div className="small">under: {x.hypotheses.map((h: any) => h.text).join("; ")}</div>}
              </td>
              <td>
                <code>{x.contract.id}</code> <span className="small muted">{x.modality}</span>
              </td>
              <td>{x.here?.role}</td>
              <td className="small">
                {x.slots
                  .filter((s: any) => s.rev !== data.revision.id)
                  .map((s: any) => (
                    <div key={s.slot}>
                      {s.role}: <RevLink rev={s.rev} title={s.title} />
                    </div>
                  ))}
              </td>
              <td className="small">
                <Chip value={x.status.logical} /> <Chip value={x.status.support} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link className="button small ghost" to={`/w/${data.entity.workspace_id}/new?kind=relation&participant=${data.revision.id}`}>
        Record a connection involving this
      </Link>
    </Section>
  );
}

const KIND_LABEL: Record<string, string> = {
  ambient_context: "Ambient context (interpretation)",
  formal: "Formal dependencies",
  explicit_informal: "Explicit informal dependencies",
  proof_local_use: "Proof-local uses",
  inferred: "Inferred (suggestions, never formal)",
  citation: "Citations (no logical propagation)",
  conceptual_influence: "Conceptual influence (no propagation)",
  necessary_assumption: "Necessary assumptions",
  relation_participant: "Relation participants",
};

function EdgeTable({ groups }: { groups: Record<string, any[]> }) {
  const keys = Object.keys(groups);
  if (!keys.length) return <Empty>None recorded.</Empty>;
  return (
    <>
      {keys.map((k) => (
        <div key={k} className="depgroup">
          <h4>{KIND_LABEL[k] ?? k.replace(/_/g, " ")}</h4>
          <ul>
            {groups[k].map((e: any, i: number) => (
              <li key={i}>
                <RevLink rev={e.rev} title={e.title} /> <span className="muted small">{[e.via, e.role, e.slot, e.dep_kind, e.locator].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function Dependencies({ data }: { data: any }) {
  const d = data.dependencies;
  return (
    <div className="grid2">
      <Section title="What it depends on" hint={d.completeness}>
        <EdgeTable groups={d.by_kind} />
        {d.alternative_support_sets.length > 0 && (
          <>
            <h4>Per argument (alternative support sets)</h4>
            {d.alternative_support_sets.map((a: any) => (
              <div key={a.argument.rev} className="depset">
                <RevLink rev={a.argument.rev} title={a.argument.title} /> <Chip value={a.argument.status} />
                {a.dependency_sets.map((s: any) => (
                  <div key={s.id} className="small">
                    set {s.id}: {s.members.map((m: any) => m.title).join(", ")} — <em>{s.minimality_note}</em>
                  </div>
                ))}
                <ul className="small">
                  {a.uses.map((u: any, i: number) => (
                    <li key={i}>
                      {u.class.replace(/_/g, " ")}: <RevLink rev={u.rev} title={u.title} /> {u.locator && <span className="muted">@ {u.locator}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </Section>
      <Section title={`What uses it (${data.used_by.total})`} hint={data.used_by.note}>
        <EdgeTable groups={data.used_by.by_kind} />
      </Section>
    </div>
  );
}

function History({ data }: { data: any }) {
  const { data: tl } = useRpc("timeline", { entity_id: data.entity.id });
  const [a, setA] = useState(data.revisions[0]?.id ?? "");
  const [b, setB] = useState(data.revisions.at(-1)?.id ?? "");
  const nav = useNavigate();
  return (
    <>
      <Section title="Revisions" hint="Sealed revisions are immutable. Siblings are legal; there is no global 'latest' that rewrites consumers.">
        <table className="list">
          <thead>
            <tr>
              <th>Rev</th>
              <th>Sealed</th>
              <th>By</th>
              <th>Parents</th>
              <th>Change</th>
              <th>Lifecycle</th>
            </tr>
          </thead>
          <tbody>
            {data.revisions.map((x: any) => (
              <tr key={x.id}>
                <td>
                  <EntityLink id={data.entity.id} rev={x.id}>
                    r{x.seq}
                  </EntityLink>{" "}
                  <code className="small">{x.id}</code>
                </td>
                <td className="small">
                  <Time at={x.sealed_at} />
                </td>
                <td className="small">{x.sealed_by?.name}</td>
                <td className="small">{x.parents.map((p: string) => data.revisions.find((y: any) => y.id === p)?.seq).map((s: number) => `r${s}`).join(", ") || "—"}</td>
                <td className="small">{x.change_summary}</td>
                <td>{x.validity.map((v: string) => <Chip key={v} value={v} />)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.revisions.length > 1 && (
          <div className="row">
            Compare
            <select value={a} onChange={(e) => setA(e.target.value)}>
              {data.revisions.map((x: any) => (
                <option key={x.id} value={x.id}>
                  r{x.seq}
                </option>
              ))}
            </select>
            →
            <select value={b} onChange={(e) => setB(e.target.value)}>
              {data.revisions.map((x: any) => (
                <option key={x.id} value={x.id}>
                  r{x.seq}
                </option>
              ))}
            </select>
            <button onClick={() => nav(`/compare?old=${a}&new=${b}`)}>Semantic diff</button>
          </div>
        )}
      </Section>
      <Section title="Timeline" hint="Recorded time; occurred time is shown separately when known and never backdated.">
        <table className="list">
          <tbody>
            {(tl ?? []).map((ev: any) => (
              <tr key={ev.id + ev.kind}>
                <td className="small">
                  <Time at={ev.recorded_at} />
                </td>
                <td>{ev.kind.replace(/_/g, " ")}</td>
                <td className="small">{ev.actor?.name ?? ev.actor?.descriptor}</td>
                <td className="small muted">
                  {ev.occurred_at && <>occurred {ev.occurred_at} · </>}
                  {Object.entries(ev.payload ?? {})
                    .filter(([k]) => ["action", "scope", "reason", "value", "to", "from", "audience", "license"].includes(k))
                    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Provenance({ data }: { data: any }) {
  const prov = data.revision.content?.provenance;
  return (
    <>
      <Section title="Provenance of this revision" hint="Origin (human/AI/mixed/deterministic) and acquisition (authorship/import/extraction/…) are separate axes. Inputs outside your audience are omitted.">
        {prov && (
          <table className="kv">
            <tbody>
              <tr>
                <th>Origin</th>
                <td>
                  <Chip value={prov.origin} />
                </td>
              </tr>
              <tr>
                <th>Acquisition</th>
                <td>
                  <Chip value={prov.acquisition} />
                </td>
              </tr>
              <tr>
                <th>Original attribution</th>
                <td>{prov.original_attribution ?? <span className="muted">explicit authorship by the sealer</span>}</td>
              </tr>
              <tr>
                <th>Sources</th>
                <td>
                  {prov.sources.length === 0 && <span className="muted">none recorded</span>}
                  {prov.sources.map((s: any, i: number) => (
                    <div key={i}>
                      <RevLink rev={s.source.rev} title="source" /> @ {s.locator}
                    </div>
                  ))}
                </td>
              </tr>
              <tr>
                <th>Dates</th>
                <td className="small">
                  {Object.entries(prov.dates ?? {}).map(([k, v]) => (
                    <div key={k}>
                      {k.replace(/_/g, " ")}: {String(v)}
                    </div>
                  ))}
                  <div>sealed at: {data.revision.sealed_at}</div>
                </td>
              </tr>
              {prov.ai_run && (
                <tr>
                  <th>AI run</th>
                  <td className="small">{Object.entries(prov.ai_run).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                </tr>
              )}
              {prov.derived_from_candidate && (
                <tr>
                  <th>Promoted from candidate</th>
                  <td>
                    <RevLink rev={prov.derived_from_candidate.rev} title="candidate revision" /> ({prov.derived_from_candidate.mapping}
                    {prov.derived_from_candidate.locator ? ` · ${prov.derived_from_candidate.locator}` : ""})
                  </td>
                </tr>
              )}
              {prov.public_limitation && (
                <tr>
                  <th>Authorized limitation</th>
                  <td>{prov.public_limitation}</td>
                </tr>
              )}
              {prov.notes && (
                <tr>
                  <th>Notes</th>
                  <td className="small">{prov.notes}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Contributions" hint={data.contributions.note}>
        <table className="list">
          <tbody>
            {data.contributions.contributions.map((x: any, i: number) => (
              <tr key={i}>
                <td>r{x.seq}</td>
                <td>{x.agent?.name ?? x.descriptor ?? x.original_attribution}</td>
                <td>{x.roles.length ? x.roles.join(", ") : x.activity}</td>
                <td className="small muted">{x.character ?? x.note}</td>
                <td className="small">{x.scope}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.contributions.priority_disputes.length > 0 && <Json value={data.contributions.priority_disputes} />}
      </Section>
      <Section title="Publications fixing this revision">
        {data.publications.length === 0 && <Empty>Not published to any audience beyond its sealed access.</Empty>}
        {data.publications.map((p: any) => (
          <div key={p.id}>
            <Link to={`/pub/${p.id}`}>{p.title ?? p.id}</Link> — <Chip value={p.status} /> to {p.audience.mode}, license {p.license}, <Time at={p.published_at} />
            <div className="small muted">Status then: {Object.entries(p.assessment_snapshot?.status?.[data.revision.id] ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}</div>
          </div>
        ))}
      </Section>
      {data.identity.length > 0 && (
        <Section title="Identity records" hint="Overlays and maps never change what IDs resolve to.">
          {data.identity.map((x: any) => (
            <div key={x.id} className="small">
              {x.action} {x.active === false && "(reversed)"} — {x.entities?.map((e: any) => e.title).join(" ≈ ")} — {x.reason} ({x.actor})
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function Act({ data, reload }: { data: any; reload: () => void }) {
  const nav = useNavigate();
  const { vocab } = useSession();
  const act = useAction();
  const r = data.revision;
  const ws = data.entity.workspace_id;
  const [dimension, setDimension] = useState("logical");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<PickedRef | null>(null);
  const [locator, setLocator] = useState("");
  const [vAction, setVAction] = useState("retracted");
  const [vScope, setVScope] = useState("");
  const [vReason, setVReason] = useState("");
  const [byRev, setByRev] = useState<PickedRef | null>(null);
  const [caseKind, setCaseKind] = useState("dispute");
  const [caseAction, setCaseAction] = useState("opened");
  const [caseId, setCaseId] = useState("");
  const [caseReason, setCaseReason] = useState("");
  const [steward, setSteward] = useState("");
  const { data: agents } = useRpc("agents", {});
  const values = vocab ? (vocab.status_values[dimension] ?? vocab.finding_values[dimension] ?? []) : [];
  const dims = vocab ? [...Object.keys(vocab.status_values), ...Object.keys(vocab.finding_values).filter((d) => !(d in vocab.status_values))] : [];
  return (
    <>
      <ErrorBox error={act.error} />
      <Section title="Work on this revision">
        <div className="row wrap">
          <button onClick={() => act.run(async () => nav(`/draft/${(await rpc("draftFromRevision", { revs: [r.id], intent: "edit" })).draft_id}`))}>Edit → new draft (r{r.seq} stays intact)</button>
          <button className="ghost" onClick={() => nav(`/impact?rev=${r.id}`)}>
            Impact analysis
          </button>
          <button className="ghost" onClick={() => nav(`/w/${ws}/publish?rev=${r.id}`)}>
            Publish…
          </button>
          <button className="ghost" onClick={() => act.run(() => rpc("selectPreferred", { rev: r.id, scope: "workspace navigation" }).then(reload))}>
            Mark r{r.seq} as preferred
          </button>
          <button
            className="ghost"
            onClick={() => {
              const reason = prompt("Why derive an autonomous anchor? (e.g. public redacted version)");
              if (reason) act.run(async () => nav(`/draft/${(await rpc("deriveEntity", { rev: r.id, reason })).draft_id}`));
            }}
          >
            Derive new anchor (redaction / public version)
          </button>
        </div>
      </Section>
      <Section title="Assess or review" hint="Your assessment is attributed to you, scoped, and never edits the revision. 'Unable to assess' = undetermined with a reason.">
        <div className="row wrap">
          <Field label="Dimension">
            <Select value={dimension} options={dims} onChange={(d) => (setDimension(d), setValue(""))} />
          </Field>
          <Field label="Value">
            <Select value={value} options={values} onChange={setValue} allowEmpty="choose…" />
          </Field>
          <Field label="Scope">
            <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. steps 1–3 under H" />
          </Field>
          <Field label="Locator (step/slot)">
            <input value={locator} onChange={(e) => setLocator(e.target.value)} />
          </Field>
          <Field label="Reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Evidence (exact)">
            <RefPicker workspace={ws} value={evidence} onChange={setEvidence} allowLive={false} />
          </Field>
          <button
            disabled={!value || !scope}
            onClick={() =>
              act.run(() =>
                rpc("createAndSeal", {
                  workspace_id: ws,
                  kind: "evaluation",
                  title: `${dimension} of ${r.title}`,
                  content: {
                    context: { rev: r.context.rev },
                    payload: ["correctness", "completeness", "references", "clarity"].includes(dimension)
                      ? { eval_kind: "review", subject: { rev: r.id }, locator: locator || undefined, scope, reason, evidence: evidence?.rev ? [{ rev: evidence.rev }] : [], findings: [{ dimension, value, locator: locator || undefined, text: reason }] }
                      : { eval_kind: "assessment", subject: { rev: r.id }, locator: locator || undefined, dimension, value, scope, reason, evidence: evidence?.rev ? [{ rev: evidence.rev }] : [] },
                    provenance: { origin: "human", acquisition: "authorship" },
                  },
                }).then(reload),
              )
            }
          >
            Seal assessment
          </button>
        </div>
        {data.status && (
          <div className="small">
            Curator: adopt an attributed position as the workspace summary (opposition stays visible):
            {Object.values(data.status.dimensions)
              .flatMap((d: any) => d.positions.map((p: any) => ({ d: d.dimension, p })))
              .map(({ d, p }: any) => (
                <button key={p.assessment_rev + d} className="small ghost" onClick={() => act.run(() => rpc("selectAssessment", { subject_rev: r.id, dimension: d, assessment_rev: p.assessment_rev, reason: "curator selection" }).then(reload))}>
                  {d}: {p.value} ({p.assessor.name ?? p.assessor.descriptor})
                </button>
              ))}
          </div>
        )}
      </Section>
      <Section title="Lifecycle event" hint="Correction, supersession, retraction, restriction and restoration are external events. Content never changes, and retraction never means false.">
        <div className="row wrap">
          <Select value={vAction} options={vocab?.validity_actions ?? []} onChange={setVAction} />
          <input placeholder="scope" value={vScope} onChange={(e) => setVScope(e.target.value)} />
          <input placeholder="reason" value={vReason} onChange={(e) => setVReason(e.target.value)} />
          <RefPicker workspace={ws} value={byRev} onChange={setByRev} allowLive={false} placeholder="by revision (optional)" />
          <button
            disabled={!vScope || !vReason}
            onClick={() =>
              act.run(() =>
                rpc("recordValidity", {
                  rev: r.id,
                  action: vAction,
                  scope: vScope,
                  reason: vReason,
                  by_rev: byRev?.rev,
                  ...(vAction === "restored" ? { restores: prompt("Which decision does this restore? (e.g. retracted, availability_restricted)") ?? "retracted" } : {}),
                }).then(reload),
              )
            }
          >
            Record event
          </button>
        </div>
      </Section>
      <Section title="Governance case" hint="Disputes, plagiarism allegations, priority disputes and appeals. A policy decision is local and never decides mathematical truth.">
        <div className="row wrap">
          <Select value={caseKind} options={["dispute", "plagiarism", "priority", "correction", "moderation", "identity"]} onChange={setCaseKind} />
          <Select value={caseAction} options={["opened", "assessed", "decided_for_policy", "appealed", "reassessed"]} onChange={setCaseAction} />
          <input placeholder="case id (for follow-ups)" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          <input placeholder="reason / allegation" value={caseReason} onChange={(e) => setCaseReason(e.target.value)} />
          <button disabled={!caseReason} onClick={() => act.run(async () => { const res = await rpc("governanceCase", { case_kind: caseKind, action: caseAction, subject_rev: r.id, reason: caseReason, case_id: caseId || undefined }); setCaseId(res.case_id); reload(); })}>
            Record
          </button>
        </div>
      </Section>
      <Section title="Stewardship" hint="Administration of this trajectory; authorship and credit never move with it.">
        <div className="row wrap">
          <select value={steward} onChange={(e) => setSteward(e.target.value)}>
            <option value="">transfer to…</option>
            {(agents ?? []).filter((a: any) => a.kind === "human").map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button disabled={!steward} onClick={() => act.run(() => rpc("proposeStewardship", { entity_id: data.entity.id, to: steward, reason: "proposed from UI" }).then(reload))}>
            Propose transfer
          </button>
          <button className="ghost" onClick={() => act.run(() => rpc("acceptStewardship", { entity_id: data.entity.id }).then(reload))}>
            Accept a transfer offered to me
          </button>
          <button className="ghost" onClick={() => act.run(() => rpc("recoverStewardship", { entity_id: data.entity.id, reason: "steward inactive" }).then(reload))}>
            Recover (owner, inactive steward)
          </button>
        </div>
      </Section>
    </>
  );
}

export { KindBadge };
