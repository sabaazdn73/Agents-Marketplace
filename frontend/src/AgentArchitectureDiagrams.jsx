// AgentArchitectureDiagrams.jsx
//
// Real, hand-rolled inline SVG diagrams for the Learn tab's "How agents are
// built" topic — boxes-and-arrows style, inspired by the real diagram
// conventions Google's own Agent Development Kit (ADK) documentation uses
// for these same four patterns (confirmed by reading Google's public
// developer blog before building this, not assumed): rounded-rect agent
// boxes, a left-to-right chain for sequential, a radial/curved fan-out for
// parallel, and a top-down organizational tree for hierarchical. Original
// artwork throughout — no image or diagram asset copied from there, just
// the same real structural conventions, redrawn to match this site's own
// indigo palette and dark mode.
//
// No diagramming/charting library pulled in for this — same call as
// PracticeRunMarketContext.jsx's own hand-rolled sparkline: not worth a new
// dependency for a few shapes.
//
// Each diagram takes a `compact` prop (passed true on mobile's narrower
// width) that reflows the layout vertically (top-to-bottom flow) instead of
// just shrinking a wide horizontal SVG down to illegible text — fixed-size
// viewBox, width="100%" so it still scales to whatever container it's given
// (same real pattern as the sparkline), on top of the compact reflow.
//
// Shared verbatim by web and mobile.

import React from 'react';

const BOX_FILL = 'fill-indigo-50 dark:fill-indigo-500/10';
const BOX_STROKE = 'stroke-indigo-300 dark:stroke-indigo-500/50';
const BOX_TEXT = 'fill-indigo-700 dark:fill-indigo-300';
const DOT_FILL = 'fill-indigo-400 dark:fill-indigo-400';
const ARROW_STROKE = 'stroke-indigo-300 dark:stroke-indigo-600';
const LABEL_TEXT = 'fill-gray-400 dark:fill-gray-500';

/** Per-diagram-instance <defs>: a soft top-lit sheen overlay, a drop shadow,
 * and the arrowhead marker — namespaced by `uid` so multiple diagrams on the
 * same Learn page never collide on id. The sheen (a plain white-to-
 * transparent gradient, theme-safe by construction — no per-theme color
 * needed) + shadow are what lift these from flat placeholder rectangles to
 * something that actually looks designed, while staying inside the same
 * clean, minimal, high-contrast style real ADK diagrams use (clarity
 * first, not heavy decoration). The BASE fill is still the site's own
 * proven fill-indigo-50/dark:fill-indigo-500/10 utility classes (Box,
 * below) — this sheen only overlays a highlight on top of that. */
function Defs({ uid }) {
  return (
    <defs>
      <linearGradient id={`sheen-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
      <filter id={`shadow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#4F46E5" floodOpacity="0.18" />
      </filter>
      <marker id={`arrow-${uid}`} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" className="fill-indigo-300 dark:fill-indigo-600" />
      </marker>
    </defs>
  );
}

function Box({ x, y, w, h, label, uid }) {
  return (
    <g filter={`url(#shadow-${uid})`}>
      <rect x={x} y={y} width={w} height={h} rx={8} className={`${BOX_FILL} ${BOX_STROKE}`} strokeWidth={1.4} />
      <rect x={x} y={y} width={w} height={h} rx={8} fill={`url(#sheen-${uid})`} className="dark:opacity-40" />
      {/* A small "processing" glyph — three dots — the one bit of icon
          texture that separates an agent box from a plain flowchart shape,
          without pulling in an icon set for it. */}
      <g transform={`translate(${x + w - 15}, ${y + 6})`}>
        <circle cx={0} cy={2} r={1.15} className={DOT_FILL} />
        <circle cx={4.5} cy={2} r={1.15} className={DOT_FILL} opacity={0.7} />
        <circle cx={9} cy={2} r={1.15} className={DOT_FILL} opacity={0.4} />
      </g>
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" className={`${BOX_TEXT} text-[9px] font-semibold`}>{label}</text>
    </g>
  );
}

const straightArrow = (x1, y1, x2, y2, uid, key) => (
  <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} className={ARROW_STROKE} strokeWidth={1.4} markerEnd={`url(#arrow-${uid})`} />
);

/** A gently curved connector — `bend` is a SIGNED perpendicular offset the
 * caller picks per-line (negative/positive for lines fanning up/down or
 * left/right, ~0 for a line running straight through the middle), which is
 * what turns a plain straight-line fan-out into the soft radial "octopus
 * arms" curve real ADK parallel-pattern diagrams use, rather than stiff
 * diagonal segments. */
function curvedArrow(x1, y1, x2, y2, bend, uid, key) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const cx = mx + (-dy / len) * bend, cy = my + (dx / len) * bend;
  return <path key={key} d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`} fill="none" className={ARROW_STROKE} strokeWidth={1.4} markerEnd={`url(#arrow-${uid})`} />;
}

/** Single agent — one box takes a task, returns a result. The simplest
 * pattern, and the one most agents on this marketplace actually use —
 * including this project's own explainer agent. */
export function SingleAgentDiagram({ compact = false }) {
  const uid = 'single';
  const w = compact ? 160 : 200, h = 108, boxW = 92, boxH = 34;
  const cx = w / 2;
  const boxY = 40;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto overflow-visible" style={{ maxWidth: w }}>
      <Defs uid={uid} />
      <text x={cx} y={12} textAnchor="middle" className={`${LABEL_TEXT} text-[8px]`}>Task</text>
      {straightArrow(cx, 16, cx, boxY - 3, uid)}
      <Box x={cx - boxW / 2} y={boxY} w={boxW} h={boxH} label="Agent" uid={uid} />
      {straightArrow(cx, boxY + boxH, cx, h - 12, uid)}
      <text x={cx} y={h - 3} textAnchor="middle" className={`${LABEL_TEXT} text-[8px]`}>Result</text>
    </svg>
  );
}

/** Sequential — fixed chain of steps, each one's output feeding the next,
 * left-to-right like an assembly line (kept straight — that's the correct,
 * clean read for a strict hand-off order, unlike the fan patterns below). */
export function SequentialDiagram({ compact = false }) {
  const uid = 'seq';
  const steps = ['Step 1', 'Step 2', 'Step 3'];
  if (compact) {
    const boxW = 130, boxH = 30, gap = 24, w = 160;
    const h = steps.length * boxH + (steps.length - 1) * gap + 8;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto overflow-visible" style={{ maxWidth: w }}>
        <Defs uid={uid} />
        {steps.map((s, i) => {
          const y = 4 + i * (boxH + gap);
          return (
            <React.Fragment key={s}>
              <Box x={(w - boxW) / 2} y={y} w={boxW} h={boxH} label={s} uid={uid} />
              {i < steps.length - 1 && straightArrow(w / 2, y + boxH, w / 2, y + boxH + gap, uid)}
            </React.Fragment>
          );
        })}
      </svg>
    );
  }
  const boxW = 82, boxH = 34, gap = 30, w = steps.length * boxW + (steps.length - 1) * gap, h = 50;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto overflow-visible" style={{ maxWidth: w }}>
      <Defs uid={uid} />
      {steps.map((s, i) => {
        const x = i * (boxW + gap);
        return (
          <React.Fragment key={s}>
            <Box x={x} y={(h - boxH) / 2} w={boxW} h={boxH} label={s} uid={uid} />
            {i < steps.length - 1 && straightArrow(x + boxW, h / 2, x + boxW + gap, h / 2, uid)}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

/** Parallel — one task fanned out to several specialists working at once,
 * then combined back into one result — a soft radial curve on each
 * connector (the real visual Google's own ADK parallel-pattern diagrams
 * use for this: "octopus arms" fanning out and gathering back in), not
 * stiff diagonal lines. */
export function ParallelDiagram({ compact = false }) {
  const uid = 'par';
  const specialists = ['Specialist A', 'Specialist B', 'Specialist C'];
  const bends = [-10, 0, 10]; // fan curve per row: up, straight, down (mirrored for the vertical layout)
  if (compact) {
    const boxW = 82, boxH = 26, gapX = 6, capW = 96, capH = 26;
    const rowW = specialists.length * boxW + (specialists.length - 1) * gapX;
    const w = Math.max(rowW, capW) + 8;
    const capX = (w - capW) / 2, taskY = 4;
    const rowY = taskY + capH + 22;
    const rowX0 = (w - rowW) / 2;
    const combineY = rowY + boxH + 22;
    const h = combineY + capH + 4;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto overflow-visible" style={{ maxWidth: w }}>
        <Defs uid={uid} />
        <Box x={capX} y={taskY} w={capW} h={capH} label="Task" uid={uid} />
        {specialists.map((s, i) => {
          const x = rowX0 + i * (boxW + gapX);
          return (
            <React.Fragment key={s}>
              {curvedArrow(capX + capW / 2, taskY + capH, x + boxW / 2, rowY, bends[i], uid)}
              <Box x={x} y={rowY} w={boxW} h={boxH} label={s} uid={uid} />
              {curvedArrow(x + boxW / 2, rowY + boxH, capX + capW / 2, combineY, -bends[i], uid)}
            </React.Fragment>
          );
        })}
        <Box x={capX} y={combineY} w={capW} h={capH} label="Combine" uid={uid} />
      </svg>
    );
  }
  const capW = 70, capH = 30, boxW = 96, boxH = 26, colGap = 46, rowGap = 8;
  const rowsX = capW + colGap;
  const combineX = rowsX + boxW + colGap;
  const w = combineX + capW;
  const h = specialists.length * boxH + (specialists.length - 1) * rowGap + 8;
  const capY = h / 2 - capH / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto overflow-visible" style={{ maxWidth: w }}>
      <Defs uid={uid} />
      <Box x={0} y={capY} w={capW} h={capH} label="Task" uid={uid} />
      {specialists.map((s, i) => {
        const y = 4 + i * (boxH + rowGap);
        return (
          <React.Fragment key={s}>
            {curvedArrow(capW, capY + capH / 2, rowsX, y + boxH / 2, bends[i], uid)}
            <Box x={rowsX} y={y} w={boxW} h={boxH} label={s} uid={uid} />
            {curvedArrow(rowsX + boxW, y + boxH / 2, combineX, capY + capH / 2, -bends[i], uid)}
          </React.Fragment>
        );
      })}
      <Box x={combineX} y={capY} w={capW} h={capH} label="Combine" uid={uid} />
    </svg>
  );
}

/** Hierarchical — an orchestrator delegates pieces of the task to sub-agents,
 * each running its own smaller job underneath it — a real top-down
 * organizational tree, softly curved delegate lines for the same polished
 * feel as the parallel diagram's fan. */
export function HierarchicalDiagram({ compact = false }) {
  const uid = 'hier';
  const children = ['Sub-agent', 'Sub-agent', 'Sub-agent'];
  const bends = [-8, 0, 8];
  const boxW = compact ? 68 : 84, boxH = 26, gapX = compact ? 6 : 12;
  const rowW = children.length * boxW + (children.length - 1) * gapX;
  const topW = 104, topH = 28;
  const w = Math.max(rowW, topW) + 8;
  const topX = (w - topW) / 2, topY = 4;
  const rowY = topY + topH + 24;
  const rowX0 = (w - rowW) / 2;
  const h = rowY + boxH + 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto overflow-visible" style={{ maxWidth: w }}>
      <Defs uid={uid} />
      <Box x={topX} y={topY} w={topW} h={topH} label="Orchestrator" uid={uid} />
      {children.map((c, i) => {
        const x = rowX0 + i * (boxW + gapX);
        return (
          <React.Fragment key={i}>
            {curvedArrow(topX + topW / 2, topY + topH, x + boxW / 2, rowY, bends[i], uid)}
            <Box x={x} y={rowY} w={boxW} h={boxH} label={c} uid={uid} />
          </React.Fragment>
        );
      })}
    </svg>
  );
}
