// Candidate inbox (workflows 2 and 15): proposals from agents or manual extraction stay
// outside curated answers until an authorized human records a scoped gate decision.
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Chip, Empty, ErrorBox, Field, Json, KindBadge, Loading, RefPicker, RevLink, Section, Select, Tabs, Time, useAction, useRpc, useSession, type PickedRef } from "../ui.tsx";
import { KindView } from "./KindView.tsx";

export function Candidates() {
  const { ws } = useParams();
  const { data, error, reload } = useRpc("candidateQueue", { workspace_id: ws });
  const [tab, setTab] = useState("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const [batch, setBatch] = useState<string[]>([]);
  const [filter, setFilter] = useState("open");
  const [scope, setScope] = useState("Faithful transcription of the cited source; logical status not evaluated by the curator");
  const act = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const rows = data.filter((c: any) => (filter === "open" ? ["proposed", "under_review"].includes(c.gate.state) : filter === "all" ? true : c.gate.state === filter));
  const sel = data.find((c: any) => c.entity_id === selected);
  return (
    <div className="page">
      <h1>Candidate inbox</h1>
      <p className="hint">
        Candidates are proposals (from AI agents, imports or manual extraction). They never appear in curated answers, dependency claims or impact support. Promotion is an editorial admission in a stated scope — never “true”. Agents cannot gate their own output.
      </p>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "inbox", label: `Inbox (${data.filter((c: any) => ["proposed", "under_review"].includes(c.gate.state)).length} open)` },
          { id: "import", label: "Import literature (extract candidates)" },
        ]}
      />
      <ErrorBox error={act.error} />
      {tab === "import" && <LiteratureImport ws={ws!} onDone={() => (reload(), setTab("inbox"))} />}
      {tab === "inbox" && (
        <div className="split">
          <div>
            <div className="row">
              <Select value={filter} options={["open", "proposed", "under_review", "promoted", "rejected", "quarantined", "all"]} onChange={setFilter} />
              <span className="small muted">{rows.length} shown</span>
            </div>
            {rows.length === 0 && <Empty>Nothing here.</Empty>}
            <table className="list selectable">
              <tbody>
                {rows.map((c: any) => (
                  <tr key={c.entity_id} className={selected === c.entity_id ? "sel" : ""} onClick={() => setSelected(c.entity_id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {["proposed", "under_review"].includes(c.gate.state) && <input type="checkbox" checked={batch.includes(c.rev)} onChange={(e) => setBatch(e.target.checked ? [...batch, c.rev] : batch.filter((x) => x !== c.rev))} />}
                    </td>
                    <td>
                      <KindBadge kind={c.kind} /> {c.title}
                    </td>
                    <td className="small">
                      {c.producer?.name} <Chip value={c.origin ?? "unknown"} />
                    </td>
                    <td>
                      <Chip value={c.gate.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {batch.length > 0 && (
              <div className="batchbar">
                <Field label={`Batch decision for ${batch.length} items — common scope`}>
                  <input value={scope} onChange={(e) => setScope(e.target.value)} />
                </Field>
                <button onClick={() => act.run(() => rpc("promoteBatch", { candidate_revs: batch, scope, decision: "batch admission" }).then(() => (setBatch([]), reload())))}>Promote batch</button>
                <span className="small muted">Uninspected items remain candidates.</span>
              </div>
            )}
          </div>
          <div>{sel ? <CandidateDetail c={sel} reload={reload} /> : <Empty>Select a candidate to inspect its content, targets, sources and state.</Empty>}</div>
        </div>
      )}
    </div>
  );
}

function CandidateDetail({ c, reload }: { c: any; reload: () => void }) {
  const { data: rev } = useRpc("revision", { rev: c.rev });
  const [scope, setScope] = useState("");
  const [decision, setDecision] = useState("admit");
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [fragment, setFragment] = useState<{ text: string; locator: string } | null>(null);
  const act = useAction();
  if (!rev) return <Loading />;
  const open = ["proposed", "under_review"].includes(c.gate.state);
  const promote = (extra: any) => act.run(() => rpc("promote", { candidate_rev: c.rev, scope, decision, ...extra }).then(reload));
  return (
    <div className="detail">
      <h3>
        <KindBadge kind={c.kind} /> {c.title}
      </h3>
      <div className="small muted">
        Produced by {c.producer?.name} ({c.producer?.kind}) · origin {c.origin} · acquisition {c.acquisition} · submitted <Time at={c.submitted_at} />
      </div>
      <ErrorBox error={act.error} />
      <KindView content={rev.content} />
      <details>
        <summary>Provenance</summary>
        <Json value={rev.content?.provenance} />
      </details>
      <h4>Gate history</h4>
      <ul className="small">
        {c.gate.history.map((h: any) => (
          <li key={h.id}>
            <Time at={h.at} /> {h.action} by {h.actor?.name} {h.scope && <>— scope “{h.scope}”</>} {h.reason && <>— {h.reason}</>} {h.curated_rev && <RevLink rev={h.curated_rev} title="curated revision" />}
            {h.independence && <div className="muted">{h.independence}</div>}
          </li>
        ))}
      </ul>
      {open && (
        <>
          <Field label="Decision scope (required)" hint="e.g. faithful import · useful relation · proof claimed by its author">
            <input value={scope} onChange={(e) => setScope(e.target.value)} />
          </Field>
          <Field label="Decision label">
            <input value={decision} onChange={(e) => setDecision(e.target.value)} />
          </Field>
          <div className="row wrap">
            {c.gate.state === "proposed" && (
              <button className="ghost" onClick={() => act.run(() => rpc("gateTransition", { entity_id: c.entity_id, to: "under_review", reason: "inspection started" }).then(reload))}>
                Start review
              </button>
            )}
            <button disabled={!scope} onClick={() => promote({})}>
              Promote as is
            </button>
            <button className="ghost" onClick={() => setEdit(JSON.stringify(rev.content, null, 2))}>
              Edit then promote
            </button>
            <button className="ghost" onClick={() => setFragment({ text: rev.content?.payload?.statement ?? rev.content?.payload?.description ?? "", locator: "" })}>
              Promote a fragment only
            </button>
          </div>
          {edit !== null && (
            <div>
              <textarea className="raw" rows={14} value={edit} onChange={(e) => setEdit(e.target.value)} />
              <button disabled={!scope} onClick={() => promote({ edited_content: JSON.parse(edit) })}>
                Promote edited content (both contributions recorded)
              </button>
            </div>
          )}
          {fragment && (
            <div>
              <Field label="Accepted fragment (only this becomes curated; the rest stays a candidate)">
                <textarea rows={3} value={fragment.text} onChange={(e) => setFragment({ ...fragment, text: e.target.value })} />
              </Field>
              <Field label="Fragment locator">
                <input value={fragment.locator} onChange={(e) => setFragment({ ...fragment, locator: e.target.value })} placeholder="e.g. sentence 1" />
              </Field>
              <button
                disabled={!scope || !fragment.locator}
                onClick={() => {
                  const content = { ...rev.content, payload: { ...rev.content.payload, ...(rev.content.payload.statement !== undefined ? { statement: fragment.text } : { description: fragment.text }) } };
                  promote({ fragment: { content, locator: fragment.locator } });
                }}
              >
                Promote fragment
              </button>
            </div>
          )}
          <div className="row">
            <input placeholder="reason (required to reject/quarantine)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="ghost" disabled={!reason} onClick={() => act.run(() => rpc("gateTransition", { entity_id: c.entity_id, to: "rejected", reason }).then(reload))}>
              Reject
            </button>
            <button className="ghost" disabled={!reason} onClick={() => act.run(() => rpc("gateTransition", { entity_id: c.entity_id, to: "quarantined", reason }).then(reload))}>
              Quarantine
            </button>
          </div>
        </>
      )}
      {["rejected", "quarantined"].includes(c.gate.state) && (
        <div className="row">
          <input placeholder="reason for reopening" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button disabled={!reason} onClick={() => act.run(() => rpc("gateTransition", { entity_id: c.entity_id, to: "under_review", reason }).then(reload))}>
            Return to review
          </button>
        </div>
      )}
    </div>
  );
}

/** Workflow 2: register a source, paste its text, select spans and extract them as candidates with locators. */
function LiteratureImport({ ws, onDone }: { ws: string; onDone: () => void }) {
  const { vocab } = useSession();
  const [source, setSource] = useState<PickedRef | null>(null);
  const [newSource, setNewSource] = useState({ citation: "", edition: "", url: "", rights: "unknown" });
  const [text, setText] = useState("");
  const [extracts, setExtracts] = useState<{ text: string; locator: string; kind: string; category: string; title: string }[]>([]);
  const { data: wsData } = useRpc("workspace", { workspace_id: ws });
  const area = useRef<HTMLTextAreaElement>(null);
  const act = useAction();
  void vocab;
  const addSelection = () => {
    const el = area.current;
    if (!el) return;
    const s = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    if (!s) return;
    setExtracts([...extracts, { text: s, locator: `chars ${el.selectionStart}–${el.selectionEnd}`, kind: "declaration", category: "propositional", title: s.slice(0, 60) }]);
  };
  const covered = extracts.reduce((n, e) => n + e.text.length, 0);
  return (
    <Section title="Import literature" hint="Register the exact source and its rights, paste the passage you consulted, select fragments with meaning of their own and extract them as candidates. Nothing becomes curated without review; unstructured text stays narrative.">
      <ErrorBox error={act.error} />
      <div className="grid2">
        <div>
          <Field label="Existing source record">
            <RefPicker workspace={ws} value={source} onChange={setSource} kinds={["source"]} allowLive={false} />
          </Field>
          {!source && (
            <div className="row wrap">
              <Field label="…or new source: citation">
                <input value={newSource.citation} onChange={(e) => setNewSource({ ...newSource, citation: e.target.value })} />
              </Field>
              <Field label="Edition">
                <input value={newSource.edition} onChange={(e) => setNewSource({ ...newSource, edition: e.target.value })} />
              </Field>
              <Field label="URL">
                <input value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} />
              </Field>
              <Field label="Rights">
                <select value={newSource.rights} onChange={(e) => setNewSource({ ...newSource, rights: e.target.value })}>
                  <option value="unknown">unknown (no republication)</option>
                  <option value="known">known (permission recorded)</option>
                </select>
              </Field>
              <button
                disabled={!newSource.citation}
                onClick={() =>
                  act.run(async () => {
                    const r = await rpc("createAndSeal", {
                      workspace_id: ws,
                      kind: "source",
                      title: newSource.citation.slice(0, 80),
                      content: {
                        context: { rev: wsData.workspace.root_context_rev },
                        payload: { source_kind: "paper", citation: newSource.citation, edition: newSource.edition || undefined, url: newSource.url || undefined, retrieved_at: new Date().toISOString().slice(0, 10), rights: { status: newSource.rights }, availability: "available", revision_identity: newSource.edition ? { status: "exact", value: newSource.edition } : { status: "unknown", reason: "edition not recorded at import" } },
                        provenance: { origin: "human", acquisition: "import", original_attribution: `Bibliographic record: ${newSource.citation}` },
                      },
                    });
                    setSource({ rev: r.rev, title: newSource.citation });
                  })
                }
              >
                Register source
              </button>
            </div>
          )}
          <Field label="Passage (plain text or LaTeX)">
            <textarea ref={area} rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the consulted passage. Select a fragment and press 'Extract selection'." />
          </Field>
          <button className="ghost" onClick={addSelection}>
            Extract selection
          </button>
          <div className="small muted">Structured coverage: {text.length ? Math.round((100 * covered) / text.length) : 0}% of the passage (the rest stays unstructured, declared partial).</div>
        </div>
        <div>
          <h4>Extracted fragments ({extracts.length})</h4>
          {extracts.map((x, i) => (
            <div key={i} className="extract">
              <div className="row wrap">
                <input value={x.title} onChange={(e) => setExtracts(extracts.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
                <select value={`${x.kind}:${x.category}`} onChange={(e) => {
                  const [kind, category] = e.target.value.split(":");
                  setExtracts(extracts.map((y, j) => (j === i ? { ...y, kind, category } : y)));
                }}>
                  <option value="declaration:propositional">statement</option>
                  <option value="declaration:definitional">definition</option>
                  <option value="object:">object</option>
                  <option value="method:">method</option>
                </select>
                <input value={x.locator} onChange={(e) => setExtracts(extracts.map((y, j) => (j === i ? { ...y, locator: e.target.value } : y)))} />
                <button className="link small" onClick={() => setExtracts(extracts.filter((_, j) => j !== i))}>
                  remove
                </button>
              </div>
              <div className="small">{x.text}</div>
            </div>
          ))}
          <button
            disabled={!source?.rev || !extracts.length}
            onClick={() =>
              act.run(async () => {
                for (const x of extracts)
                  await rpc("submitCandidate", {
                    workspace_id: ws,
                    kind: x.kind,
                    title: x.title,
                    content: {
                      context: { rev: wsData.workspace.root_context_rev },
                      payload: x.kind === "declaration" ? { category: x.category, statement: x.text } : { description: x.text },
                      provenance: { origin: "human", acquisition: "extraction", sources: [{ source: { rev: source!.rev }, locator: x.locator }], original_attribution: "authors of the source (see source record)" },
                    },
                  });
                setExtracts([]);
                onDone();
              })
            }
          >
            Send {extracts.length} fragment(s) to the candidate inbox
          </button>
        </div>
      </div>
    </Section>
  );
}
