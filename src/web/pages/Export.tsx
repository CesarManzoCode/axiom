// Portable export/import (I49). Exports keep IDs, revisions, contracts, provenance, events and
// the assessment policy/cut, filtered by your audience, with omissions declared.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { ErrorBox, Field, Section, useAction } from "../ui.tsx";

export function ExportPage() {
  const { ws } = useParams();
  const [cut, setCut] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const act = useAction();
  const nav = useNavigate();
  return (
    <div className="page">
      <h1>Export / import</h1>
      <ErrorBox error={act.error} />
      <Section title="Export this workspace" hint="Everything you can see, with exact IDs and hashes. Drafts and credentials are never exported.">
        <div className="row">
          <Field label="As of (optional)">
            <input type="datetime-local" value={cut} onChange={(e) => setCut(e.target.value)} />
          </Field>
          <button
            onClick={() =>
              act.run(async () => {
                const data = await rpc("exportWorkspace", { workspace_id: ws, cut: cut ? new Date(cut).toISOString() : undefined });
                setSummary({ entities: data.entities.length, revisions: data.revisions.length, events: data.events.length, omissions: data.omissions });
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${ws}-export.json`;
                a.click();
              })
            }
          >
            Download export
          </button>
        </div>
        {summary && <pre className="json">{JSON.stringify(summary, null, 2)}</pre>}
      </Section>
      <Section title="Import an export" hint="Restores a workspace with all identifiers preserved. Hashes, ancestry and containment are re-validated; you become its owner here.">
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            act.run(async () => {
              const data = JSON.parse(await f.text());
              const r = await rpc("importWorkspace", { data });
              nav(`/w/${r.workspace_id}`);
            });
          }}
        />
      </Section>
    </div>
  );
}
