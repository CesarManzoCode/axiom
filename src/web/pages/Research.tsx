import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Chip, Empty, ErrorBox, KindBadge, Loading, Section, Tabs, useRpc } from "../ui.tsx";

const MODALITY_HELP: Record<string, string> = {
  proven_necessary: "evidence that the target implies this condition; meeting it is not enough",
  proven_sufficient: "evidence that this condition implies the target; not claimed necessary",
  candidate_route: "conjectured usefulness, bridge pending",
  diagnostic: "question deciding applicability or viability",
  strategy: "work plan, not an implication",
  local_requirement: "required by this argument/package only",
  hypothetical: "exploration assumption, visible as such",
};

export function PlanTree({ plans, depth = 0 }: { plans: any[]; depth?: number }) {
  if (!plans?.length) return null;
  return (
    <div className="plans" style={{ marginLeft: depth ? 18 : 0 }}>
      {plans.map((p) => (
        <div key={p.plan_rev} className="plan">
          <div className="plan-head">
            <span className={`planmode ${p.plan_mode}`}>{p.plan_mode}</span> <Link to={`/r/${p.plan_rev}`}>{p.plan_title}</Link>
            <span className="muted small"> — {p.plan_mode === "AND" ? "all listed local criteria required by this plan" : "alternatives for this plan; not claimed exhaustive"}</span>
          </div>
          {p.parts.map((x: any) => (
            <div key={x.slot} className="part">
              <div className="part-row">
                <span className="modality" title={MODALITY_HELP[x.modality]}>
                  {x.modality.replace(/_/g, " ")}
                </span>
                <KindBadge kind={x.kind} role={x.role} />
                <Link to={`/e/${x.entity}?rev=${x.rev}`}>{x.title}</Link>
                {x.closure && <Chip value={x.closure.state} />}
                {x.route && <Chip value={x.route.liveness} />}
                {x.route?.failed_attempts > 0 && <span className="small muted">{x.route.failed_attempts} failed attempt(s)</span>}
                {x.kind === "research" && (
                  <Link className="small" to={`/bundle/${x.rev}`}>
                    context bundle
                  </Link>
                )}
              </div>
              {x.route?.barriers?.map((b: any, i: number) => (
                <div key={i} className="barrier small">
                  barrier <Link to={`/r/${b.barrier.rev}`}>{b.barrier.title ?? "[restricted]"}</Link>: <Chip value={b.applicability} />
                  {b.positions.map((pp: any) => (
                    <span key={pp.assessment_rev} className="muted">
                      {" "}
                      — {pp.assessor}: “{pp.predicate}” ({pp.scope})
                    </span>
                  ))}
                </div>
              ))}
              <PlanTree plans={x.plans} depth={depth + 1} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Cockpit() {
  const { ws } = useParams();
  const { data, error } = useRpc("cockpit", { workspace_id: ws });
  const [tab, setTab] = useState("plans");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const byRole = (roles: string[]) => data.items.filter((i: any) => roles.includes(i.role));
  return (
    <div className="page">
      <h1>Research cockpit</h1>
      <p className="hint">
        What is pending and what it unblocks. Work state is not logical state; “blocked” is only ever the attributed result of an applicability evaluation. Route lists are local plans, never claims of exhaustiveness.
      </p>
      <div className="row wrap">
        <Link className="button" to={`/w/${ws}/new?kind=research&role=objective`}>
          New objective
        </Link>
        <Link className="button ghost" to={`/w/${ws}/new?kind=research&role=obligation`}>
          New obligation
        </Link>
        <Link className="button ghost" to={`/w/${ws}/new?kind=relation&contract=decomposes_into`}>
          New plan (decomposition)
        </Link>
        <Link className="button ghost" to={`/w/${ws}/new?kind=research&role=attempt`}>
          Record an attempt
        </Link>
        <Link className="button ghost" to={`/w/${ws}/new?kind=research&role=inquiry_line`}>
          New inquiry line
        </Link>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "plans", label: "Objectives & routes" },
          { id: "obligations", label: `Obligations (${byRole(["obligation"]).length})` },
          { id: "attempts", label: `Attempts (${byRole(["attempt", "experiment"]).length})` },
          { id: "lines", label: `Inquiry lines (${byRole(["inquiry_line"]).length})` },
          { id: "all", label: "All items" },
        ]}
      />
      {tab === "plans" && (
        <>
          {data.objectives.length === 0 && <Empty>No objective yet.</Empty>}
          {data.objectives.map((o: any) => (
            <Section
              key={o.entity}
              title={
                <>
                  <KindBadge kind="research" role={o.role} /> <Link to={`/e/${o.entity}`}>{o.title}</Link> <Chip value={o.work_state} />
                </>
              }
              hint={o.goal}
            >
              {o.plans.length ? <PlanTree plans={o.plans} /> : <Empty>No plan decomposes this objective yet.</Empty>}
            </Section>
          ))}
        </>
      )}
      {tab !== "plans" && (
        <table className="list">
          <thead>
            <tr>
              <th>Item</th>
              <th>Role</th>
              <th>Work state</th>
              <th>Result</th>
              <th>Responsible</th>
              <th>Visibility</th>
            </tr>
          </thead>
          <tbody>
            {(tab === "obligations" ? byRole(["obligation"]) : tab === "attempts" ? byRole(["attempt", "experiment"]) : tab === "lines" ? byRole(["inquiry_line"]) : data.items).map((i: any) => (
              <tr key={i.entity}>
                <td>
                  <Link to={`/e/${i.entity}`}>{i.title}</Link>
                  {!i.sealed && <span className="muted small"> (draft only)</span>}
                </td>
                <td>{i.role}</td>
                <td>
                  <Chip value={i.work_state} />
                </td>
                <td>{i.result ? <Chip value={i.result} /> : null}</td>
                <td className="small">{i.responsible ?? <span className="muted">unassigned</span>}</td>
                <td className="small">{i.access}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
