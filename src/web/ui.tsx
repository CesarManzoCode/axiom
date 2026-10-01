// Shared UI building blocks. Components show uncertainty explicitly: unknown/not evaluated
// values are rendered as values, never hidden or turned into a negative badge.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, rpc } from "./api.ts";

// ------------------------------------------------------------------ session & vocabulary

export interface Session {
  agent: { id: string; name: string; kind: string } | null;
  refresh: () => void;
  vocab: any;
}
export const SessionCtx = createContext<Session>({ agent: null, refresh: () => {}, vocab: null });
export const useSession = () => useContext(SessionCtx);

// ------------------------------------------------------------------ data hooks

export function useRpc<T = any>(method: string | null, args: Record<string, unknown> = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(args);
  useEffect(() => {
    if (!method) return;
    let live = true;
    setLoading(true);
    rpc<T>(method, JSON.parse(key))
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && (setError(e), setData(null)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [method, key, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Run a mutation, surfacing domain errors (with details) to the caller's error slot. */
export function useAction() {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e as ApiError);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, error, busy, setError };
}

// ------------------------------------------------------------------ primitives

export function ErrorBox({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = e.details;
  return (
    <div className="error">
      <strong>{e.code ? e.code.replace(/_/g, " ") : "error"}:</strong> {e.message}
      {Array.isArray(details) && details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>{typeof d === "string" ? d : JSON.stringify(d)}</li>
          ))}
        </ul>
      )}
      {details && !Array.isArray(details) && typeof details === "object" && (details as any).conflicts && (
        <ExposureReport exposure={details as any} />
      )}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="muted">{what}…</div>;
}

export function Section({ title, children, actions, hint }: { title: ReactNode; children: ReactNode; actions?: ReactNode; hint?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: ReactNode }[]; value: string; onChange: (id: string) => void }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

const TONE: Record<string, string> = {
  supported_derivation: "good",
  supported_in_scope: "good",
  accepted: "good",
  accepted_support_known: "good",
  reviewed_match: "good",
  check_pass_reproduced: "good",
  independently_reproduced: "good",
  completed: "good",
  promoted: "good",
  refuted: "bad",
  defect_found: "bad",
  defective: "bad",
  mismatch: "bad",
  check_failed: "bad",
  retracted: "bad",
  rejected: "bad",
  failed: "bad",
  blocked_in_evaluated_scope: "bad",
  applies: "bad",
  conflicting: "warn",
  contested: "warn",
  disputed: "warn",
  open: "warn",
  possibly_blocked_unknown: "warn",
  quarantined: "warn",
  completion_claimed: "warn",
  proof_claimed: "info",
  claimed: "info",
  claimed_support_not_accepted: "info",
  corrected: "info",
  superseded_in_scope: "info",
};
export function Chip({ value, label, title }: { value: string; label?: ReactNode; title?: string }) {
  const unknown = /not_evaluated|unknown|none_known|unreviewed|not_searched|none_recorded|undetermined|unevaluated/.test(value);
  return (
    <span className={`chip ${TONE[value] ?? (unknown ? "unknown" : "")}`} title={title}>
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}

export function KindBadge({ kind, role }: { kind: string; role?: string }) {
  return (
    <span className={`kind kind-${kind}`}>
      {role ? `${role.replace(/_/g, " ")}` : kind}
    </span>
  );
}

export function EntityLink({ id, rev, children }: { id: string; rev?: string | null; children: ReactNode }) {
  return <Link to={`/e/${id}${rev ? `?rev=${rev}` : ""}`}>{children}</Link>;
}

/** Link to an exact revision, resolving its entity lazily. */
export function RevLink({ rev, title, seq }: { rev: string | null; title?: string | null; seq?: number | null }) {
  if (!rev) return <span className="muted">[not accessible]</span>;
  return (
    <Link to={`/r/${rev}`} className="revlink">
      {title ?? rev}
      {seq ? <span className="seq">r{seq}</span> : null}
    </Link>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Select({ value, options, onChange, allowEmpty }: { value: string | undefined; options: readonly string[]; onChange: (v: string) => void; allowEmpty?: string }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Time({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="muted">unknown</span>;
  const d = new Date(at);
  return <time title={at}>{isNaN(d.getTime()) ? at : d.toLocaleString()}</time>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// ------------------------------------------------------------------ status vector

export function StatusVector({ status, compact }: { status: any; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (!status) return null;
  const dims = status.dimensions as Record<string, any>;
  const headline = ["logical", "evidence", "review", "formalization", "fidelity", "validity", "disputes"];
  return (
    <div className="status">
      <div className="status-chips">
        {headline.map((d) => (
          <span key={d} className="dimchip">
            <span className="dimname">{d}</span>
            <Chip value={dims[d].summary} title={dims[d].note ?? dims[d].attributed_to?.join(", ")} />
            {dims[d].conflicting && <Chip value="conflicting" label="opposed" />}
          </span>
        ))}
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "collapse" : "all ten dimensions"}
        </button>
      </div>
      <div className="muted small">
        Policy <code>{status.policy.key}</code> · cut <Time at={status.cut} /> · scope {status.scope} · support: <Chip value={status.support} />
      </div>
      {open && (
        <table className="dims">
          <thead>
            <tr>
              <th>Dimension</th>
              <th>Summary</th>
              <th>How</th>
              <th>Attributed positions</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(dims).map((d: any) => (
              <tr key={d.dimension}>
                <td>{d.dimension}</td>
                <td>
                  <Chip value={d.summary} />
                </td>
                <td className="small">
                  {d.mode === "selected" ? (
                    <>
                      selected by {d.selection.curator} — “{d.selection.reason}”
                    </>
                  ) : d.mode === "default" ? (
                    "nothing recorded (explicit default)"
                  ) : (
                    d.mode
                  )}
                  {d.note && <div className="muted">{d.note}</div>}
                </td>
                <td className="small">
                  {d.positions.map((p: any) => (
                    <div key={p.assessment_rev + p.dimension}>
                      <Chip value={p.value} /> {p.assessor.name ?? p.assessor.descriptor} <span className="muted">· {p.scope}</span>{" "}
                      <RevLink rev={p.assessment_rev} title="record" />
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {status.findings?.map((f: any) => (
              <tr key={f.dimension} className="finding">
                <td>review: {f.dimension}</td>
                <td>
                  <Chip value={f.summary} />
                </td>
                <td className="small">{f.mode}</td>
                <td className="small">
                  {f.positions.map((p: any) => (
                    <div key={p.assessment_rev}>
                      <Chip value={p.value} /> {p.assessor.name ?? p.assessor.descriptor} {p.locator && <span className="muted">@ {p.locator}</span>} <RevLink rev={p.assessment_rev} title="record" />
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ exposure report

export function ExposureReport({ exposure }: { exposure: any }) {
  if (!exposure) return null;
  return (
    <div className={`exposure ${exposure.ok ? "ok" : "blocked"}`}>
      <div>
        <strong>{exposure.ok ? "Exposure closure authorized" : "Exposure closure blocked"}</strong> for audience <code>{exposure.audience?.mode}</code>
      </div>
      {exposure.conflicts?.length > 0 && (
        <ul>
          {exposure.conflicts.map((c: any, i: number) => (
            <li key={i}>
              {c.rev ? <RevLink rev={c.rev} title={c.title} /> : <em>restricted item</em>} — {c.reason}
            </li>
          ))}
        </ul>
      )}
      {exposure.warnings?.map((w: string, i: number) => (
        <div key={i} className="warn small">
          ⚠ {w}
        </div>
      ))}
      {exposure.remedies?.length > 0 && <div className="small">Remedies: {exposure.remedies.join(" · ")}</div>}
      <div className="muted small">{exposure.excluded_from_closure}</div>
    </div>
  );
}

// ------------------------------------------------------------------ reference picker

export interface PickedRef {
  rev?: string;
  entity?: string;
  selector?: "latest";
  title?: string;
  seq?: number;
}

/**
 * Pick an exact revision of an entity visible to you. Choosing "latest" keeps a live selector,
 * which is allowed in drafts but must be resolved explicitly before sealing.
 */
export function RefPicker({ workspace, value, onChange, kinds, placeholder, allowLive = true }: { workspace?: string; value: PickedRef | null; onChange: (r: PickedRef | null) => void; kinds?: string[]; placeholder?: string; allowLive?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useRpc(open ? "search" : null, { text: q, workspace_id: workspace, limit: 30 }, []);
  const results = useMemo(() => (data?.results ?? []).filter((r: any) => !kinds || kinds.includes(r.kind)).filter((r: any) => r.revisions.length), [data, kinds]);
  if (value && !open)
    return (
      <span className="picked">
        {value.rev ? <RevLink rev={value.rev} title={value.title ?? value.rev} seq={value.seq} /> : <span className="live">{value.title ?? value.entity} — live “latest” (resolve before sealing)</span>}
        <button className="link" onClick={() => setOpen(true)}>
          change
        </button>
        <button className="link" onClick={() => onChange(null)}>
          clear
        </button>
      </span>
    );
  return (
    <div className="picker">
      <input autoFocus={open} placeholder={placeholder ?? "Search by title, statement or ID…"} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} />
      {open && (
        <div className="picker-results">
          {results.slice(0, 20).map((r: any) => (
            <div key={r.entity_id} className="picker-row">
              <KindBadge kind={r.kind} role={r.role} /> <span className="ptitle">{r.title}</span>
              <span className="revs">
                {r.revisions.map((rv: any) => (
                  <button key={rv.id} className="small" onClick={() => (onChange({ rev: rv.id, entity: r.entity_id, title: r.title, seq: rv.seq }), setOpen(false))}>
                    r{rv.seq}
                  </button>
                ))}
                {allowLive && (
                  <button className="small ghost" title="Live selector: allowed in drafts, must be resolved before sealing" onClick={() => (onChange({ entity: r.entity_id, selector: "latest", title: r.title }), setOpen(false))}>
                    latest…
                  </button>
                )}
              </span>
            </div>
          ))}
          {!results.length && <div className="muted small">No visible match.</div>}
          <button className="link small" onClick={() => setOpen(false)}>
            close
          </button>
        </div>
      )}
    </div>
  );
}

export function toRef(p: PickedRef | null | undefined): any {
  if (!p) return undefined;
  if (p.rev) return { rev: p.rev };
  if (p.entity) return { entity: p.entity, selector: "latest" };
  return undefined;
}

export function fromRef(r: any, titles?: Record<string, string>): PickedRef | null {
  if (!r) return null;
  if (r.rev) return { rev: r.rev, title: titles?.[r.rev] };
  if (r.entity) return { entity: r.entity, selector: "latest", title: titles?.[r.entity] };
  if (r.draft) return { title: `draft ${r.draft}` };
  return null;
}

/** Resolve titles of refs inside a content tree, for display in editors. */
export function useRefTitles(content: any) {
  const ids = useMemo(() => {
    const out = new Set<string>();
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (typeof n.rev === "string") out.add(n.rev);
      Object.values(n).forEach(walk);
    };
    walk(content);
    return [...out].sort();
  }, [content]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    const missing = ids.filter((id) => !(id in titles));
    if (!missing.length) return;
    Promise.all(missing.map((id) => rpc("revision", { rev: id }).then((r) => [id, `${r.title} · r${r.seq}`] as const).catch(() => [id, "[not accessible]"] as const))).then((pairs) =>
      setTitles((t) => ({ ...t, ...Object.fromEntries(pairs) })),
    );
  }, [ids, titles]);
  return titles;
}
