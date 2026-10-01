import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Empty, ErrorBox, Field, KindBadge, Loading, Section, Time, useAction, useRpc, useSession, Json } from "../ui.tsx";

export function WorkspaceHome() {
  const { ws } = useParams();
  const { data, error } = useRpc("workspace", { workspace_id: ws });
  const { data: drafts } = useRpc("myDrafts", { workspace_id: ws });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const curated = data.counts.filter((c: any) => c.namespace === "curated");
  const candidates = data.counts.filter((c: any) => c.namespace === "candidate").reduce((s: number, c: any) => s + c.n, 0);
  return (
    <div className="page">
      <h1>{data.workspace.name}</h1>
      <p>{data.workspace.description}</p>
      <div className="row wrap">
        <Link className="button" to={`/w/${ws}/new`}>
          Write something new
        </Link>
        <Link className="button ghost" to={`/w/${ws}/research`}>
          Open research cockpit
        </Link>
        <Link className="button ghost" to={`/r/${data.workspace.root_context_rev}`}>
          Root context
        </Link>
      </div>
      <div className="grid2">
        <Section title="What is here">
          <ul className="counts">
            {curated.map((c: any) => (
              <li key={c.kind}>
                <Link to={`/w/${ws}/library?kind=${c.kind}`}>
                  <KindBadge kind={c.kind} /> {c.n}
                </Link>
              </li>
            ))}
            <li>
              <Link to={`/w/${ws}/candidates`}>
                <span className="kind kind-candidate">candidates</span> {candidates}
              </Link>{" "}
              <span className="muted small">(outside curated answers)</span>
            </li>
          </ul>
        </Section>
        <Section title="Open drafts" hint="Drafts are editable working copies; they are never citable.">
          {(drafts ?? []).length === 0 && <Empty>No open drafts.</Empty>}
          <ul className="plain">
            {(drafts ?? []).map((d: any) => (
              <li key={d.id}>
                <Link to={`/draft/${d.id}`}>{d.title}</Link> <KindBadge kind={d.kind} /> <span className="muted small">{d.author?.name} · <Time at={d.updated_at} /></span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section title="Recent activity" hint="Append-only events with their actors; only events you are allowed to see.">
        <table className="list">
          <tbody>
            {data.recent.map((e: any) => (
              <tr key={e.id}>
                <td className="small muted">
                  <Time at={e.recorded_at} />
                </td>
                <td>{e.kind.replace(/_/g, " ")}</td>
                <td>{e.subject_entity ? <Link to={`/e/${e.subject_entity}`}>{e.subject_title}</Link> : null}</td>
                <td className="small">{e.actor}</td>
                <td className="small muted">{Object.entries(e.payload).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function Governance() {
  const { ws } = useParams();
  const { vocab } = useSession();
  const { data, error, reload } = useRpc("workspace", { workspace_id: ws });
  const { data: agents } = useRpc("agents", {});
  const [agentId, setAgentId] = useState("");
  const [roles, setRoles] = useState<string[]>(["reader"]);
  const [aiName, setAiName] = useState("");
  const [aiToken, setAiToken] = useState<any>(null);
  const [aliasA, setAliasA] = useState("");
  const [aliasB, setAliasB] = useState("");
  const [aliasReason, setAliasReason] = useState("");
  const [contract, setContract] = useState({ id: "", version: "1", description: "", roles: "subject:1:*\ntarget:1:*" });
  const act = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const isOwner = data.my_roles.includes("owner");
  return (
    <div className="page">
      <h1>Members &amp; governance</h1>
      <ErrorBox error={act.error} />
      <Section title="Members and roles" hint="Roles are capabilities, not mathematical authority. Grants and revocations are recorded events; revoking cuts future access only.">
        <table className="list">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Kind</th>
              <th>Roles</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.members.map((m: any) => (
              <tr key={m.agent.id} className={m.active ? "" : "muted"}>
                <td>{m.agent.name}</td>
                <td>{m.agent.kind}</td>
                <td>{m.roles.join(", ")}</td>
                <td className="small">
                  <Time at={m.since} />
                </td>
                <td>
                  {isOwner && m.active && (
                    <button className="link" onClick={() => act.run(() => rpc("revokeMember", { workspace_id: ws, agent_id: m.agent.id, reason: "revoked from UI" }).then(reload))}>
                      revoke
                    </button>
                  )}
                  {!m.active && "revoked"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isOwner && (
          <div className="row wrap">
            <Field label="Agent">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">choose…</option>
                {(agents ?? []).map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.kind}
                    {a.handle ? ` @${a.handle}` : ""})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Roles">
              <select multiple value={roles} onChange={(e) => setRoles([...e.target.selectedOptions].map((o) => o.value))} size={4}>
                {(vocab?.roles ?? []).map((r: string) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <button disabled={!agentId} onClick={() => act.run(() => rpc("addMember", { workspace_id: ws, agent_id: agentId, roles }).then(reload))}>
              Grant
            </button>
          </div>
        )}
      </Section>
      <Section title="Register an AI agent" hint="The agent receives its own credential. It can submit candidates to the inbox; it can never gate, promote or publish. You are recorded as its operator.">
        <div className="row">
          <Field label="Agent name">
            <input value={aiName} onChange={(e) => setAiName(e.target.value)} placeholder="e.g. Extraction assistant" />
          </Field>
          <button disabled={!aiName} onClick={() => act.run(async () => setAiToken(await rpc("createAiAgent", { name: aiName })))}>
            Register
          </button>
        </div>
        {aiToken && (
          <div className="notice">
            Agent <code>{aiToken.agent_id}</code> token (shown once): <code>{aiToken.token}</code>. Add it as a member (reader) to let it submit candidates via <code>POST /api/rpc/submitCandidate</code>.
          </div>
        )}
      </Section>
      <Section title="Identity overlay (aliases)" hint="A reversible curatorial overlay: anchors, revisions and citations keep resolving to their own content. Equivalence never merges identities.">
        <div className="row wrap">
          <Field label="Entity A (ID)">
            <input value={aliasA} onChange={(e) => setAliasA(e.target.value)} />
          </Field>
          <Field label="Entity B (ID)">
            <input value={aliasB} onChange={(e) => setAliasB(e.target.value)} />
          </Field>
          <Field label="Reason">
            <input value={aliasReason} onChange={(e) => setAliasReason(e.target.value)} />
          </Field>
          <button disabled={!aliasA || !aliasB || !aliasReason} onClick={() => act.run(() => rpc("decideAlias", { workspace_id: ws, entities: [aliasA, aliasB], reason: aliasReason }).then(() => alert("Overlay recorded")))}>
            Record overlay
          </button>
        </div>
      </Section>
      <Section title="Extension relation contracts" hint="A new contract declares roles and cardinalities. It carries no inference rule: consumers can navigate it but nothing is inferred from its name. Contract revisions are immutable.">
        <div className="row wrap">
          <Field label="id">
            <input value={contract.id} onChange={(e) => setContract({ ...contract, id: e.target.value })} placeholder="snake_case" />
          </Field>
          <Field label="version">
            <input value={contract.version} onChange={(e) => setContract({ ...contract, version: e.target.value })} />
          </Field>
          <Field label="description">
            <input value={contract.description} onChange={(e) => setContract({ ...contract, description: e.target.value })} />
          </Field>
          <Field label="roles (role:min:max per line, * = unbounded)">
            <textarea rows={3} value={contract.roles} onChange={(e) => setContract({ ...contract, roles: e.target.value })} />
          </Field>
          <button
            disabled={!contract.id || !contract.description}
            onClick={() =>
              act.run(() =>
                rpc("registerContract", {
                  workspace_id: ws,
                  id: contract.id,
                  version: contract.version,
                  description: contract.description,
                  roles: contract.roles
                    .split("\n")
                    .filter(Boolean)
                    .map((l) => {
                      const [role, min, max] = l.split(":");
                      return { role, card: { min: Number(min), max: max === "*" ? null : Number(max) } };
                    }),
                }).then(() => alert("Contract registered")),
              )
            }
          >
            Register contract
          </button>
        </div>
        <details>
          <summary>Current contract catalog</summary>
          <Json value={(vocab?.contracts ?? []).map((c: any) => `${c.id}@${c.version} — ${c.roles.map((r: any) => `${r.role}[${r.card.min}..${r.card.max ?? "n"}]`).join(", ")}`)} />
        </details>
      </Section>
      <p className="hint">Disputes, appeals, retractions, moderation, stewardship transfers and identity disputes are recorded from the record they concern (entity page → Act).</p>
    </div>
  );
}
