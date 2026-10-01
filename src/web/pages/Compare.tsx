// Workflow 5/11 / Q13: semantic comparison. Suggestions are candidates; only a recorded
// comparison with an assessor classifies a change.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc } from "../api.ts";
import { Chip, Empty, ErrorBox, Field, Loading, RevLink, Section, Select, useAction, useRpc, useSession } from "../ui.tsx";

export function ComparePage() {
  const [sp] = useSearchParams();
  const oldRev = sp.get("old");
  const newRev = sp.get("new");
  const { vocab, agent } = useSession();
  const { data, error, reload } = useRpc("compare", { old: oldRev, new: newRev });
  const { data: info } = useRpc("revision", { rev: newRev });
  const [changes, setChanges] = useState<any[]>([]);
  const [verdict, setVerdict] = useState("comparable");
  const [mapping, setMapping] = useState("same context");
  const act = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="page">
      <h1>What changed?</h1>
      <div className="grid2">
        <div>
          <h4>
            Old: <RevLink rev={data.old.rev} title={data.old.title} seq={data.old.seq} />
          </h4>
          <p className="statement">{data.old.text}</p>
        </div>
        <div>
          <h4>
            New: <RevLink rev={data.new.rev} title={data.new.title} seq={data.new.seq} />
          </h4>
          <p className="statement">{data.new.text}</p>
        </div>
      </div>
      <Section title="Text difference" hint="Lexical only. It never decides strength or equivalence.">
        <p className="diff">
          {data.text_diff.map((t: any, i: number) => (
            <span key={i} className={t.op}>
              {t.t}{" "}
            </span>
          ))}
        </p>
        <div className="small">
          Context alignment: <Chip value={data.alignment} />
        </div>
        {data.structural.map((s: string) => (
          <div key={s} className="small">
            • {s}
          </div>
        ))}
      </Section>
      <Section title="Suggested change classes (candidates)" hint={data.verdict_note}>
        {data.suggestions.length === 0 && <Empty>No automatic suggestion.</Empty>}
        {data.suggestions.map((s: any, i: number) => (
          <div key={i}>
            <Chip value={s.class} /> <span className="small">{s.detection}</span>{" "}
            <button className="small ghost" onClick={() => setChanges([...changes, { class: s.class, description: s.detection, status: "declared" }])}>
              adopt as declared
            </button>
          </div>
        ))}
      </Section>
      <Section title="Recorded classifications">
        {data.recorded_classifications.length === 0 && <Empty>None recorded yet.</Empty>}
        {data.recorded_classifications.map((r: any) => (
          <div key={r.rev}>
            <RevLink rev={r.rev} title={`by ${r.assessor}`} /> — {r.verdict}; {r.changes.map((c: any) => `${c.class} [${c.status}]`).join(", ")}
          </div>
        ))}
      </Section>
      {agent && info && (
        <Section title="Record a classification" hint="Your classification is an attributed evaluation with status declared/reviewed/proved; incomparable and unknown are valid verdicts.">
          <ErrorBox error={act.error} />
          {changes.map((c, i) => (
            <div key={i} className="row wrap">
              <Select value={c.class} options={vocab?.change_classes ?? []} onChange={(x) => setChanges(changes.map((y, j) => (j === i ? { ...y, class: x } : y)))} />
              <input value={c.description} onChange={(e) => setChanges(changes.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
              <Select value={c.status} options={["proposed", "declared", "reviewed", "proved"]} onChange={(x) => setChanges(changes.map((y, j) => (j === i ? { ...y, status: x } : y)))} />
              <button className="link small" onClick={() => setChanges(changes.filter((_, j) => j !== i))}>
                remove
              </button>
            </div>
          ))}
          <button className="small ghost" onClick={() => setChanges([...changes, { class: "typo_editorial", description: "", status: "declared" }])}>
            + change
          </button>
          <div className="row wrap">
            <Field label="Verdict">
              <Select value={verdict} options={["comparable", "incomparable", "unknown"]} onChange={setVerdict} />
            </Field>
            <Field label="Context mapping">
              <input value={mapping} onChange={(e) => setMapping(e.target.value)} />
            </Field>
            <button
              disabled={!changes.length}
              onClick={() =>
                act.run(async () => {
                  const ent = await rpc("entity", { entity_id: info.entity_id });
                  await rpc("createAndSeal", {
                    workspace_id: ent.entity.workspace_id,
                    kind: "evaluation",
                    title: `Comparison r${data.old.seq} → r${data.new.seq} of ${data.new.title}`,
                    content: {
                      context: { rev: info.context.rev },
                      payload: { eval_kind: "comparison", subject: { rev: newRev }, scope: "semantic comparison of these two exact revisions", comparison: { old: { rev: oldRev }, new: { rev: newRev }, context_mapping: mapping, changes, verdict } },
                      provenance: { origin: "human", acquisition: "authorship" },
                    },
                  });
                  setChanges([]);
                  reload();
                })
              }
            >
              Seal classification
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
