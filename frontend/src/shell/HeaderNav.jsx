// HeaderNav.jsx
//
// The web header's tab row, with the tabs that do not fit moved into a More
// menu.
//
// WHY NOT A SCROLLING ROW
// The first version scrolled sideways with its scrollbar hidden. At 1280 the
// last tab was off screen, at 1024 three were, at 800 everything after the
// second, and a mouse has no way to scroll a row whose scrollbar is hidden.
// Tabs you cannot reach are tabs that do not exist.
//
// HOW IT DECIDES
// Every tab is rendered once more in an invisible row, at its widest state
// (the active weight), and measured. A ResizeObserver on the space the header
// gives the row re-runs the fit: tabs are taken in order until the next one,
// plus room for the More button, would not fit. The rest go in the menu, in
// the same order.
//
// The active tab is never in the menu. If it would have been, it takes the
// place of the last tab that fit, and more tabs are dropped from the end until
// the row fits again. Which page you are on should not be one click away.
//
// THE MENU
// A button with aria-haspopup="menu" and a list of menuitems. Enter, Space
// or ArrowDown opens it on the first item and ArrowUp on the last; the arrow
// keys, Home and End move; Escape closes it and returns focus to the button;
// Tab or a click outside closes it.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const GAP = 4; // gap-1 between tabs

function tabClass(active) {
  return `relative shrink-0 h-full flex items-center gap-1.5 px-2.5 text-body whitespace-nowrap transition-colors ${
    active ? 'text-fg font-semibold' : 'text-muted font-medium hover:text-fg'}`;
}

export default function HeaderNav({ items, active, onSelect }) {
  const boxRef = useRef(null);
  const measureRef = useRef(null);
  const moreMeasureRef = useRef(null);
  const moreBtnRef = useRef(null);
  const menuRef = useRef(null);
  const [visibleIds, setVisibleIds] = useState(() => items.map((i) => i.id));
  const [open, setOpen] = useState(false);

  const fit = useCallback(() => {
    const box = boxRef.current;
    const row = measureRef.current;
    if (!box || !row) return;
    const avail = box.clientWidth;
    const widths = [...row.children].map((el) => el.offsetWidth);
    const moreW = (moreMeasureRef.current?.offsetWidth || 72) + GAP;
    const total = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, widths.length - 1);
    if (total <= avail) {
      setVisibleIds(items.map((i) => i.id));
      return;
    }
    const budget = avail - moreW;
    let chosen = [];
    let used = 0;
    for (let i = 0; i < items.length; i += 1) {
      const add = widths[i] + (chosen.length ? GAP : 0);
      if (used + add > budget) break;
      chosen.push(i);
      used += add;
    }
    const activeIdx = items.findIndex((i) => i.id === active);
    if (activeIdx >= 0 && !chosen.includes(activeIdx)) {
      chosen.push(activeIdx);
      const width = (idx) => idx.reduce((a, i) => a + widths[i], 0) + GAP * Math.max(0, idx.length - 1);
      while (chosen.length > 1 && width(chosen) > budget) {
        const dropAt = chosen.length - 2; // the last one that is not the active tab
        chosen.splice(dropAt, 1);
      }
      chosen.sort((a, b) => a - b);
    }
    setVisibleIds(chosen.map((i) => items[i].id));
  }, [items, active]);

  useLayoutEffect(() => { fit(); }, [fit]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => fit());
    ro.observe(box);
    return () => ro.disconnect();
  }, [fit]);

  // Web fonts are not used, but system fonts can still settle after first
  // layout on some platforms, so measure once more when they report ready.
  useEffect(() => {
    if (document.fonts?.ready) document.fonts.ready.then(() => fit()).catch(() => {});
  }, [fit]);

  const overflow = items.filter((i) => !visibleIds.includes(i.id));
  const visible = items.filter((i) => visibleIds.includes(i.id));

  const focusItem = (idx) => {
    const els = menuRef.current?.querySelectorAll('[role="menuitem"]');
    if (!els || !els.length) return;
    const n = els.length;
    els[((idx % n) + n) % n].focus();
  };

  const openMenu = (focusIdx) => {
    setOpen(true);
    requestAnimationFrame(() => focusItem(focusIdx));
  };

  const closeMenu = (returnFocus) => {
    setOpen(false);
    if (returnFocus) moreBtnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !moreBtnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Nothing left in the menu, for instance after the window grew: close it.
  useEffect(() => { if (!overflow.length) setOpen(false); }, [overflow.length]);

  const onButtonKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(0); }
    if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(-1); }
  };

  const onMenuKey = (e) => {
    const els = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0 h-full flex items-stretch">
      {/* The measuring row: every tab at its widest, never seen or read. */}
      <div ref={measureRef} aria-hidden="true" className="absolute left-0 top-0 h-0 overflow-hidden invisible flex gap-1 pointer-events-none">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <span key={item.id} className={tabClass(true)}>
              <Icon size={15} /><span>{item.label}</span>
            </span>
          );
        })}
      </div>
      <span ref={moreMeasureRef} aria-hidden="true" className="absolute left-0 top-0 h-0 overflow-hidden invisible flex items-center gap-1 px-2.5 text-body font-medium pointer-events-none">
        More <ChevronDown size={14} />
      </span>

      <nav className="h-full flex items-stretch gap-1 min-w-0 overflow-hidden" aria-label="Main">
        {visible.map((item) => {
          const Icon = item.icon;
          const on = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={on ? 'page' : undefined}
              className={tabClass(on)}
            >
              <Icon size={15} aria-hidden="true" className={on ? 'text-accent' : ''} />
              <span>{item.label}</span>
              {on && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>

      {overflow.length > 0 && (
        <div className="relative shrink-0 h-full flex items-stretch ml-1">
          <button
            ref={moreBtnRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls="header-more-menu"
            onClick={() => (open ? closeMenu(false) : openMenu(0))}
            onKeyDown={onButtonKey}
            className={`h-full flex items-center gap-1 px-2.5 text-body font-medium whitespace-nowrap transition-colors ${
              open ? 'text-fg' : 'text-muted hover:text-fg'}`}
          >
            More <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div
              ref={menuRef}
              id="header-more-menu"
              role="menu"
              aria-label="More pages"
              onKeyDown={onMenuKey}
              className="absolute right-0 top-full mt-1 z-40 min-w-[200px] py-1 rounded-md border border-line bg-surface shadow-lg"
            >
              {overflow.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => { setOpen(false); onSelect(item.id); }}
                    className="w-full flex items-center gap-2 px-3 h-9 text-body text-left text-fg hover:bg-inset focus:bg-inset focus:outline-none"
                  >
                    <Icon size={15} aria-hidden="true" className="text-muted" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
