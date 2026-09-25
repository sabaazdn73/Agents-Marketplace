// ThemeToggle.jsx
//
// The one theme control, used by the web header, the mobile menu sheet, the
// landing page and every standalone page, so there is one control with one
// behaviour rather than a copy per surface.
//
// Three positions, System, Light and Dark, as a radio group. A single button
// that flips between two colours cannot express "follow my system", and that
// is the default.
//
// `labels` shows the words beside the icons, for places with the width for
// them (the mobile sheet). Without it the control is three 28px icon buttons
// whose names are in aria-label and title.

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
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-md border border-line bg-inset ${labels ? 'w-full' : ''} ${className}`}
    >
      {OPTIONS.map(({ mode: m, label, title, Icon }) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={labels ? undefined : title}
            title={title}
            data-mode={m}
            tabIndex={on ? 0 : -1}
            onClick={() => setMode(m)}
            className={`inline-flex items-center justify-center gap-1.5 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
              ${labels ? 'flex-1 h-9 text-label font-medium' : 'w-7 h-7'}
              ${on ? 'bg-surface text-fg shadow-[0_0_0_1px_rgb(var(--line-strong))]' : 'text-muted hover:text-fg'}`}
          >
            <Icon size={labels ? 15 : 14} aria-hidden="true" />
            {labels && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
