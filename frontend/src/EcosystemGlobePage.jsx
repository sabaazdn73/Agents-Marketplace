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
import { CATEGORY_HINTS } from './categoryHints';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CACHE_KEY = 'agents-marketplace-cache-v1'; // same cache AgentMarketplaceApp writes
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const GLOBE_RADIUS = 2.6;

// Fixed, stable palette — same category set as categorize.py, one color
// each, cycling only if a new category is ever added upstream.
const PALETTE = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#84cc16', '#f97316', '#a855f7', '#10b981', '#3b82f6',
  '#e11d48', '#0ea5e9', '#d946ef', '#65a30d', '#f43f5e', '#0d9488',
];

/** Reads the same 24h cache the Marketplace tab writes; fetches fresh only
 * if that cache is missing/stale, so visiting /ecosystem directly (no prior
 * Marketplace visit) still shows real data, not an empty globe. */
function useCategoryCounts() {
  const [state, setState] = useState({ loading: true, error: null, counts: [], total: 0 });

  useEffect(() => {
    let cancelled = false;

    const fromRaw = (rawAgents) => {
      const counts = new Map();
      for (const a of rawAgents) {
        const cat = a.category || 'Unclassified';
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
      const list = [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
      return { list, total: rawAgents.length };
    };

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, savedAt } = JSON.parse(cached);
        if (Date.now() - savedAt < CACHE_MAX_AGE_MS && Array.isArray(data) && data.length > 0) {
          const { list, total } = fromRaw(data);
          setState({ loading: false, error: null, counts: list, total });
          return;
        }
      }
    } catch (e) { /* fall through to a real fetch */ }

    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`Backend returned ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const raw = (data.agents || []).map((a) => ({ category: a.category }));
        const { list, total } = fromRaw(raw);
        setState({ loading: false, error: null, counts: list, total });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err.message, counts: [], total: 0 });
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

function RotatingGlobe({ counts, total }) {
  const groupRef = React.useRef();
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.12;
  });

  const positions = useMemo(() => fibonacciSpherePoints(counts.length), [counts.length]);
  const maxCount = Math.max(...counts.map((c) => c.count), 1);

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} metalness={0.1} wireframe={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS + 0.01, 48, 48]} />
        <meshBasicMaterial color="#4f46e5" wireframe transparent opacity={0.12} />
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
            <mesh>
              <sphereGeometry args={[markerRadius, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
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
  const { loading, error, counts, total } = useCategoryCounts();

  return (
    <div className="min-h-screen bg-[#0B1120] text-white flex flex-col">
      <div className="flex items-center justify-between px-6 py-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} /> Back to Marketplace
        </button>
        <div className="text-right">
          <div className="text-sm font-semibold">The agent ecosystem, at a glance</div>
          <div className="text-[11px] text-gray-500">
            {loading ? 'Loading real category counts…' : `${total.toLocaleString()} real agents across ${counts.length} categories`}
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
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
          <Canvas camera={{ position: [0, 0, 7], fov: 45 }}>
            <ambientLight intensity={0.6} />
            <pointLight position={[8, 8, 8]} intensity={1.2} />
            <pointLight position={[-8, -4, -6]} intensity={0.4} color="#6366f1" />
            <Suspense fallback={null}>
              <RotatingGlobe counts={counts} total={total} />
            </Suspense>
            <OrbitControls enablePan={false} minDistance={4} maxDistance={12} autoRotate={false} />
          </Canvas>
        )}
      </div>

      <div className="px-6 pb-6 text-center text-[11px] text-gray-500">
        Drag to rotate, scroll/pinch to zoom. Marker size reflects each category's real, current agent count — not a fixed layout.
      </div>
    </div>
  );
}
