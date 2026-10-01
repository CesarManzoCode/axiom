import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { rpc, setToken, getToken } from "./api.ts";
import { SessionCtx, useRpc, useSession, Loading, ErrorBox } from "./ui.tsx";
import { Home, Login } from "./pages/Home.tsx";
import { WorkspaceHome, Governance } from "./pages/Workspace.tsx";
import { Cockpit } from "./pages/Research.tsx";
import { EntityPage } from "./pages/Entity.tsx";
import { DraftEditor, NewItem } from "./pages/Draft.tsx";
import { Candidates } from "./pages/Candidates.tsx";
import { PublishPage, PublicationPage } from "./pages/Publish.tsx";
import { ImpactPage } from "./pages/Impact.tsx";
import { BundlePage } from "./pages/Bundle.tsx";
import { ComparePage } from "./pages/Compare.tsx";
import { LibraryPage, PublicLibrary } from "./pages/Library.tsx";
import { ExportPage } from "./pages/Export.tsx";

export function App() {
  const [agent, setAgent] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [vocab, setVocab] = useState<any>(null);
  const refresh = useCallback(() => {
    rpc("me")
      .then((r) => setAgent(r.agent))
      .catch(() => setAgent(null))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    refresh();
    rpc("vocabulary").then(setVocab).catch(() => {});
  }, [refresh]);
  if (!ready) return <Loading />;
  return (
    <SessionCtx.Provider value={{ agent, refresh, vocab }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/library" element={<PublicLibrary />} />
          <Route path="/pub/:id" element={<PublicationPage />} />
          <Route path="/w/:ws" element={<WorkspaceHome />} />
          <Route path="/w/:ws/research" element={<Cockpit />} />
          <Route path="/w/:ws/library" element={<LibraryPage />} />
          <Route path="/w/:ws/new" element={<NewItem />} />
          <Route path="/w/:ws/candidates" element={<Candidates />} />
          <Route path="/w/:ws/publish" element={<PublishPage />} />
          <Route path="/w/:ws/governance" element={<Governance />} />
          <Route path="/w/:ws/export" element={<ExportPage />} />
          <Route path="/draft/:id" element={<DraftEditor />} />
          <Route path="/e/:id" element={<EntityPage />} />
          <Route path="/r/:rev" element={<RevRedirect />} />
          <Route path="/impact" element={<ImpactPage />} />
          <Route path="/bundle/:rev" element={<BundlePage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Shell>
    </SessionCtx.Provider>
  );
}

function RevRedirect() {
  const { rev } = useParams();
  const { data, error } = useRpc("revision", { rev });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return <Navigate replace to={`/e/${data.entity_id}?rev=${data.id}`} />;
}

function currentWorkspace(pathname: string): string | null {
  const m = pathname.match(/^\/w\/([^/]+)/);
  if (m) return m[1];
  try {
    return localStorage.getItem("axiom.ws");
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const { agent, refresh } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const ws = currentWorkspace(loc.pathname);
  useEffect(() => {
    const m = loc.pathname.match(/^\/w\/([^/]+)/);
    if (m)
      try {
        localStorage.setItem("axiom.ws", m[1]);
      } catch {
        /* ignore */
      }
  }, [loc.pathname]);
  const { data: workspaces } = useRpc(agent ? "myWorkspaces" : null, {}, [agent?.id]);
  const { data: notes, reload: reloadNotes } = useRpc(agent ? "notifications" : null, {}, [agent?.id, loc.pathname]);
  const unread = (notes ?? []).filter((n: any) => !n.read).length;
  const [showNotes, setShowNotes] = useState(false);
  const wsInfo = workspaces?.find((w: any) => w.id === ws);
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Axiom
        </Link>
        {agent && workspaces && (
          <select className="wsselect" value={wsInfo ? ws! : ""} onChange={(e) => e.target.value && nav(`/w/${e.target.value}`)}>
            <option value="">Choose workspace…</option>
            {workspaces.map((w: any) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            nav(wsInfo ? `/w/${ws}/library?q=${encodeURIComponent(String(q))}` : `/library?q=${encodeURIComponent(String(q))}`);
          }}
        >
          <input name="q" placeholder={wsInfo ? "Search this workspace…" : "Search published knowledge…"} />
        </form>
        <span className="spacer" />
        <Link to="/library">Published</Link>
        {agent ? (
          <>
            <button className="bell" onClick={() => setShowNotes(!showNotes)} title="Notifications">
              ◔ {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            <span className="who" title={agent.id}>
              {agent.name}
            </span>
            <button
              className="link"
              onClick={() => {
                const t = getToken();
                if (t) rpc("logout", { token: t }).catch(() => {});
                setToken(null);
                refresh();
                nav("/");
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link to="/login">Sign in</Link>
        )}
      </header>
      {showNotes && (
        <div className="notes">
          <header>
            <strong>Notifications</strong>
            <button className="link" onClick={() => rpc("markNotificationsRead").then(reloadNotes)}>
              mark all read
            </button>
          </header>
          {(notes ?? []).length === 0 && <p className="muted">Nothing new.</p>}
          {(notes ?? []).map((n: any) => (
            <div key={n.id} className={`note ${n.read ? "" : "unread"}`}>
              <div className="small muted">{n.kind.replace(/_/g, " ")}</div>
              {n.kind === "update_available" ? (
                <div>
                  <Link to={`/r/${n.payload.consumer_rev}`}>{n.payload.consumer_title}</Link> pins an older revision.{" "}
                  <Link to={`/compare?old=${n.payload.pinned_rev}&new=${n.payload.new_rev}`} onClick={() => setShowNotes(false)}>
                    Compare
                  </Link>
                  <div className="small muted">{n.payload.message}</div>
                </div>
              ) : (
                <div className="small">{n.payload.reason ?? JSON.stringify(n.payload)}</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="body">
        {wsInfo && (
          <nav className="sidenav">
            <div className="wsname">{wsInfo.name}</div>
            <div className="small muted">{wsInfo.roles.join(", ")}</div>
            <NavLink end to={`/w/${ws}`}>
              Overview
            </NavLink>
            <NavLink to={`/w/${ws}/research`}>Research cockpit</NavLink>
            <NavLink to={`/w/${ws}/library`}>Knowledge</NavLink>
            <NavLink to={`/w/${ws}/new`}>Write something new</NavLink>
            <NavLink to={`/w/${ws}/candidates`}>Candidate inbox</NavLink>
            <NavLink to={`/w/${ws}/publish`}>Publish</NavLink>
            <NavLink to={`/w/${ws}/governance`}>Members &amp; governance</NavLink>
            <NavLink to={`/w/${ws}/export`}>Export / import</NavLink>
          </nav>
        )}
        <main>{children}</main>
      </div>
    </div>
  );
}
