import { DIAGRAMS, type FlowDiagram, type FlowNode } from "@/lib/diagrams";

/**
 * Draws a diagram from lib/diagrams.ts as inline SVG: nodes on a grid,
 * labelled edges routed straight or with one elbow, lanes as bands behind
 * rows. Strokes and text use `currentColor`, so the figure follows the page
 * in both themes; the store node alone carries the accent colour.
 *
 * Text is not measured (this renders on the server), so edge labels sit
 * above the row of boxes rather than on the line, where a label wider than
 * the gap cannot collide with anything.
 */

const PAD = 16;
const NODE_W = 136;
const NODE_H = 48;
const COL_GAP = 68;
const ROW_GAP = 28;
const LANE_TOP = 26;
const LANE_BOTTOM = 12;
const LANE_GAP = 12;
const LABEL_LIFT = 6;

interface Layout {
  width: number;
  height: number;
  colX: (col: number) => number;
  rowTop: number[];
}

function layout(diagram: FlowDiagram): Layout {
  const maxRow = Math.max(...diagram.nodes.map((n) => n.row + (n.rowSpan ?? 1) - 1));
  const maxCol = Math.max(...diagram.nodes.map((n) => n.col));
  const laneStart = new Set(diagram.lanes?.map((l) => l.rows[0]));
  const laneEnd = new Set(diagram.lanes?.map((l) => l.rows[1]));

  const rowTop: number[] = [];
  let y = PAD;
  for (let row = 0; row <= maxRow; row++) {
    if (laneStart.has(row)) y += LANE_TOP;
    rowTop[row] = y;
    y += NODE_H;
    if (laneEnd.has(row)) {
      y += LANE_BOTTOM;
      if (row < maxRow) y += LANE_GAP;
    } else if (row < maxRow) {
      y += ROW_GAP;
    }
  }

  return {
    width: PAD * 2 + (maxCol + 1) * NODE_W + maxCol * COL_GAP,
    height: y + PAD,
    colX: (col) => PAD + col * (NODE_W + COL_GAP),
    rowTop,
  };
}

interface Box {
  node: FlowNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre y of a given row inside the box, for edges that meet it at that row. */
  yAt: (row: number) => number;
}

function boxOf(node: FlowNode, l: Layout): Box {
  const span = node.rowSpan ?? 1;
  const y = l.rowTop[node.row] as number;
  const bottom = (l.rowTop[node.row + span - 1] as number) + NODE_H;
  return {
    node,
    x: l.colX(node.col),
    y,
    w: NODE_W,
    h: bottom - y,
    yAt: (row) =>
      (l.rowTop[Math.min(Math.max(row, node.row), node.row + span - 1)] as number) + NODE_H / 2,
  };
}

/** Which row an edge between two boxes runs in: the single-row side wins. */
function edgeRow(from: Box, to: Box): number {
  if ((from.node.rowSpan ?? 1) > 1) return to.node.row;
  return from.node.row;
}

function Edge({
  from,
  to,
  label,
  both,
  marker,
  rowTop,
}: {
  from: Box;
  to: Box;
  label?: string;
  both?: boolean;
  marker: string;
  rowTop: number[];
}) {
  const row = edgeRow(from, to);
  const yFrom = from.yAt(row);
  const yTo = to.yAt(row);
  const labelY = (rowTop[row] as number) - LABEL_LIFT;
  const fromTall = (from.node.rowSpan ?? 1) > 1;
  const toTall = (to.node.rowSpan ?? 1) > 1;

  if (to.node.col > from.node.col && (yFrom === yTo || fromTall || toTall)) {
    const x1 = from.x + from.w;
    const x2 = to.x;
    // A label floats above the row, where boxes are below it, except beside a
    // tall box, which the row's label line runs through: there the label is
    // anchored to the gap's far side so it can only extend over a short box.
    const anchor = toTall ? "end" : fromTall ? "start" : "middle";
    const x = toTall ? x2 - 4 : fromTall ? x1 + 4 : (x1 + x2) / 2;
    return (
      <g>
        <line x1={x1} y1={yFrom} x2={x2} y2={yFrom} markerEnd={`url(#${marker})`} />
        {label ? (
          <text x={x} y={labelY} className="db-flow-label" textAnchor={anchor}>
            {label}
          </text>
        ) : null}
      </g>
    );
  }

  if (to.node.col > from.node.col) {
    // One elbow: out of the right edge, across to the target's centre line,
    // then up or down into the nearer edge.
    const x1 = from.x + from.w;
    const xc = to.x + to.w / 2;
    const yEnd = yFrom > yTo ? to.y + to.h : to.y;
    return (
      <g>
        <polyline
          points={`${x1},${yFrom} ${xc},${yFrom} ${xc},${yEnd}`}
          fill="none"
          markerEnd={`url(#${marker})`}
        />
        {label ? (
          <text x={(x1 + xc) / 2} y={labelY} className="db-flow-label" textAnchor="middle">
            {label}
          </text>
        ) : null}
      </g>
    );
  }

  // Same column, downwards. A two-way edge gets an arrowhead at each end:
  // the marker is oriented by `auto-start-reverse`, so the start one points
  // back at the source.
  const xc = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const y2 = to.y;
  return (
    <g>
      <line
        x1={xc}
        y1={y1}
        x2={xc}
        y2={y2}
        markerStart={both ? `url(#${marker})` : undefined}
        markerEnd={`url(#${marker})`}
      />
      {label ? (
        <text x={xc + 8} y={(y1 + y2) / 2 + 4} className="db-flow-label" textAnchor="start">
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function Flow({ name }: { name: string }) {
  const diagram = DIAGRAMS[name];
  if (!diagram) throw new Error(`No diagram named "${name}" in lib/diagrams.ts`);

  const l = layout(diagram);
  const boxes = new Map(diagram.nodes.map((node) => [node.id, boxOf(node, l)]));
  const marker = `db-flow-arrow-${name}`;

  return (
    <figure className="db-flow">
      <svg
        viewBox={`0 0 ${l.width} ${l.height}`}
        role="img"
        aria-label={diagram.caption}
        style={{ minWidth: Math.min(l.width, 640) }}
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="currentColor" />
          </marker>
        </defs>

        {diagram.lanes?.map((lane) => {
          const x = l.colX(lane.cols[0]) - 10;
          const y = (l.rowTop[lane.rows[0]] as number) - LANE_TOP + 4;
          const w = l.colX(lane.cols[1]) + NODE_W + 10 - x;
          const h = (l.rowTop[lane.rows[1]] as number) + NODE_H + LANE_BOTTOM - 4 - y;
          return (
            <g key={lane.title} className="db-flow-lane">
              <rect x={x} y={y} width={w} height={h} rx="10" />
              <text x={x + 12} y={y + 15}>
                {lane.title}
              </text>
            </g>
          );
        })}

        <g className="db-flow-edges">
          {diagram.edges.map((edge) => {
            const from = boxes.get(edge.from);
            const to = boxes.get(edge.to);
            if (!from || !to)
              throw new Error(`Edge ${edge.from} -> ${edge.to} names a missing node`);
            return (
              <Edge
                key={`${edge.from}-${edge.to}`}
                from={from}
                to={to}
                label={edge.label}
                both={edge.both}
                marker={marker}
                rowTop={l.rowTop}
              />
            );
          })}
        </g>

        {[...boxes.values()].map((box) => {
          const lines = box.node.label.split("\n");
          const sub = box.node.sublabel;
          // Centre the text block: label lines 16px apart, the sub-line 15px
          // below the last of them.
          const blockH = (lines.length - 1) * 16 + (sub ? 15 : 0);
          const cx = box.x + box.w / 2;
          const first = box.y + box.h / 2 - blockH / 2 + 4.5;
          return (
            <g key={box.node.id} className="db-flow-node" data-kind={box.node.kind ?? "default"}>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="8" />
              <text x={cx} y={first} textAnchor="middle">
                {lines.map((line, i) => (
                  <tspan key={line} x={cx} dy={i === 0 ? 0 : 16}>
                    {line}
                  </tspan>
                ))}
              </text>
              {sub ? (
                <text
                  x={cx}
                  y={first + (lines.length - 1) * 16 + 15}
                  textAnchor="middle"
                  className="db-flow-sublabel"
                >
                  {sub}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption>{diagram.caption}</figcaption>
    </figure>
  );
}
