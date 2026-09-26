// LazyDetails.jsx
//
// A <details> whose body is not mounted until it is first opened.
//
// WHY. React mounts the children of a closed <details>: the browser only
// hides them. A child that fetches in an effect therefore fetches for every
// closed <details> on the page. The Explore chain views put one per agent card
// ("Evaluate this agent"), so every page of 24 cards sent 24 evaluation
// requests nobody asked for, and each "Load more" 24 more. Measured
// 2026-09-26 on Ethereum with five "Load more": 144 evaluation requests with
// no card opened.
//
// The body mounts on the first open and then stays mounted, so closing and
// reopening shows what was already read instead of reading it again. The open
// state is read from the element's own toggle event, so the browser still owns
// the open and closed behaviour (keyboard, find-in-page).

import React, { useState } from 'react';

export default function LazyDetails({ summary, summaryClassName = '', className = '', children }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={className}
      onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}
    >
      <summary className={summaryClassName}>{summary}</summary>
      {opened && children}
    </details>
  );
}
