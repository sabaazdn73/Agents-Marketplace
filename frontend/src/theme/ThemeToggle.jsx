// ThemeToggle.jsx
//
// The one theme control, used by the web header, the mobile menu sheet, the
// landing page and every standalone page, so there is one control with one
// behaviour rather than a copy per surface.
//
// Three positions, System, Light and Dark. A control that flips between two
// colours cannot express "follow my system", and that is the default.
//
// One segmented control, visible in full everywhere (owner, 2026-09-26: keep
// the three-way toggle), in two sizes:
// - `labels`: the words beside the icons, full width, for places with the
//   room (the mobile menu sheet).
// - otherwise the three icons alone, 28px each, for the web header, the
//   mobile header and the standalone pages. It replaced a single button that
//   cycled through the three positions and showed only the current one.
// Either way it is a radio group: arrow keys move between the positions.

import React from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeProvider';

const OPTIONS = [
  { mode: 'system', label: 'System', title: 'Follow the system setting', Icon: Monitor },
  { mode: 'light', label: 'Light', title: 'Light theme', Icon: Sun },
  { mode: 'dark', label: 'Dark', title: 'Dark theme', Icon: Moon },
];

export default function ThemeToggle({ labels = false, className = '' }) {
  const { mode, setMode, persisted } = useTheme();

  const onKeyDown = (e) => {
    const i = OPTIONS.findIndex((o) => o.mode === mode);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = OPTIONS[(i + 1) % OPTIONS.length];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = OPTIONS[(i + OPTIONS.length - 1) % OPTIONS.length];
    if (next) {
      e.preventDefault();
      setMode(next.mode);
      e.currentTarget.querySelector(`[data-mode="${next.mode}"]`)?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      title={persisted ? undefined : 'This browser is not saving site data, so the theme resets on the next visit.'}
      className={`glass-bar ${labels ? 'w-full' : 'shrink-0'} ${className}`}
    >
      {OPTIONS.map(({ mode: m, label, title, Icon }) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            title={title}
            aria-label={labels ? undefined : label}
            data-mode={m}
            tabIndex={on ? 0 : -1}
            onClick={() => setMode(m)}
            className={`glass-tab inline-flex items-center justify-center gap-1.5
              ${labels ? `flex-1 h-9 text-label ${on ? 'font-semibold' : 'font-medium'}` : 'w-7 h-7'}`}
          >
            <Icon size={labels ? 15 : 14} aria-hidden="true" />
            {labels && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
