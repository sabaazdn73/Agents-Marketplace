// EcosystemGlobePage.jsx
//
// A real, standalone visual-identity page — its own route (/ecosystem), not
// mixed into any of the Market/My Agents/Report/Learn/Build/Sell tabs. Purely
// visual: a rotating 3D globe with one marker per real category, sized by
// how many real agents are actually in it right now. Not a dashboard — no
// click-through drilldown, rotate/zoom is the whole interaction.
//
// Library choice: react-three-fiber + drei, the standard React binding for
// three.js — checked npm before installing: the current majors
// (@react-three/fiber@9, drei@10) require React 19, and this app is on React
// 18.3, so this pins the last React-18-compatible majors instead
// (@react-three/fiber@8.18.0 + drei@9.122.0, both declaring `react: "^18"`
// in their own peerDependencies) rather than silently mismatching.
//
// Data: real category counts from the same known_agents data the Marketplace
// itself renders (the shared 24h localStorage cache written by
// AgentMarketplaceApp.web.jsx / .mobile.jsx, or a fresh fetch of the same
// /api/agents endpoint if that cache is empty/stale) — never invented
// placement or counts. Marker size = real count, cube-root scaled so one
// dominant category (Termix's own mass-registered cluster, still capped
// per-cluster server-side but real) doesn't visually swallow the rest.
//
// Mobile: this same component renders on the mobile breakpoint too (this
// project's "mobile" is a responsive layout in the same browser bundle, not
// a separate native app — see App.jsx). Real check before deciding not to
// build a 2D fallback: the whole page is React.lazy()-loaded (see
// App.jsx), so its ~800KB three.js/fiber/drei chunk is never downloaded by
// anyone who doesn't open /ecosystem — it costs nothing on the Marketplace's
// own load time. The scene itself is trivial for WebGL (one sphere + ~15
// small marker meshes, no textures) — well within what even a low-end
// phone's GPU handles; the genuine constraint would have been the *bundle*
// size, and code-splitting removes that. Kept for both, no 2D fallback
// needed.

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { CATEGORY_GROUPS, groupForCategory, groupLabel } from './categoryGroups';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
// Real bug found and fixed here during the Tnega rebrand (2026-08-28): this
// was still 'agents-marketplace-cache-v1' while the main app had already
// moved on to a '-v2' key (an earlier, unrelated stale-cache fix) — this
// page was silently never hitting that fast shared-cache path, always
// falling through to its own live fetch. Renamed to match AgentMarketplaceApp
// exactly (both now write/read the same real key), and fixes that bug too.
const CACHE_KEY = 'tnega-cache-v1'; // same cache AgentMarketplaceApp writes
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const GLOBE_RADIUS = 2.6;

// Fixed, stable palette — one color per real top-level category group
// (categoryGroups.js) plus Unclassified, cycling only if a new group is
// ever added upstream.
const PALETTE = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#84cc16', '#f97316', '#a855f7', '#10b981', '#3b82f6',
  '#e11d48', '#0ea5e9', '#d946ef', '#65a30d', '#f43f5e', '#0d9488',
];

// Real fix (2026-08-27): buckets by the real 5 top-level category groups
// (categoryGroups.js), not the 18 flat fine-grained categories this used to
// group by directly — the same real restructuring already applied to the
// Marketplace tab's own filter chips, now consistent here too. A raw
// agent's fine category (e.g. "Trading Signals") nests under its real group
// ("Trading & DeFi"); anything with no real group match (including the
// literal 'Unclassified' category) counts toward its own separate,
// never-merged 'Unclassified' bucket — same convention as the Marketplace
// tab, so a real classification is never implied where none was made.
// Zero-count buckets are dropped so a genuinely empty group never claims a
// marker on the globe.
function groupRawAgents(rawAgents) {
  const counts = new Map();
  for (const g of CATEGORY_GROUPS) counts.set(g.id, 0);
  counts.set('Unclassified', 0);
  for (const a of rawAgents) {
    const g = groupForCategory(a.category);
    const key = g || 'Unclassified';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const list = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ category: id === 'Unclassified' ? 'Unclassified' : groupLabel(id), count }))
    .sort((a, b) => b.count - a.count);
  return { list, total: rawAgents.length };
}

/** Reads the same cache the Marketplace tab writes for an instant first
 * paint (so visiting /ecosystem directly still shows a real globe right
 * away, not an empty one) — but ALWAYS also kicks off a real, fresh fetch
 * regardless of the cache's age, exactly matching AgentMarketplaceApp's own
 * useMarketplaceAgents. Real bug found and fixed here (2026-08-27): the old
 * version did an early return on any cache under 24h old and NEVER
 * fetched — real, confirmed stale-data symptom, live: a header still
 * reading "1,901 real agents across 18 categories" hours after the real
 * marketplace scale-up to 11,700+, because whichever browser cached that
 * snapshot simply never got a chance to refresh it within the 24h window.
 * `confirmedFresh` mirrors the Marketplace tab's own real fix for the exact
 * same class of bug: starts false on every render (cache or not), flips
 * true only once a real fetch actually settles, so the header NUMBER can
 * show a skeleton instead of a stale one — the globe's own shape still
 * renders instantly from whatever's available (cached or fresh), same
 * real tradeoff already made for the Marketplace's agent grid. */
function useCategoryCounts() {
  const [state, setState] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, savedAt } = JSON.parse(cached);
        if (Date.now() - savedAt < CACHE_MAX_AGE_MS && Array.isArray(data) && data.length > 0) {
          const { list, total } = groupRawAgents(data);
          return { loading: false, error: null, counts: list, total, confirmedFresh: false };
        }
      }
    } catch (e) { /* fall through to the real fetch below */ }
    return { loading: true, error: null, counts: [], total: 0, confirmedFresh: false };
  });

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`Backend returned ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const raw = (data.agents || []).map((a) => ({ category: a.category }));
        const { list, total } = groupRawAgents(raw);
        setState({ loading: false, error: null, counts: list, total, confirmedFresh: true });
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: data.agents || [], savedAt: Date.now() })); } catch (e) {}
      })
      .catch((err) => {
        if (cancelled) return;
        // Real, honest fallback: if we already have real (if possibly
        // stale) cached data on screen, don't blank the globe on a failed
        // refresh — just stop waiting on confirmation, same as
        // AgentMarketplaceApp's own useMarketplaceAgents. Only show a hard
        // error when there was never any real data to fall back on.
        setState((s) => (s.total > 0
          ? { ...s, confirmedFresh: true }
          : { loading: false, error: err.message, counts: [], total: 0, confirmedFresh: true }));
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}

/** Evenly distributes N points across a sphere surface (fibonacci-sphere
 * lattice) — deterministic, not random, so the same category always lands
 * in the same spot across reloads. This is purely a placement algorithm,
 * not a data claim; the honesty requirement (real counts) governs marker
 * SIZE, not which point of the lattice it's assigned. */
function fibonacciSpherePoints(n) {
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    points.push([Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY]);
  }
  return points;
}

export function RotatingGlobe({ counts, total }) {
  const groupRef = React.useRef();
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.12;
  });

  const positions = useMemo(() => fibonacciSpherePoints(counts.length), [counts.length]);
  const maxCount = Math.max(...counts.map((c) => c.count), 1);

  return (
    <group ref={groupRef}>
      {/* Base sphere: meshPhysicalMaterial's clearcoat is the 3D equivalent
          of AgentArchitectureDiagrams.jsx's top-lit sheen gradient overlay —
          a subtle glossy highlight rather than the old fully-matte
          standard material, real refinement not a visual overhaul. */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshPhysicalMaterial
          color="#1e2a44"
          roughness={0.55}
          metalness={0.05}
          clearcoat={0.35}
          clearcoatRoughness={0.25}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS + 0.012, 48, 48]} />
        <meshBasicMaterial color="#6366f1" wireframe transparent opacity={0.09} />
      </mesh>
      {counts.map((c, i) => {
        const [x, y, z] = positions[i];
        // Cube-root scaling: a category with 10x the real agents gets a
        // ~2.2x wider marker, not a 10x one — real proportion, without one
        // mass-registered cluster visually swallowing every other category.
        const markerRadius = 0.05 + 0.16 * Math.cbrt(c.count / maxCount);
        const color = PALETTE[i % PALETTE.length];
        const pos = [x * (GLOBE_RADIUS + 0.05), y * (GLOBE_RADIUS + 0.05), z * (GLOBE_RADIUS + 0.05)];
        return (
          <group key={c.category} position={pos}>
            {/* Soft halo behind the marker — a low-opacity, larger sphere of
                the same color — reads as a smooth glow rather than a hard
                flat dot, without any post-processing/bloom pipeline. */}
            <mesh>
              <sphereGeometry args={[markerRadius * 1.9, 16, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[markerRadius, 24, 24]} />
              <meshPhysicalMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.55}
                roughness={0.3}
                clearcoat={0.6}
                clearcoatRoughness={0.15}
              />
            </mesh>
            <Html distanceFactor={8} center style={{ pointerEvents: 'none' }}>
              <div className="px-2 py-1 rounded-lg bg-gray-900/90 text-white text-[10px] font-medium whitespace-nowrap shadow-lg border border-white/10">
                {c.category} · {c.count}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

export default function EcosystemGlobePage({ onBack }) {
  const { loading, error, counts, total, confirmedFresh } = useCategoryCounts();

  return (
    // h-screen (a DEFINITE height), not min-h-screen (only a floor) — real
    // bug found and fixed here: <Canvas> renders nested `width:100%;
    // height:100%` wrapper divs (confirmed by reading @react-three/fiber's
    // own source), and percentage-height children don't reliably resolve
    // inside a flex column whose own height comes only from min-height.
    // Combined with flex items defaulting to `min-height: auto` (not 0),
    // that collapsed the canvas's measured size to 0×0: WebGL had nothing
    // to draw (invisible sphere), and every <Html> marker's screen
    // projection (x * width/2, y * height/2) collapsed to the same (0,0)
    // point — exactly the reported "overlapping stacked text" bug.
    <div className="h-screen overflow-hidden bg-[#0B1120] text-white flex flex-col">
      <div className="flex items-center justify-between px-6 py-5 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} /> Back to Marketplace
        </button>
        <div className="text-right">
          <div className="text-sm font-semibold">The agent ecosystem, at a glance</div>
          <div className="text-[11px] text-gray-500">
            {/* Real fix (2026-08-27): the globe itself still renders
                instantly from cache below (same tradeoff as the
                Marketplace's own agent grid), but this NUMBER — the exact
                thing that went stale ("1,901... 18 categories" hours after
                the real scale-up) — now waits for confirmedFresh, same
                real pattern as the Marketplace tab's own header stats. */}
            {loading
              ? 'Loading real category counts…'
              : !confirmedFresh
                ? <span className="inline-block h-3 w-40 rounded bg-gray-700 animate-pulse align-middle" />
                : `${total.toLocaleString()} real agents across ${counts.length} category groups`}
          </div>
        </div>
      </div>

      {/* min-h-0 overrides the flex item's default min-height:auto — the
          other half of the real fix: without it, this flex-1 child refuses
          to shrink/resolve below the Canvas's percentage-based content
          size, which is exactly backwards (it needs to constrain the
          Canvas, not be constrained by it). */}
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-indigo-400" />
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-sm text-gray-400">Couldn't load real agent data right now ({error}). Nothing fabricated — try again shortly.</p>
          </div>
        )}
        {!loading && !error && counts.length > 0 && (
          // Zoomed out for real breathing room (was position.z=7, now 9.5 —
          // the globe used to nearly fill the frame; minDistance/maxDistance
          // widened to match so zooming in/out never re-creates that
          // cramped feel). Lighting swapped from a flat ambient + two point
          // lights to a soft top-down hemisphere light (a real gradient —
          // cool sky-blue fading to the dark navy "ground" — the 3D
          // equivalent of the 2D diagrams' top-lit sheen) plus a single
          // warmer key light from above-front and a dim indigo rim light
          // for depth, instead of two competing point lights.
          <Canvas camera={{ position: [0, 0, 9.5], fov: 42 }}>
            <hemisphereLight args={['#c7d2fe', '#0b1120', 0.55]} />
            <directionalLight position={[6, 9, 6]} intensity={1.15} color="#f8fafc" />
            <pointLight position={[-7, -3, -5]} intensity={0.3} color="#6366f1" />
            <Suspense fallback={null}>
              <RotatingGlobe counts={counts} total={total} />
            </Suspense>
            <OrbitControls enablePan={false} minDistance={6.5} maxDistance={16} autoRotate={false} />
          </Canvas>
        )}
      </div>

      <div className="px-6 pb-6 text-center text-[11px] text-gray-500 shrink-0">
        Drag to rotate, scroll/pinch to zoom. Marker size reflects each category's real, current agent count — not a fixed layout.
      </div>
    </div>
  );
}
