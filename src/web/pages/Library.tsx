import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Chip, Empty, ErrorBox, KindBadge, Loading, Section, Time, useRpc } from "../ui.tsx";

const KINDS = ["", "declaration", "object", "method", "argument", "relation", "research", "evaluation", "collection", "context", "source"];

export function LibraryPage() {
  const { ws } = useParams();
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const kind = sp.get("kind") ?? "";
  const [cand, setCand] = useState(false);
  const { data, error } = useRpc("search", { text: q, workspace_id: ws, kind: kind || undefined, include_candidates: cand, limit: 400 });
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="page">
      <h1>Knowledge</h1>
      <div className="row wrap">
        <input placeholder="Search titles and statements…" defaultValue={q} onKeyDown={(e) => e.key === "Enter" && setSp({ q: (e.target as HTMLInputElement).value, kind })} />
        <select value={kind} onChange={(e) => setSp({ q, kind: e.target.value })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k || "all kinds"}
            </option>
          ))}
        </select>
        <label className="small">
          <input type="checkbox" checked={cand} onChange={(e) => setCand(e.target.checked)} /> include candidates (explicitly)
        </label>
        <Link className="button" to={`/w/${ws}/new`}>
          New
        </Link>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="small muted">
            {data.results.length} results · {data.filters.namespace} · {data.note}
          </div>
          {data.results.length === 0 && <Empty>No visible match.</Empty>}
          <table className="list">
            <tbody>
              {data.results.map((r: any) => (
                <tr key={r.entity_id}>
                  <td>
                    <KindBadge kind={r.kind} role={r.role?.split(",")[0]} />
                  </td>
                  <td>
                    <Link to={`/e/${r.entity_id}`}>{r.title}</Link> {r.namespace === "candidate" && <Chip value="candidate" />} {r.fixture_label === "synthetic_product_fixture" && <span className="small muted">synthetic</span>}
                  </td>
                  <td className="small muted">{r.revisions.length ? r.revisions.map((x: any) => `r${x.seq}`).join(" ") : "draft only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function PublicLibrary() {
  const { data, error } = useRpc("publications", {});
  const [sp] = useSearchParams();
  const q = (sp.get("q") ?? "").toLowerCase();
  const { data: search } = useRpc(q ? "search" : null, { text: q });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const pubs = data.filter((p: any) => p.status === "published");
  return (
    <div className="page">
      <h1>Published knowledge</h1>
      <p className="hint">Publications you can read: exact revisions with license and the status snapshot recorded when they were issued. Publication is not approval.</p>
      {q && (
        <Section title={`Search “${q}”`}>
          {(search?.results ?? []).map((r: any) => (
            <div key={r.entity_id}>
              <KindBadge kind={r.kind} /> <Link to={`/e/${r.entity_id}`}>{r.title}</Link>
            </div>
          ))}
          {search && search.results.length === 0 && <Empty>No visible match.</Empty>}
        </Section>
      )}
      {pubs.length === 0 && <Empty>No publication visible to you.</Empty>}
      <div className="cards">
        {pubs.map((p: any) => (
          <Link key={p.id} to={`/pub/${p.id}`} className="card">
            <h3>{p.title ?? p.id}</h3>
            <div className="small">
              {p.revs.length} revisions · {p.license}
            </div>
            <div className="small muted">
              {p.issuer?.name} · <Time at={p.published_at} /> · {p.audience.mode}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
