// ThemeToggle.jsx
//
// The one theme control, used by the web header, the mobile menu sheet, the
// landing page and every standalone page, so there is one control with one
// behaviour rather than a copy per surface.
//
// Three positions, System, Light and Dark. A control that flips between two
// colours cannot express "follow my system", and that is the default.
//
// Two forms of the same three positions:
// - `labels`: a radio group with the words beside the icons, for places with
//   the width for them (the mobile sheet).
// - otherwise one 32px icon button showing the current position, which moves
//   to the next on each press (System, Light, Dark, then System again). Its
//   accessible name says both where it is and where a press takes it. This is
//   the header form: three buttons there cost the width of a page tab.

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

  if (!labels) {
    const i = Math.max(0, OPTIONS.findIndex((o) => o.mode === mode));
    const cur = OPTIONS[i];
    const next = OPTIONS[(i + 1) % OPTIONS.length];
    const Icon = cur.Icon;
    const name = `Theme: ${cur.label}. Switch to ${next.label}.`;
    return (
      <button
        type="button"
        onClick={() => setMode(next.mode)}
        aria-label={name}
        title={persisted ? name : `${name} This browser is not saving site data, so the theme resets on the next visit.`}
        data-mode={cur.mode}
        className={`w-8 h-8 shrink-0 rounded flex items-center justify-center text-muted hover:text-fg hover:bg-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    );
  }

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
      className={`inline-flex w-full items-center gap-0.5 p-0.5 rounded-md border border-line bg-inset ${className}`}
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
            data-mode={m}
            tabIndex={on ? 0 : -1}
            onClick={() => setMode(m)}
            className={`inline-flex items-center justify-center gap-1.5 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
              flex-1 h-9 text-label font-medium
              ${on ? 'bg-surface text-fg shadow-[0_0_0_1px_rgb(var(--line-strong))]' : 'text-muted hover:text-fg'}`}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
