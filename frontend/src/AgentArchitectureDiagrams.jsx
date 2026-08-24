// AgentArchitectureDiagrams.jsx
//
// Real, hand-rolled inline SVG diagrams for the Learn tab's "How agents are
// built" topic — boxes-and-arrows style. No diagramming/charting library
// pulled in for this, same call as PracticeRunMarketContext.jsx's own
// hand-rolled sparkline: not worth a new dependency for a few simple shapes.
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
const BOX_STROKE = 'stroke-indigo-300 dark:stroke-indigo-500/40';
const BOX_TEXT = 'fill-indigo-700 dark:fill-indigo-300';
const ARROW_STROKE = 'stroke-gray-400 dark:stroke-gray-500';
const LABEL_TEXT = 'fill-gray-400 dark:fill-gray-500';

function Box({ x, y, w, h, label }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={7} className={`${BOX_FILL} ${BOX_STROKE}`} strokeWidth={1.4} />
      <text x={x + w / 2} y={y + h / 2 + 3.5} textAnchor="middle" className={`${BOX_TEXT} text-[9px] font-semibold`}>{label}</text>
    </g>
  );
}

function Defs({ id }) {
  return (
    <defs>
      <marker id={id} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" className="fill-gray-400 dark:fill-gray-500" />
      </marker>
    </defs>
  );
}

const arrowLine = (x1, y1, x2, y2, markerId, key) => (
  <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} className={ARROW_STROKE} strokeWidth={1.3} markerEnd={`url(#${markerId})`} />
);

/** Single agent — one box takes a task, returns a result. The simplest
 * pattern, and the one most agents on this marketplace actually use. */
export function SingleAgentDiagram({ compact = false }) {
  const w = compact ? 160 : 200, h = 108, boxW = 92, boxH = 34;
  const cx = w / 2;
  const boxY = 40;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto" style={{ maxWidth: w }}>
      <Defs id="arr-single" />
      <text x={cx} y={12} textAnchor="middle" className={`${LABEL_TEXT} text-[8px]`}>Task</text>
      {arrowLine(cx, 16, cx, boxY - 3, 'arr-single')}
      <Box x={cx - boxW / 2} y={boxY} w={boxW} h={boxH} label="Agent" />
      {arrowLine(cx, boxY + boxH, cx, h - 12, 'arr-single')}
      <text x={cx} y={h - 3} textAnchor="middle" className={`${LABEL_TEXT} text-[8px]`}>Result</text>
    </svg>
  );
}

/** Sequential — fixed chain of steps, each one's output feeding the next. */
export function SequentialDiagram({ compact = false }) {
  const steps = ['Step 1', 'Step 2', 'Step 3'];
  if (compact) {
    const boxW = 130, boxH = 30, gap = 24, w = 160;
    const h = steps.length * boxH + (steps.length - 1) * gap + 8;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto" style={{ maxWidth: w }}>
        <Defs id="arr-seq-v" />
        {steps.map((s, i) => {
          const y = 4 + i * (boxH + gap);
          return (
            <React.Fragment key={s}>
              <Box x={(w - boxW) / 2} y={y} w={boxW} h={boxH} label={s} />
              {i < steps.length - 1 && arrowLine(w / 2, y + boxH, w / 2, y + boxH + gap, 'arr-seq-v')}
            </React.Fragment>
          );
        })}
      </svg>
    );
  }
  const boxW = 82, boxH = 34, gap = 30, w = steps.length * boxW + (steps.length - 1) * gap, h = 50;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto" style={{ maxWidth: w }}>
      <Defs id="arr-seq-h" />
      {steps.map((s, i) => {
        const x = i * (boxW + gap);
        return (
          <React.Fragment key={s}>
            <Box x={x} y={(h - boxH) / 2} w={boxW} h={boxH} label={s} />
            {i < steps.length - 1 && arrowLine(x + boxW, h / 2, x + boxW + gap, h / 2, 'arr-seq-h')}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

/** Parallel — one task fanned out to several specialists working at once,
 * then combined back into one result. */
export function ParallelDiagram({ compact = false }) {
  const specialists = ['Specialist A', 'Specialist B', 'Specialist C'];
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
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto" style={{ maxWidth: w }}>
        <Defs id="arr-par-v" />
        <Box x={capX} y={taskY} w={capW} h={capH} label="Task" />
        {specialists.map((s, i) => {
          const x = rowX0 + i * (boxW + gapX);
          return (
            <React.Fragment key={s}>
              {arrowLine(capX + capW / 2, taskY + capH, x + boxW / 2, rowY, 'arr-par-v')}
              <Box x={x} y={rowY} w={boxW} h={boxH} label={s} />
              {arrowLine(x + boxW / 2, rowY + boxH, capX + capW / 2, combineY, 'arr-par-v')}
            </React.Fragment>
          );
        })}
        <Box x={capX} y={combineY} w={capW} h={capH} label="Combine" />
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
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto" style={{ maxWidth: w }}>
      <Defs id="arr-par-h" />
      <Box x={0} y={capY} w={capW} h={capH} label="Task" />
      {specialists.map((s, i) => {
        const y = 4 + i * (boxH + rowGap);
        return (
          <React.Fragment key={s}>
            {arrowLine(capW, capY + capH / 2, rowsX, y + boxH / 2, 'arr-par-h')}
            <Box x={rowsX} y={y} w={boxW} h={boxH} label={s} />
            {arrowLine(rowsX + boxW, y + boxH / 2, combineX, capY + capH / 2, 'arr-par-h')}
          </React.Fragment>
        );
      })}
      <Box x={combineX} y={capY} w={capW} h={capH} label="Combine" />
    </svg>
  );
}

/** Hierarchical — an orchestrator delegates pieces of the task to sub-agents,
 * each running its own smaller job underneath it. */
export function HierarchicalDiagram({ compact = false }) {
  const children = ['Sub-agent', 'Sub-agent', 'Sub-agent'];
  const boxW = compact ? 68 : 84, boxH = 26, gapX = compact ? 6 : 12;
  const rowW = children.length * boxW + (children.length - 1) * gapX;
  const topW = 104, topH = 28;
  const w = Math.max(rowW, topW) + 8;
  const topX = (w - topW) / 2, topY = 4;
  const rowY = topY + topH + 24;
  const rowX0 = (w - rowW) / 2;
  const h = rowY + boxH + 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block mx-auto" style={{ maxWidth: w }}>
      <Defs id="arr-hier" />
      <Box x={topX} y={topY} w={topW} h={topH} label="Orchestrator" />
      {children.map((c, i) => {
        const x = rowX0 + i * (boxW + gapX);
        return (
          <React.Fragment key={i}>
            {arrowLine(topX + topW / 2, topY + topH, x + boxW / 2, rowY, 'arr-hier')}
            <Box x={x} y={rowY} w={boxW} h={boxH} label={c} />
          </React.Fragment>
        );
      })}
    </svg>
  );
}
