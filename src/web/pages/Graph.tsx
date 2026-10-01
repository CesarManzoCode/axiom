// Bounded local neighbourhood. Relations are drawn as their own (diamond) nodes with
// role-labelled edges, so n-ary structure is never flattened into anonymous arrows.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorBox, Loading, useRpc } from "../ui.tsx";

export function LocalGraph({ rev }: { rev: string }) {
  const [depth, setDepth] = useState(1);
  const [citations, setCitations] = useState(false);
  const [assessments, setAssessments] = useState(false);
  const { data, error } = useRpc("localGraph", { rev, depth, include_citations: citations, include_assessments: assessments, max: 60 });
  const nav = useNavigate();
  const layout = useMemo(() => {
    if (!data) return null;
    const adj = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      if (!adj.has(e.to)) adj.set(e.to, new Set());
      adj.get(e.from)!.add(e.to);
      adj.get(e.to)!.add(e.from);
    }
    const level = new Map<string, number>([[data.center, 0]]);
    const q = [data.center];
    while (q.length) {
      const cur = q.shift()!;
      for (const n of adj.get(cur) ?? [])
        if (!level.has(n)) {
          level.set(n, level.get(cur)! + 1);
          q.push(n);
        }
    }
    const rings = new Map<number, string[]>();
    for (const n of data.nodes) {
      const l = level.get(n.id) ?? 3;
      rings.set(l, [...(rings.get(l) ?? []), n.id]);
    }
    const W = 900, H = 640, cx = W / 2, cy = H / 2;
    const pos = new Map<string, [number, number]>();
    for (const [l, ids] of rings) {
      ids.forEach((id, i) => {
        if (l === 0) return pos.set(id, [cx, cy]);
        const a = (2 * Math.PI * i) / ids.length + l * 0.4;
        const r = Math.max(150, ids.length * 22) * l;
        pos.set(id, [cx + Math.min(r * 1.4, 400 * l) * Math.cos(a), cy + Math.min(r, 280) * Math.sin(a)]);
      });
    }
    return { W, H, pos };
  }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data || !layout) return <Loading />;
  const { W, H, pos } = layout;
  const byId = new Map(data.nodes.map((n: any) => [n.id, n]));
  return (
    <div className="graph">
      <div className="row small">
        Depth{" "}
        <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
          <option value={1}>1</option>
          <option value={2}>2</option>
        </select>
        <label>
          <input type="checkbox" checked={citations} onChange={(e) => setCitations(e.target.checked)} /> show citations/influence
        </label>
        <label>
          <input type="checkbox" checked={assessments} onChange={(e) => setAssessments(e.target.checked)} /> show assessments
        </label>
        <span className="muted">
          {data.nodes.length} nodes · relations are diamonds; edge labels are roles · candidates and context edges hidden {data.truncated && `· ${data.note}`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Local graph">
        {data.edges.map((e: any, i: number) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <g key={i} className={`edge via-${e.via}`}>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
              <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2} className="edgelabel">
                {e.role ?? e.via}
              </text>
            </g>
          );
        })}
        {[...pos.entries()].map(([id, [x, y]]) => {
          const n: any = byId.get(id);
          if (!n) return null;
          const isRel = n.kind === "relation";
          const label = n.title.length > 34 ? n.title.slice(0, 32) + "…" : n.title;
          return (
            <g key={id} className={`node kind-${n.kind} ${id === data.center ? "center" : ""}`} onClick={() => nav(`/e/${n.entity}?rev=${id}`)} style={{ cursor: "pointer" }}>
              {isRel ? <polygon points={`${x},${y - 12} ${x + 12},${y} ${x},${y + 12} ${x - 12},${y}`} /> : <circle cx={x} cy={y} r={id === data.center ? 11 : 8} />}
              <text x={x} y={y + 24} textAnchor="middle">
                {isRel && n.contract ? `[${n.contract}] ` : ""}
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
