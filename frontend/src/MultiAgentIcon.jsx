// MultiAgentIcon.jsx
//
// The nav mark for MultiAgents: three agents at the points of a triangle,
// each joined to the other two.
//
// A single robot said "an agent". This tab is about several of them working
// together and handing work between each other, so the mark shows the
// connections rather than one figure. The links are drawn under the nodes
// so they read as joining the centres rather than stopping at the edges.
//
// It takes the same props as a lucide icon, size and className and colour
// through currentColor, because the nav renders every entry the same way
// and a mark that needed special handling would be a mark that breaks the
// next time the nav changes.

import React from 'react';

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
      {/* The three links first, so the nodes sit on top of them. They stop
          short of each centre, which keeps the join looking like a line
          arriving at an agent rather than passing through it. */}
      <path d="M10.6 7.9 6.4 15.2" opacity="0.75" />
      <path d="M13.4 7.9 17.6 15.2" opacity="0.75" />
      <path d="M8.1 18h7.8" opacity="0.75" />

      {/* Three agents. Filled and large enough to carry the mark at 16px,
          where thin outlines collapse into a plain triangle. The top one is
          slightly bigger so the shape has an obvious upright orientation. */}
      <circle cx="12" cy="5.4" r="3.1" fill="currentColor" stroke="none" />
      <circle cx="5.3" cy="18" r="2.7" fill="currentColor" stroke="none" />
      <circle cx="18.7" cy="18" r="2.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
