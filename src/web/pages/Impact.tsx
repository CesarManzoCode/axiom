// Workflow 12 / Q06: choose a change event, compute typed impact, inspect routes and open
// re-evaluation obligations. "Definitely affected" names what changed — never "false".
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Chip, Empty, ErrorBox, Field, Loading, RefPicker, RevLink, Section, Select, useAction, useRpc, type PickedRef } from "../ui.tsx";

export function ImpactPage() {
  const [sp, setSp] = useSearchParams();
  const rev = sp.get("rev");
  const change = sp.get("change") ?? "retracted";
  const newRev = sp.get("new") ?? undefined;
  const budget = Number(sp.get("budget") ?? 6);
  const candidates = sp.get("cand") === "1";
  const { data: revInfo } = useRpc(rev ? "revision" : null, { rev });
  const { data, error, loading } = useRpc(rev ? "impact" : null, { rev, change, new_rev: newRev, budget, include_candidates: candidates });
  const [pick, setPick] = useState<PickedRef | null>(null);
  const [newPick, setNewPick] = useState<PickedRef | null>(null);
  const nav = useNavigate();
  const act = useAction();
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };
  const openObligation = (rec: any) =>
    act.run(async () => {
      const ws = revInfo && (await rpc("entity", { entity_id: revInfo.entity_id })).entity.workspace_id;
      const r = await rpc("createAndSeal", {
        workspace_id: ws,
        kind: "research",
        title: `Re-evaluate ${rec.target.title} (${rec.dimension})`,
        content: {
          context: { rev: revInfo.context.rev },
          payload: { role: "obligation", goal: `Re-evaluate ${rec.dimension} of "${rec.target.title}" after ${change} of "${revInfo.title}". Reason: ${rec.reason}`, target: { rev: rec.target.rev }, closure_criterion: "A new assessment of the affected dimension citing this obligation's analysis" },
          provenance: { origin: "human", acquisition: "authorship" },
        },
      });
      nav(`/r/${r.rev}`);
    });
  return (
    <div className="page">
      <h1>Impact analysis</h1>
      <p className="hint">A bounded, typed traversal of recorded relations. Each consumer comes with its route, rule and reason. Citations only raise source alerts; alternative accepted support stops propagation; unknown is reported, not hidden.</p>
      <ErrorBox error={error ?? act.error} />
      <div className="row wrap">
        <Field label="Changed revision">{rev && revInfo ? <RevLink rev={rev} title={revInfo.title} seq={revInfo.seq} /> : <RefPicker value={pick} onChange={(p) => (setPick(p), p?.rev && update({ rev: p.rev }))} allowLive={false} />}</Field>
        <Field label="Event">
          <Select value={change} options={["retracted", "refuted", "defect", "new_revision", "context_changed"]} onChange={(x) => update({ change: x })} />
        </Field>
        {change === "new_revision" && (
          <Field label="New revision">
            <RefPicker value={newPick} onChange={(p) => (setNewPick(p), update({ new: p?.rev }))} allowLive={false} />
          </Field>
        )}
        <Field label="Depth budget">
          <input type="number" min={1} max={20} value={budget} onChange={(e) => update({ budget: e.target.value })} />
        </Field>
        <label className="small">
          <input type="checkbox" checked={candidates} onChange={(e) => update({ cand: e.target.checked ? "1" : undefined })} /> include candidates
        </label>
        {rev && (
          <button className="link" onClick={() => update({ rev: undefined })}>
            choose another
          </button>
        )}
      </div>
      {loading && <Loading what="Computing" />}
      {data && (
        <>
          <div className="small muted">
            Scope: policy {data.scope.policy} · cut {data.scope.cut} · {data.scope.namespace} · budget {data.scope.budget} · visited {data.coverage.visited}
          </div>
          {[
            ["definitely_affected", "Definitely affected — a registered condition of the consumer changed (not 'false')"],
            ["possibly_affected", "Possibly affected — informal/inferred use, unevaluated bridge, or editorial membership"],
            ["unknown", "Unknown / not evaluated — budget or unexamined frontier"],
            ["evaluated_unaffected", "Evaluated unaffected — with a reason"],
          ].map(([key, label]) => (
            <Section key={key} title={`${label} (${data[key].length})`}>
              {data[key].length === 0 && <Empty>None.</Empty>}
              <table className="list">
                <tbody>
                  {data[key].map((rec: any, i: number) => (
                    <tr key={i}>
                      <td>
                        <RevLink rev={rec.target.rev} title={rec.target.title} /> <span className="small muted">{rec.target.kind}</span>
                      </td>
                      <td>
                        <Chip value={rec.dimension.replace(/ /g, "_")} label={rec.dimension} />
                      </td>
                      <td className="small">
                        <code>{rec.rule}</code> {rec.reason}
                        {rec.limitations.length > 0 && <div className="muted">{rec.limitations.join(" ")}</div>}
                        <div className="route">
                          route:{" "}
                          {rec.route.map((h: any, j: number) => (
                            <span key={j}>
                              {j > 0 && " → "}
                              {h.via}
                              {h.role ? `/${h.role}` : ""}
                              {h.contract ? `[${h.contract}]` : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {key !== "evaluated_unaffected" && (
                          <button className="small ghost" onClick={() => openObligation(rec)}>
                            open re-evaluation obligation
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))}
          {data.update_notices.length > 0 && (
            <Section title={`Update notices (${data.update_notices.length})`} hint="Consumers keep their pinned revision; nothing is rewritten.">
              {data.update_notices.map((n: any, i: number) => (
                <div key={i} className="small">
                  <RevLink rev={n.consumer.rev} title={n.consumer.title} /> ({n.via}) — {n.effect} {n.migration_obligations.map((m: string) => <div key={m}>• {m}</div>)} {n.migration_notes.map((m: string) => <div key={m}>• {m}</div>)}
                </div>
              ))}
            </Section>
          )}
          <Section title="Coverage and stops">
            <ul className="small">
              {data.coverage.limitations.map((l: string) => (
                <li key={l}>{l}</li>
              ))}
              {data.coverage.stops.map((s: any, i: number) => (
                <li key={i}>
                  stop at <RevLink rev={s.at} title="item" />: {s.reason}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
