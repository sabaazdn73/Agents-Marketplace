// MultiAgentIcon.jsx
//
// The nav mark for MultiAgents: three little robots standing side by side.
//
// A single robot said "an agent". This tab is about several of them working
// on one job, so the mark shows a row of them.
//
// Two earlier versions are worth recording, because both failed the same
// test: what it looks like at the 17px the sidebar actually renders.
//
//  1. Three filled circles joined by lines. At 17px that is a triangle of
//     dots and says nothing about agents.
//  2. The same three as robots, still at the points of a triangle, still
//     joined. The links ran through the bodies, so the whole mark fused
//     into one blob and crowded its neighbours in the rail.
//  3. A row, but with a narrow head over wide shoulders, which merged into
//     a bowling-pin shape: recognisably a figure, not recognisably a robot.
//     A robot needs the head to be the wide part.
//
// So: a row, no connecting lines, and every shape inside a deliberate box.
// Nothing is drawn above y=5.2 or below y=18.4, which keeps the mark clear
// of the label and the rows above and below it.
//
// It takes the same props as a lucide icon, size and className and colour
// through currentColor, because the nav renders every entry the same way and
// a mark that needed special handling would be a mark that breaks the next
// time the nav changes.

import React from 'react';

/** One robot: antenna, head, shoulders, drawn from a centre x.
 *
 *  The head and shoulders OVERLAP on purpose. An earlier version left a
 *  1.3px gap between them, and at the 17px the sidebar renders that gap
 *  survives while the detail does not, so the mark read as six loose bars in
 *  a grid rather than three figures. Overlapping them merges each pair into
 *  one silhouette, which is what makes it a robot instead of two rectangles. */
function Bot({ cx }) {
  return (
    <>
      {/* Antenna. */}
      <path d={`M${cx} 3.9v1.5`} opacity="0.85" />
      {/* Head: WIDE and square-ish, and wider than the body. The proportion
          is what carries the reading at 17px. An earlier version had a
          narrow head on wide shoulders, which merged into a bowling-pin
          silhouette: a figure, but not a robot. */}
      <rect x={cx - 3} y="5.4" width="6" height="5.6" rx="1.8" fill="currentColor" stroke="none" />
      {/* Body: narrower, overlapping the head so the two stay one shape. */}
      <rect x={cx - 2.1} y="10.2" width="4.2" height="6.6" rx="1.5" fill="currentColor" stroke="none" />
    </>
  );
}

export default function MultiAgentIcon({ size = 24, className = '', strokeWidth = 1.5, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {/* Centres 7.5 apart with shoulders 6 wide, so 1.5px of clear space
          separates neighbours. That gap is what stops the row collapsing
          into one solid bar once it is scaled down to the rail. */}
      <Bot cx={4.5} />
      <Bot cx={12} />
      <Bot cx={19.5} />
    </svg>
  );
}
