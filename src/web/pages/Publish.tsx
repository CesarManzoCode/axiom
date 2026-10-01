// Selective publication (workflow 14): choose exact revisions, preview the exposure closure,
// resolve conflicts, then publish (optionally under an embargo that needs explicit release).
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Chip, Empty, ErrorBox, ExposureReport, Field, Json, Loading, RefPicker, RevLink, Section, Time, useAction, useRpc, type PickedRef } from "../ui.tsx";

export function PublishPage() {
  const { ws } = useParams();
  const [sp] = useSearchParams();
  const [items, setItems] = useState<{ rev: string; title?: string }[]>([]);
  const [pick, setPick] = useState<PickedRef | null>(null);
  const [mode, setMode] = useState("public");
  const [named, setNamed] = useState<string[]>([]);
  const [license, setLicense] = useState("CC BY 4.0");
  const [title, setTitle] = useState("");
  const [embargo, setEmbargo] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [rights, setRights] = useState(false);
  const [exposure, setExposure] = useState<any>(null);
  const { data: pubs, reload } = useRpc("publications", { workspace_id: ws });
  const { data: agents } = useRpc("agents", {});
  const act = useAction();
  useEffect(() => {
    const r = sp.get("rev");
    if (r) rpc("revision", { rev: r }).then((x) => setItems([{ rev: x.id, title: `${x.title} · r${x.seq}` }]));
  }, [sp]);
  const audience = mode === "named" ? { mode, agents: named } : { mode };
  const revs = items.map((i) => i.rev);
  const preview = () => act.run(async () => setExposure(await rpc("exposurePreview", { revs, audience })));
  return (
    <div className="page">
      <h1>Publish</h1>
      <p className="hint">
        Publication fixes exact sealed revisions for an audience. It is not approval: status stays attributed. Everything the selection needs for interpretation must already be readable by the audience or be included; private lineage and raw inputs are never exposed.
      </p>
      <ErrorBox error={act.error} />
      <Section title="1 · Selection">
        {items.length === 0 && <Empty>Nothing selected.</Empty>}
        <ul>
          {items.map((i) => (
            <li key={i.rev}>
              <RevLink rev={i.rev} title={i.title} />{" "}
              <button className="link small" onClick={() => (setItems(items.filter((x) => x.rev !== i.rev)), setExposure(null))}>
                remove
              </button>
            </li>
          ))}
        </ul>
        <RefPicker
          workspace={ws}
          value={pick}
          allowLive={false}
          onChange={(p) => {
            if (p?.rev && !revs.includes(p.rev)) setItems([...items, { rev: p.rev, title: `${p.title} · r${p.seq}` }]);
            setPick(null);
            setExposure(null);
          }}
          placeholder="Add an exact revision…"
        />
      </Section>
      <Section title="2 · Audience, license, embargo">
        <div className="row wrap">
          <Field label="Audience">
            <select value={mode} onChange={(e) => (setMode(e.target.value), setExposure(null))}>
              <option value="public">Public</option>
              <option value="team">Team (all workspace members)</option>
              <option value="named">Named recipients</option>
            </select>
          </Field>
          {mode === "named" && (
            <Field label="Recipients">
              <select multiple size={4} value={named} onChange={(e) => setNamed([...e.target.selectedOptions].map((o) => o.value))}>
                {(agents ?? []).filter((a: any) => a.kind === "human").map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="License / policy">
            <input value={license} onChange={(e) => setLicense(e.target.value)} />
          </Field>
          <Field label="Package title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Embargo until (optional)" hint="Release requires prior authorization and re-validates exposure.">
            <input type="datetime-local" value={embargo} onChange={(e) => setEmbargo(e.target.value)} />
          </Field>
          {embargo && (
            <label className="small">
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} /> authorize release at that date
            </label>
          )}
          {mode === "public" && (
            <label className="small">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I confirm imported material is exposed only as citation/paraphrase or with permission
            </label>
          )}
        </div>
      </Section>
      <Section title="3 · Exposure closure (what this would reveal)">
        <button className="ghost" disabled={!items.length} onClick={preview}>
          Preview exposure
        </button>
        {exposure && <ExposureReport exposure={exposure} />}
        {exposure?.conflicts?.some((c: any) => c.rev) && (
          <button
            className="small ghost"
            onClick={() => {
              const add = exposure.conflicts.filter((c: any) => c.rev && !revs.includes(c.rev)).map((c: any) => ({ rev: c.rev, title: c.title }));
              setItems([...items, ...add.filter((a: any, i: number, arr: any[]) => arr.findIndex((b) => b.rev === a.rev) === i)]);
              setExposure(null);
            }}
          >
            Include the referenced items in this publication
          </button>
        )}
      </Section>
      <button
        className="primary"
        disabled={!items.length || !license}
        onClick={() =>
          act.run(async () => {
            await rpc("publish", { workspace_id: ws, revs, audience, license, title: title || undefined, rights_confirmed: rights, embargo: embargo ? { release_at: new Date(embargo).toISOString(), release_authorized: authorized } : undefined, idem_key: `ui:${revs.join(",")}:${mode}:${license}:${embargo}` });
            setItems([]);
            setExposure(null);
            reload();
          })
        }
      >
        Publish
      </button>
      <Section title="Publications of this workspace" actions={<button className="small ghost" onClick={() => act.run(() => rpc("processEmbargoes").then(reload))}>Process due embargoes</button>}>
        <table className="list">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Audience</th>
              <th>Items</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(pubs ?? []).map((p: any) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/pub/${p.id}`}>{p.title ?? p.id}</Link>
                </td>
                <td>
                  <Chip value={p.status} />
                  {p.embargo && <div className="small muted">embargo {p.embargo.release_at} · {p.embargo.release_authorized ? "release authorized" : "release NOT authorized"}</div>}
                </td>
                <td>{p.audience.mode}</td>
                <td>{p.revs.length}</td>
                <td className="small">
                  <Time at={p.published_at ?? p.created_at} />
                </td>
                <td>
                  {["scheduled", "blocked"].includes(p.status) && (
                    <>
                      <button className="small ghost" onClick={() => act.run(() => rpc("authorizeRelease", { publication_id: p.id, authorized: !p.embargo?.release_authorized }).then(reload))}>
                        {p.embargo?.release_authorized ? "revoke authorization" : "authorize release"}
                      </button>
                      <button className="small ghost" onClick={() => act.run(() => rpc("cancelPublication", { publication_id: p.id, reason: "cancelled from UI" }).then(reload))}>
                        cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function PublicationPage() {
  const { id } = useParams();
  const { data, error } = useRpc("publications", {});
  const act = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const p = data.find((x: any) => x.id === id);
  if (!p) return <ErrorBox error={{ name: "x", message: "No accessible record with this identifier.", code: "not_found" } as any} />;
  const download = () =>
    act.run(async () => {
      const exp = await rpc("exportPublication", { publication_id: id });
      const blob = new Blob([JSON.stringify(exp, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${id}.json`;
      a.click();
    });
  return (
    <div className="page">
      <h1>{p.title ?? "Publication"}</h1>
      <div className="small muted">
        <code>{p.id}</code> · <Chip value={p.status} /> · audience {p.audience.mode} · license {p.license} · issued by {p.issuer?.name} · published <Time at={p.published_at} />
      </div>
      <p className="hint">Publication is not approval. The status shown below is the snapshot recorded at publication under its policy; later events (corrections, retractions, reviews) are listed on each entity separately.</p>
      <ErrorBox error={act.error} />
      <Section title="Manifest (exact revisions)" actions={<button className="small ghost" onClick={download}>Download portable export</button>}>
        <table className="list">
          <thead>
            <tr>
              <th>Revision</th>
              <th>Citation</th>
              <th>Status at publication</th>
            </tr>
          </thead>
          <tbody>
            {p.revs.map((r: any) => (
              <tr key={r.rev}>
                <td>
                  <RevLink rev={r.rev} title={r.title} seq={r.seq} />
                </td>
                <td className="small">
                  Entity <code>{r.entity}</code>, revision <code>{r.rev}</code>, “{r.title}”, published {p.published_at?.slice(0, 10)}
                </td>
                <td className="small">
                  {Object.entries(p.assessment_snapshot?.status?.[r.rev] ?? {})
                    .filter(([k]) => ["logical", "evidence", "review", "validity"].includes(k))
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small muted">Snapshot policy {p.assessment_snapshot?.policy}, cut {p.assessment_snapshot?.cut}</div>
      </Section>
      {p.exposure && (
        <details>
          <summary>Exposure validation at issue</summary>
          <Json value={p.exposure} />
        </details>
      )}
    </div>
  );
}
