// Workflow 9 / Q11: context bundle for an obligation with partitions, coverage and omissions.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Chip, ErrorBox, Field, Json, Loading, RevLink, Section, Select, useAction, useRpc, useSession } from "../ui.tsx";

export function BundlePage() {
  const { rev } = useParams();
  const [profile, setProfile] = useState("mathematician");
  const [budget, setBudget] = useState(8000);
  const { agent } = useSession();
  const { data, error } = useRpc("bundle", { rev, profile, budget });
  const [adequate, setAdequate] = useState("");
  const act = useAction();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const parts = ["mandatory", "recommended", "background"];
  return (
    <div className="page">
      <h1>Context bundle</h1>
      <h2>
        <RevLink rev={data.target.rev} title={data.target.title} />
      </h2>
      <p>
        <strong>Closure criterion:</strong> {data.target.closure_criterion}
      </p>
      <div className="row wrap">
        <Field label="Profile">
          <Select value={profile} options={["mathematician", "collaborator", "ai"]} onChange={setProfile} />
        </Field>
        <Field label="Budget (est. tokens)">
          <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </Field>
      </div>
      <div className={`banner ${data.ready ? "" : "withheld"}`}>
        {data.ready ? "Ready" : "Not ready as a single bundle"} · coverage <Chip value={data.coverage} /> — {data.coverage_note}
      </div>
      {data.segments.length > 0 && (
        <Section title="Segments" hint="Mandatory items exceed the budget, so the bundle is segmented instead of silently truncated.">
          {data.segments.map((s: any) => (
            <div key={s.index} className="small">
              Segment {s.index}: {s.items.length} mandatory items, ~{s.tokens} tokens
            </div>
          ))}
        </Section>
      )}
      {parts.map((p) => (
        <Section key={p} title={`${p} (${data.items.filter((i: any) => i.partition === p).length})`}>
          <table className="list">
            <tbody>
              {data.items
                .filter((i: any) => i.partition === p)
                .map((i: any) => (
                  <tr key={i.rev}>
                    <td>
                      <RevLink rev={i.rev} title={i.title} /> <span className="small muted">{i.kind}</span>
                    </td>
                    <td className="small">{i.reason}</td>
                    <td className="small">{i.status && Object.entries(i.status).map(([k, v]) => <Chip key={k} value={String(v)} label={`${k}: ${String(v).replace(/_/g, " ")}`} />)}</td>
                    <td className="small muted">~{i.tokens}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
      ))}
      <Section title={`Omitted (${data.omissions.length})`} hint="Omissions keep a reason and an expansion link; nothing mandatory is dropped silently.">
        {data.omissions.map((o: any, i: number) => (
          <div key={i} className="small">
            {o.rev ? <RevLink rev={o.rev} title={o.title} /> : null} — {o.reason}
          </div>
        ))}
      </Section>
      {data.profile_extras && (
        <Section title="Profile additions">
          <Json value={data.profile_extras} />
        </Section>
      )}
      {agent && (
        <Section title="Fix this bundle as a reproducible collection" hint="A human may declare it adequate for a task — never 'minimal universal context'.">
          <ErrorBox error={act.error} />
          <div className="row">
            <input placeholder="adequate for task… (optional)" value={adequate} onChange={(e) => setAdequate(e.target.value)} />
            <button onClick={() => act.run(async () => nav(`/r/${(await rpc("sealBundle", { rev, profile, budget, declared_adequate_for: adequate || undefined })).rev}`))}>Seal bundle</button>
          </div>
        </Section>
      )}
    </div>
  );
}
