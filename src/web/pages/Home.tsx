import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { rpc, setToken } from "../api.ts";
import { ErrorBox, Field, Section, useAction, useRpc, useSession, Empty } from "../ui.tsx";

export function Home() {
  const { agent } = useSession();
  const { data: workspaces, reload } = useRpc(agent ? "myWorkspaces" : null, {}, [agent?.id]);
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("classical_informal");
  const { run, error, busy } = useAction();
  if (!agent)
    return (
      <div className="page narrow">
        <h1>A research workspace for attributed, revisioned mathematical knowledge</h1>
        <p>
          Write narrative and statements, reuse exact revisions, keep proofs, reviews and failed attempts with their scope, see what a change affects, and publish only what you choose.
        </p>
        <p>
          <Link to="/login" className="button">
            Sign in
          </Link>{" "}
          or browse <Link to="/library">published knowledge</Link>.
        </p>
      </div>
    );
  return (
    <div className="page">
      <h1>Your workspaces</h1>
      {workspaces?.length === 0 && <Empty>No workspace yet.</Empty>}
      <div className="cards">
        {workspaces?.map((w: any) => (
          <Link key={w.id} to={`/w/${w.id}`} className="card">
            <h3>{w.name}</h3>
            <p className="small">{w.description}</p>
            <div className="small muted">your roles: {w.roles.join(", ")}</div>
          </Link>
        ))}
      </div>
      <Section title="Start a new research workspace" hint="Workflow 1: you become owner; content is private to the team by default. A root context is created automatically and declares an interpretation profile — not a consistency claim.">
        <ErrorBox error={error} />
        <div className="row">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lower bounds for ACC circuits" />
          </Field>
          <Field label="Initial context profile">
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="classical_informal">Classical informal mathematics</option>
              <option value="unknown">Unknown (explicitly marked)</option>
            </select>
          </Field>
          <button
            disabled={!name || busy}
            onClick={() =>
              run(async () => {
                const r = await rpc("createWorkspace", { name, profile });
                reload();
                nav(`/w/${r.workspace_id}`);
              })
            }
          >
            Create
          </button>
        </div>
      </Section>
    </div>
  );
}

export function Login() {
  const { refresh } = useSession();
  const nav = useNavigate();
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const { run, error, busy } = useAction();
  const submit = () =>
    run(async () => {
      const r = mode === "login" ? await rpc("login", { handle, password }) : await rpc("register", { handle, password, name });
      setToken(r.token);
      refresh();
      nav("/");
    });
  return (
    <div className="page narrow">
      <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>
      <ErrorBox error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Handle">
          <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" />
        </Field>
        {mode === "register" && (
          <Field label="Display name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <button disabled={busy}>{mode === "login" ? "Sign in" : "Register"}</button>{" "}
        <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Create an account instead" : "I already have an account"}
        </button>
      </form>
      <p className="hint">Demo seed accounts: ana (owner), ben (editor), rita (curator/publisher) — password “axiom-demo”.</p>
    </div>
  );
}
