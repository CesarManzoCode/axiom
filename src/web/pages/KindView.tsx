// Readable projection of sealed content by payload kind. Relations are rendered with their
// roles, grouping and hypotheses — never as an anonymous arrow.
import { Link } from "react-router-dom";
import { Chip, RevLink, useRefTitles, Json } from "../ui.tsx";

function R({ r, titles }: { r: any; titles: Record<string, string> }) {
  if (!r) return null;
  if (r.rev) return <RevLink rev={r.rev} title={titles[r.rev] ?? r.rev} />;
  return <span className="muted">{JSON.stringify(r)}</span>;
}

function Group({ expr, slots, titles }: { expr: any; slots: any[]; titles: Record<string, string> }) {
  return (
    <span className="group">
      (
      {expr.items.map((it: any, i: number) => (
        <span key={i}>
          {i > 0 && <span className="op"> {expr.op === "AND" ? "∧" : "∨"} </span>}
          {typeof it === "string" ? <R r={slots.find((s) => s.slot === it)?.ref} titles={titles} /> : <Group expr={it} slots={slots} titles={titles} />}
        </span>
      ))}
      )
    </span>
  );
}

export function RelationView({ c, titles }: { c: any; titles: Record<string, string> }) {
  const p = c.payload;
  const byRole = (role: string) => p.slots.filter((s: any) => s.role === role).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const roles = [...new Set(p.slots.map((s: any) => s.role))] as string[];
  const renderRole = (role: string) => {
    const g = p.grouping?.[role];
    const ss = byRole(role);
    if (g) return <Group expr={g} slots={ss} titles={titles} />;
    return ss.map((s: any, i: number) => (
      <span key={s.slot}>
        {i > 0 && ", "}
        <R r={s.ref} titles={titles} />
        {s.modality && <span className="modality small"> {s.modality.replace(/_/g, " ")}</span>}
      </span>
    ));
  };
  return (
    <div className="relation">
      <div className="contract">
        <code>
          {p.contract.id}@{p.contract.version}
        </code>{" "}
        <Chip value={p.modality} /> <Chip value={p.assertion} />
      </div>
      <p className="statement">{p.interpretation}</p>
      {p.contract.id === "entails" ? (
        <div className="formula">
          {byRole("premise").length ? renderRole("premise") : <em>Context alone</em>} <span className="op">⇒</span> {renderRole("conclusion")}
          {byRole("condition").length > 0 && (
            <>
              {" "}
              <span className="muted">under</span> {renderRole("condition")}
            </>
          )}
        </div>
      ) : (
        <table className="slots">
          <thead>
            <tr>
              <th>Role</th>
              <th>Participants (exact revisions)</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role}>
                <td>{role}</td>
                <td>{renderRole(role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.hypotheses?.length > 0 && (
        <div>
          <strong>Hypotheses/conditions:</strong>
          <ul>
            {p.hypotheses.map((h: any) => (
              <li key={h.id}>
                {h.text} {h.ref && <R r={h.ref} titles={titles} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.scope && (
        <div>
          <strong>Scope:</strong> {p.scope}
        </div>
      )}
      {p.quantitative_scope && (
        <div>
          <strong>Quantitative scope:</strong> {p.quantitative_scope}
        </div>
      )}
      {Object.keys(p.fields ?? {}).length > 0 && (
        <div className="fields">
          {Object.entries(p.fields).map(([k, v]) => (
            <div key={k}>
              <strong>{k.replace(/_/g, " ")}:</strong> {String(v)}
            </div>
          ))}
        </div>
      )}
      {p.witness_not_provided && <div className="warn small">Witness not yet provided (visible by contract).</div>}
    </div>
  );
}

function Diagram({ d }: { d: any }) {
  const n = d.vertices.length;
  const pos = Object.fromEntries(d.vertices.map((v: any, i: number) => [v.id, n === 4 ? [[60, 40], [260, 40], [60, 160], [260, 160]][i] : [160 + 110 * Math.cos((2 * Math.PI * i) / n), 100 + 70 * Math.sin((2 * Math.PI * i) / n)]]));
  return (
    <figure className="diagram">
      <svg viewBox="0 0 320 200" width="320" height="200" role="img" aria-label="diagram">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {d.arrows.map((a: any) => {
          const [x1, y1] = pos[a.from] ?? [0, 0];
          const [x2, y2] = pos[a.to] ?? [0, 0];
          const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
          const sx = x1 + (dx / len) * 28, sy = y1 + (dy / len) * 14, ex = x2 - (dx / len) * 28, ey = y2 - (dy / len) * 14;
          return (
            <g key={a.id}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="currentColor" markerEnd="url(#arr)" />
              <text x={(sx + ex) / 2 + 4} y={(sy + ey) / 2 - 4} fontSize="11">
                {a.label}
              </text>
            </g>
          );
        })}
        {d.vertices.map((v: any) => (
          <text key={v.id} x={pos[v.id][0]} y={pos[v.id][1] + 4} textAnchor="middle" fontSize="12" fontWeight="600">
            {v.label}
          </text>
        ))}
      </svg>
      <figcaption className="small">
        {d.equations?.map((e: string) => (
          <div key={e}>
            <code>{e}</code>
          </div>
        ))}
        {d.faces?.map((f: any) => (
          <div key={f.id} className="muted">
            face {f.id}: {f.arrows.join(" → ")} {f.commutes_claim ? "(commutativity claim recorded)" : "(commutativity is a claim, not a property of the drawing)"}
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

export function KindView({ content }: { content: any }) {
  const titles = useRefTitles(content);
  if (!content) return null;
  const p = content.payload ?? {};
  const reps = (content.representations ?? []).filter((r: any) => r.id !== "readable");
  return (
    <div className="kindview">
      {content.kind === "declaration" && (
        <>
          <p className="statement big">{p.statement}</p>
          <div className="small">
            <Chip value={p.category} /> {p.usage && <Chip value={p.usage} />} {p.editorial_roles?.map((r: string) => <Chip key={r} value={r} title="Editorial role asserted in this revision; status lives in assessments" />)}
          </div>
          {p.variables?.length > 0 && (
            <div className="small">
              <strong>Bindings:</strong> {p.variables.map((v: any) => `${v.binder ? `${v.binder} ` : ""}${v.name}${v.domain ? ` ∈ ${v.domain}` : ""}`).join("; ")}
            </div>
          )}
          {p.assumptions?.length > 0 && (
            <div>
              <strong>Assumptions</strong>
              <ul>
                {p.assumptions.map((a: any) => (
                  <li key={a.id}>
                    <code>{a.id}</code> {a.expr} <span className="muted small">({a.scope}{a.discharge ? `; discharge: ${a.discharge}` : ""})</span> {a.source && <R r={a.source} titles={titles} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.barrier && (
            <div className="barrierbox">
              <strong>Barrier contract.</strong> Predicate: {p.barrier.predicate}. Restricts: {p.barrier.restricts}.{" "}
              {p.barrier.conditions?.length > 0 && <>Conditions: {p.barrier.conditions.join("; ")}.</>}
              <div className="muted small">It blocks only techniques for which applicability has been shown.</div>
            </div>
          )}
          {p.formal && (
            <div>
              <strong>Formal statement ({p.formal.system}):</strong>
              <pre className="formal">{p.formal.text}</pre>
            </div>
          )}
          {p.answer_criterion && (
            <div>
              <strong>What counts as an answer:</strong> {p.answer_criterion}
            </div>
          )}
        </>
      )}
      {(content.kind === "object" || content.kind === "method") && (
        <>
          <p className="statement big">{p.description}</p>
          {p.parameters?.length > 0 && <div className="small">Parameters: {p.parameters.map((v: any) => `${v.binder ? `${v.binder} ` : ""}${v.name}${v.domain ? ` ∈ ${v.domain}` : ""}`).join("; ")}</div>}
          {p.regime && <div>Regime: {p.regime}</div>}
          {p.applicability && <div>Applicability: {p.applicability}</div>}
        </>
      )}
      {content.kind === "argument" && (
        <>
          <div>
            <strong>Argues for:</strong>{" "}
            {p.targets.map((t: any, i: number) => (
              <span key={i}>
                {i > 0 && ", "}
                <R r={t} titles={titles} />
              </span>
            ))}
          </div>
          <div className="small">
            <Chip value={p.argument_kind} /> completeness claimed: <Chip value={p.completeness} />
          </div>
          {p.summary && <p className="statement">{p.summary}</p>}
          {p.steps?.length > 0 && (
            <ol className="steps">
              {p.steps.map((s: any) => (
                <li key={s.id} id={`step-${s.id}`}>
                  <code>{s.id}</code> {s.text}
                  {s.uses?.length > 0 && (
                    <span className="small muted">
                      {" "}
                      — uses{" "}
                      {s.uses.map((u: any, i: number) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          <R r={u} titles={titles} />
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {p.gaps?.length > 0 && (
            <div className="warn">
              <strong>Declared gaps:</strong>
              <ul>
                {p.gaps.map((g: any) => (
                  <li key={g.id}>
                    {g.id}: {g.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.dependency_sets?.map((d: any) => (
            <div key={d.id} className="depset small">
              <strong>Dependency set {d.id}</strong> ({d.completeness.replace(/_/g, " ")}; scope: {d.scope}; minimality: {d.minimality.replace(/_/g, " ")}
              {d.method ? `, method ${d.method}` : ""}
              {d.certificate ? `, certificate ${d.certificate}` : ""}):{" "}
              {d.members.map((m: any, i: number) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <R r={m} titles={titles} />
                </span>
              ))}
              {d.rules?.length > 0 && <> · rules: {d.rules.join(", ")}</>}
            </div>
          ))}
          {p.formal && (
            <div className="small">
              Formal system {p.formal.system}; environment {p.formal.environment ? <R r={p.formal.environment} titles={titles} /> : "unspecified"}; kernel dependencies: {p.formal.kernel_dependencies.replace(/_/g, " ")}
            </div>
          )}
          {p.protocol && (
            <div className="small">
              Protocol: {p.protocol.description} {p.protocol.range && <>— range {p.protocol.range}</>}
            </div>
          )}
        </>
      )}
      {content.kind === "relation" && <RelationView c={content} titles={titles} />}
      {content.kind === "research" && (
        <>
          <div className="small">
            <Chip value={p.role} />
          </div>
          <p className="statement big">{p.goal}</p>
          {p.target && (
            <div>
              <strong>Target:</strong> <R r={p.target} titles={titles} />
            </div>
          )}
          {p.closure_criterion && (
            <div>
              <strong>Closure criterion:</strong> {p.closure_criterion}
            </div>
          )}
          {p.answer_criterion && (
            <div>
              <strong>Answer criterion:</strong> {p.answer_criterion}
            </div>
          )}
          {p.selection?.length > 0 && (
            <div>
              <strong>Selection (pinned):</strong>{" "}
              {p.selection.map((s: any, i: number) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <R r={s} titles={titles} />
                </span>
              ))}
              {p.baseline && <span className="muted small"> — baseline {p.baseline}</span>}
            </div>
          )}
          {p.attempt && (
            <div className="attempt">
              <div>
                <strong>Strategy:</strong> {p.attempt.strategy} {p.attempt.approach && <>· approach {p.attempt.approach}</>}
              </div>
              {p.attempt.protocol && <div>Protocol: {p.attempt.protocol}</div>}
              {p.attempt.steps?.length > 0 && (
                <ol>
                  {p.attempt.steps.map((s: any) => (
                    <li key={s.id}>
                      <code>{s.id}</code> {s.text}
                    </li>
                  ))}
                </ol>
              )}
              <div>
                Result: <Chip value={p.attempt.result} /> {p.attempt.observed}
              </div>
              {p.attempt.artifacts?.length > 0 && (
                <div className="small">
                  Artifacts:{" "}
                  {p.attempt.artifacts.map((a: any, i: number) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      <R r={a} titles={titles} />
                    </span>
                  ))}
                </div>
              )}
              {p.attempt.artifacts_missing_reason && <div className="small">Artifacts missing: {p.attempt.artifacts_missing_reason}</div>}
              {p.attempt.failure && (
                <div className="failure">
                  <div>
                    <strong>Failure ({p.attempt.failure.kind.replace(/_/g, " ")})</strong> at {p.attempt.failure.defect_locator}
                  </div>
                  <div>Observed: {p.attempt.failure.observed}</div>
                  {p.attempt.failure.range && <div>Searched range/protocol: {p.attempt.failure.range}</div>}
                  <div>
                    <strong>Maximal negative conclusion allowed:</strong> {p.attempt.failure.allowed_negative_conclusion}
                  </div>
                  <div>
                    <strong>Does not establish:</strong>
                    <ul>
                      {p.attempt.failure.non_conclusions.map((n: string) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="small">
                    Barrier applicability: {p.attempt.failure.barrier_applicability.status.replace(/_/g, " ")} {p.attempt.failure.barrier_applicability.barrier && <R r={p.attempt.failure.barrier_applicability.barrier} titles={titles} />}
                  </div>
                  <div className="small">
                    Successors:{" "}
                    {p.attempt.failure.successors === "none_recorded"
                      ? "none recorded"
                      : p.attempt.failure.successors.map((s: any, i: number) => (
                          <span key={i}>
                            {i > 0 && ", "}
                            <R r={s} titles={titles} />
                          </span>
                        ))}
                  </div>
                  <div className="small muted">
                    Evaluated by {p.attempt.failure.evaluator} on {p.attempt.failure.evaluated_at}. Impossibility would need a separate claim and argument.
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {content.kind === "evaluation" && (
        <>
          <div>
            <strong>{p.eval_kind}</strong> of <R r={p.subject} titles={titles} /> {p.locator && <span className="muted">@ {p.locator}</span>}
          </div>
          {p.dimension && (
            <div>
              {p.dimension}: <Chip value={p.value} /> {p.source_verdict && <span className="muted small">(source verdict: {p.source_verdict})</span>}
            </div>
          )}
          {p.eval_kind === "applicability" && (
            <div>
              Barrier <R r={p.barrier} titles={titles} />: <Chip value={p.value} /> — predicate tested: {p.predicate}
            </div>
          )}
          {p.findings?.length > 0 && (
            <table className="slots">
              <tbody>
                {p.findings.map((f: any, i: number) => (
                  <tr key={i}>
                    <td>{f.dimension}</td>
                    <td>
                      <Chip value={f.value} />
                    </td>
                    <td className="small">
                      {f.locator && <code>{f.locator}</code>} {f.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div>
            <strong>Scope:</strong> {p.scope}
          </div>
          {p.reason && <div>{p.reason}</div>}
          {p.assessor?.descriptor && <div className="small">Assessor: {p.assessor.descriptor}</div>}
          {p.evidence?.length > 0 && (
            <div className="small">
              Evidence:{" "}
              {p.evidence.map((e: any, i: number) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <R r={e} titles={titles} />
                </span>
              ))}
            </div>
          )}
          {p.comparison && (
            <div>
              <div>
                Comparison <R r={p.comparison.old} titles={titles} /> → <R r={p.comparison.new} titles={titles} /> ({p.comparison.verdict}; context: {p.comparison.context_mapping})
              </div>
              <ul>
                {p.comparison.changes.map((ch: any, i: number) => (
                  <li key={i}>
                    <Chip value={ch.class} /> {ch.description} <span className="muted small">[{ch.status}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {content.kind === "context" && (
        <>
          <p className="statement">
            <strong>Foundations:</strong> {p.foundations} {p.root && <Chip value="root" label="root context (self-describing profile)" />}
          </p>
          {p.parent && (
            <div>
              Parent: <R r={p.parent} titles={titles} />
            </div>
          )}
          {p.imports?.length > 0 && (
            <div>
              Imports:{" "}
              {p.imports.map((r: any, i: number) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <R r={r} titles={titles} />
                </span>
              ))}
            </div>
          )}
          {p.conventions && <div>Conventions: {p.conventions}</div>}
          {p.inference_rules && <div>Inference rules: {p.inference_rules}</div>}
          {p.axioms?.length > 0 && (
            <div>
              Axioms:
              <ul>
                {p.axioms.map((a: any) => (
                  <li key={a.id}>
                    <code>{a.id}</code> {a.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.assumptions?.length > 0 && (
            <div>
              Assumptions:
              <ul>
                {p.assumptions.map((a: any) => (
                  <li key={a.id}>
                    <code>{a.id}</code> {a.expr} <span className="muted small">({a.scope})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.notation?.length > 0 && <div className="small">Notation: {p.notation.map((b: any) => `${b.symbol} = ${b.meaning}`).join("; ")}</div>}
          {p.resolutions?.length > 0 && <div className="small">Resolutions: {p.resolutions.map((b: any) => `${b.symbol}: ${b.choice}`).join("; ")}</div>}
          {p.execution && (
            <div className="small">
              <strong>Execution context:</strong> {Object.entries(p.execution).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </div>
          )}
          {p.trust_boundary && <div className="small">Trust boundary: {p.trust_boundary}</div>}
        </>
      )}
      {content.kind === "source" && (
        <>
          <p className="statement">{p.citation}</p>
          <div className="small">
            {p.source_kind} · edition: {p.edition ?? "—"} · locator: {p.locator ?? "—"} · availability: <Chip value={p.availability} /> · rights: <Chip value={p.rights.status} /> {p.rights.note}
          </div>
          <div className="small">
            Source revision identity: <Chip value={p.revision_identity.status} /> {p.revision_identity.value ?? p.revision_identity.reason}
          </div>
          {p.url && (
            <div className="small">
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.url}
              </a>{" "}
              {p.retrieved_at && <>— consulted {p.retrieved_at}</>}
            </div>
          )}
        </>
      )}
      {content.kind === "collection" && <p className="statement">{p.description}</p>}
      {reps.length > 0 && (
        <details>
          <summary>Representations ({reps.length})</summary>
          {reps.map((r: any) => (
            <div key={r.id} className="rep">
              <div className="small muted">
                {r.id} · {r.modality} {r.language ?? ""} {r.system ?? ""} · {r.meaning_role}
              </div>
              {r.diagram ? <Diagram d={r.diagram} /> : <pre className="formal">{r.content}</pre>}
              {r.bindings?.length > 0 && <div className="small">bindings: {r.bindings.map((b: any) => `${b.symbol}=${b.meaning}`).join("; ")}</div>}
            </div>
          ))}
        </details>
      )}
      {content.references?.length > 0 && (
        <details>
          <summary>Typed references ({content.references.length})</summary>
          <ul>
            {content.references.map((u: any, i: number) => (
              <li key={i}>
                <Chip value={u.purpose} /> {u.origin !== "explicit" && <Chip value={u.origin} />} <R r={u.ref} titles={titles} /> {u.role && <span className="muted small">as {u.role}</span>} {u.locator && <span className="muted small">@ {u.locator}</span>}
                {u.inference && <span className="muted small"> — inferred by {u.inference.method}: {u.inference.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Narrative({ manifest }: { manifest: any }) {
  if (!manifest) return null;
  return (
    <article className="narrative">
      {manifest.narrative.map((b: any) =>
        b.type === "heading" ? (
          <h2 key={b.id}>{b.text}</h2>
        ) : b.type === "prose" ? (
          <p key={b.id}>{b.text}</p>
        ) : (
          <blockquote key={b.id} className="transclusion">
            {b.rev ? (
              <>
                <div>{b.text}</div>
                <div className="small muted">
                  transcluded exactly: <Link to={`/r/${b.rev}`}>{b.title}</Link> r{b.seq} ({b.kind})
                </div>
              </>
            ) : (
              <em className="muted">[transcluded item not accessible to you]</em>
            )}
          </blockquote>
        ),
      )}
      {manifest.items?.length > 0 && (
        <details>
          <summary>Manifest ({manifest.items.length} exact components)</summary>
          <table className="list">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Component</th>
                <th>Relation</th>
                <th>Class</th>
                <th>Partition</th>
              </tr>
            </thead>
            <tbody>
              {manifest.items.map((m: any) => (
                <tr key={m.slot}>
                  <td>{m.slot}</td>
                  <td>
                    <RevLink rev={m.rev} title={m.title} seq={m.seq} />
                  </td>
                  <td>{m.relation}</td>
                  <td className="small">{m.relation_class}</td>
                  <td className="small">{m.partition ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {manifest.bundle && (
        <details>
          <summary>Bundle metadata</summary>
          <Json value={manifest.bundle} />
        </details>
      )}
    </article>
  );
}
