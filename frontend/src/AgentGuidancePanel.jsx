// AgentGuidancePanel.jsx
//
// Real decision aid for the agent detail page when on-chain hire history is
// empty — built 2026-08-19, shared verbatim by web and mobile. Replaces the
// old bare "not yet hired" dead end with whatever real signals actually
// exist for THIS agent: a real Practice Mode skill to try risk-free (when
// its category conceptually maps to one), the real 8004scan reputation
// signals in plain language, the real on-chain Passkey badge if applicable
// — and, when genuinely none of that exists, an honest "we don't know
// anything about this one yet" statement instead of hiding the uncertainty.
//
// No new backend endpoint — every field here is already on the agent
// object the marketplace list/detail page already fetched.

import React from 'react';
import { FlaskConical, BadgeCheck, Star, MessageSquare, Gauge, ChevronRight } from 'lucide-react';
import PasskeyBadge from './PasskeyBadge';
import { CATEGORY_TO_SKILLS, realSignals } from './agentGuidance';

export default function AgentGuidancePanel({ agent, accent = '#4F46E5', mutedBorder, onTrySkill }) {
  const skills = CATEGORY_TO_SKILLS[agent.category] || [];
  const signals = realSignals(agent);
  const willShowSkillSuggestion = skills.length > 0 && !!onTrySkill;
  // "Genuinely nothing to show" has to account for whether the skill
  // suggestion will ACTUALLY render here, not just whether a category
  // mapping exists in the abstract — onTrySkill is wired on both
  // platforms now (Practice Mode shipped to mobile 2026-08-19), but this
  // stays defensive: if some future caller ever omits it, a mapped
  // category alone shouldn't silently show nothing with no honest
  // fallback either.
  const nothingDistinguishing = !willShowSkillSuggestion && !agent.isVerified && signals.length === 0;

  return (
    <div className={`p-4 rounded-xl border ${mutedBorder} space-y-4`}>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        No one has hired this agent through us yet. That just means it's new — not that it's bad. Here's what can help you decide anyway:
      </p>

      {willShowSkillSuggestion && (
        <div className="space-y-2">
          <p className="text-xs text-gray-700 dark:text-gray-300">
            This agent does <span className="font-semibold">{agent.category}</span>-type work — you can try that same kind of task yourself for free first, before trusting this specific agent with real money:
          </p>
          <div className="flex flex-col gap-2">
            {skills.map((s) => (
              <button
                key={s.skillId}
                onClick={() => onTrySkill(s.skillId)}
                className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: accent }}
              >
                <span className="flex items-center gap-1.5"><FlaskConical size={13} /> Try it for free</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">This lets you try how this TYPE of task works, with practice money — it's not this specific agent, just the same kind of work.</p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">What we know about this agent so far</p>
        <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <BadgeCheck size={13} className={agent.isVerified ? 'text-indigo-500' : 'text-gray-300 dark:text-gray-600'} />
          {agent.isVerified ? 'Registered on-chain.' : 'Not yet confirmed as registered — just not checked yet.'}
        </div>
        {signals.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            {s.label.includes('score') ? <Gauge size={13} /> : s.label.includes('Star') ? <Star size={13} /> : <MessageSquare size={13} />}
            {s.label}: <span className="font-semibold text-gray-800 dark:text-gray-200">{s.value}</span>
          </div>
        ))}
        <PasskeyBadge ownerAddress={agent.ownerAddress} className="mt-1" />
      </div>

      {nothingDistinguishing && (
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed border-t border-gray-100 dark:border-gray-800 pt-3">
          This agent signed up recently and has no track record yet. There's nothing here yet to tell you if it's good or bad — it's simply new. If you want to try it anyway, consider starting with a small hire to test it before trusting it with more.
        </p>
      )}
    </div>
  );
}
