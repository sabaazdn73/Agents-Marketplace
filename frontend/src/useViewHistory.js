// useViewHistory.js
//
// Makes the browser Back button behave like a real app instead of exiting
// the site.
//
// The bug this fixes (reported 2026-09-04): pressing Back jumped all the
// way out to the initial page load rather than returning one screen. Two
// separate causes, both real:
//
//   1. Tab changes DID push a history entry (App.jsx's navigate()), but the
//      app only ever read `initialNav` in a useState initialiser. A
//      useState initialiser runs once, at mount, so a popstate that changed
//      the URL never moved the view -- the address bar went back while the
//      screen stayed put, and further Backs eventually walked off the site.
//   2. Opening an agent detail pushed no history entry at all, so Back from
//      a detail view skipped the list entirely.
//
// Both apps get the same behaviour from here rather than two hand-rolled
// copies, since web and mobile silently diverging on navigation is exactly
// the class of bug this codebase keeps shared logic in .js modules to avoid.

import { useEffect, useRef, useCallback } from 'react';

/** Keeps a tab-style view in sync with the URL the router owns.
 *
 * `fromUrl` is what the URL currently says (App.jsx's `initialNav`),
 * `current` is the app's own nav state, `apply` sets it. Runs only when the
 * two genuinely disagree, so a user's own click -- which sets local state
 * and pushes the URL in the same tick -- never triggers a redundant second
 * set. Deliberately keyed on the URL alone: this exists to FOLLOW the URL
 * when something else changes it (Back/Forward), not to fight local state a
 * click already set. */
export function useNavSync(fromUrl, current, apply) {
  useEffect(() => {
    if (fromUrl && fromUrl !== current) apply(fromUrl);
  }, [fromUrl]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** Makes an open/closed overlay view (the agent detail screen) a real
 * history entry, so Back closes it and returns to the list underneath.
 *
 * Returns `[openView, closeView]`:
 *   openView(value) -- pushes a history entry, then opens the view.
 *   closeView()     -- goes BACK through history rather than just clearing
 *                      state, so the in-app back control and the browser's
 *                      own back button unwind the same single entry. Closing
 *                      by clearing state alone would leave a stale entry
 *                      behind and make the next browser Back a dead press.
 *
 * `isOpen` is read through a ref inside the listener so it can be
 * registered once and still see current state; re-binding on every
 * open/close would risk missing an event mid-swap. */
export function useOverlayHistory(isOpen, setValue, key = 'overlay') {
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  useEffect(() => {
    const onPop = (e) => {
      // Back landed on an entry that isn't this overlay while the overlay is
      // showing -> the user is backing out of it. Clear the state; the URL
      // is already correct, so nothing else needs to move.
      if (openRef.current && !(e.state && e.state[key])) setValue(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setValue, key]);

  const openView = useCallback((value) => {
    try {
      window.history.pushState(
        { ...(window.history.state || {}), [key]: true },
        '',
        window.location.pathname + window.location.search,
      );
    } catch {
      // A blocked/failed pushState must never stop the view from opening.
    }
    setValue(value);
  }, [setValue, key]);

  const closeView = useCallback(() => {
    if (window.history.state && window.history.state[key]) {
      window.history.back();   // the listener above clears the state
    } else {
      setValue(null);          // opened without an entry (e.g. a deep link)
    }
  }, [setValue, key]);

  return [openView, closeView];
}
