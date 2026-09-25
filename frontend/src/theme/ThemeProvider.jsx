// ThemeProvider.jsx
//
// One theme for the whole site, chosen in one place.
//
// THREE MODES, NOT TWO COLOURS
// `system` follows the operating system and keeps following it: turn the OS
// to dark at sunset and the page goes with it, with no reload. `light` and
// `dark` are a person's explicit choice and hold regardless of the OS.
// Storing the mode rather than the resolved colour is what makes "follow my
// system again" a choice somebody can make; with two colours, whichever one
// matched the OS today would be indistinguishable from following it.
//
// WHERE IT IS WRITTEN
// localStorage['tnega_theme'], first-party, in this browser only. No cookie
// and nothing sent anywhere. Every access is wrapped: a browser with site data
// blocked throws on localStorage, and a theme is not worth a crash. When the
// store is unavailable the mode still works for the session and resets to
// system on the next load.
//
// FIRST PAINT
// index.html runs a few lines before any of this loads and sets the same
// class, so the page never paints in the wrong theme and then flips. This
// component takes over from there and must resolve the mode the same way.
// resolveDark below and the inline script are the two copies of that rule.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const THEME_STORAGE_KEY = 'tnega_theme';
export const THEME_MODES = ['system', 'light', 'dark'];

const QUERY = '(prefers-color-scheme: dark)';

export function readStoredMode() {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredMode(mode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

function systemPrefersDark() {
  try {
    return !!(window.matchMedia && window.matchMedia(QUERY).matches);
  } catch {
    return false;
  }
}

export function resolveDark(mode, prefersDark) {
  return mode === 'dark' || (mode === 'system' && prefersDark);
}

/** Write the resolved theme onto <html> and the browser chrome.
 *
 *  theme-color is read back from the --page role rather than written as a
 *  literal here, so the colour a phone paints its status bar in cannot drift
 *  from the page it sits above. */
function applyToDocument(mode, dark) {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.setAttribute('data-theme-mode', mode);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const page = getComputedStyle(root).getPropertyValue('--page').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && page) meta.setAttribute('content', `rgb(${page.split(/\s+/).join(', ')})`);
}

const ThemeContext = createContext({
  mode: 'system',
  dark: false,
  setMode: () => {},
  persisted: true,
});

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const [persisted, setPersisted] = useState(true);

  // Follow the OS while it can matter. The listener stays on in every mode so
  // that switching back to system picks up the current OS value at once.
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(QUERY); } catch { return undefined; }
    const onChange = (e) => setPrefersDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  // Another tab changed the mode: follow it, so two open tabs never disagree.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === THEME_STORAGE_KEY) setModeState(readStoredMode());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dark = resolveDark(mode, prefersDark);

  useEffect(() => { applyToDocument(mode, dark); }, [mode, dark]);

  const setMode = useCallback((next) => {
    if (!THEME_MODES.includes(next)) return;
    setModeState(next);
    setPersisted(writeStoredMode(next));
  }, []);

  const value = useMemo(() => ({ mode, dark, setMode, persisted }), [mode, dark, setMode, persisted]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
