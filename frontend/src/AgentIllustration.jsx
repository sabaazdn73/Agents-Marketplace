// AgentIllustration.jsx
//
// Real, original inline SVG artwork for the "Always Ask / Autonomous"
// explainer — a generic, abstract AI-agent character (rounded head,
// antenna, two eyes, a small "approved" badge), not any copyrighted
// character or real person. Same reasoning as AgentArchitectureDiagrams.jsx:
// no image asset or diagramming library pulled in for one illustration —
// hand-drawn here, in this site's own indigo palette, dark-mode-safe by
// construction (Tailwind fill-*/stroke-* utility classes, no baked-in
// per-theme colors), so it needs no separate licensing story at all.
// Shared verbatim by web and mobile.
import React from 'react';

const BODY_FILL = 'fill-indigo-50 dark:fill-indigo-500/10';
const BODY_STROKE = 'stroke-indigo-300 dark:stroke-indigo-500/50';
const ACCENT_FILL = 'fill-indigo-500 dark:fill-indigo-400';
const SOFT_FILL = 'fill-indigo-300 dark:fill-indigo-600';
const BADGE_FILL = 'fill-white dark:fill-[#1E293B]';

export default function AgentIllustration({ className = 'w-32 h-32' }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="An abstract AI agent character">
      <defs>
        <linearGradient id="agent-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <filter id="agent-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#4F46E5" floodOpacity="0.2" />
        </filter>
      </defs>

      {/* Antenna */}
      <line x1="100" y1="42" x2="100" y2="22" className={BODY_STROKE} strokeWidth="3" strokeLinecap="round" />
      <circle cx="100" cy="17" r="7" className={ACCENT_FILL} />

      {/* Side "circuit" leads, suggesting connectivity without a busy scene */}
      <line x1="40" y1="100" x2="18" y2="100" className={BODY_STROKE} strokeWidth="3" strokeLinecap="round" />
      <circle cx="14" cy="100" r="4" className={SOFT_FILL} />
      <line x1="160" y1="100" x2="182" y2="100" className={BODY_STROKE} strokeWidth="3" strokeLinecap="round" />
      <circle cx="186" cy="100" r="4" className={SOFT_FILL} />

      {/* Head */}
      <rect x="40" y="42" width="120" height="116" rx="30" className={`${BODY_FILL} ${BODY_STROKE}`} strokeWidth="2.5" filter="url(#agent-shadow)" />
      <rect x="40" y="42" width="120" height="58" rx="30" fill="url(#agent-sheen)" />

      {/* Eyes */}
      <circle cx="76" cy="94" r="9" className={ACCENT_FILL} />
      <circle cx="124" cy="94" r="9" className={ACCENT_FILL} />

      {/* Mouth — a calm, friendly bar rather than a specific expression */}
      <rect x="76" y="126" width="48" height="8" rx="4" className={SOFT_FILL} />

      {/* "Approved / within limits" badge — ties the character to the
          spend-cap/passkey-approval theme without needing extra copy */}
      <circle cx="150" cy="152" r="24" className={BADGE_FILL} filter="url(#agent-shadow)" />
      <circle cx="150" cy="152" r="24" className={`${BODY_FILL} ${BODY_STROKE}`} strokeWidth="2" />
      <path d="M140 152 L147 159 L161 144" className="stroke-indigo-500 dark:stroke-indigo-400" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
