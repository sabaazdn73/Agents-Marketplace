// OnboardingTour.jsx
//
// The dismissible welcome modal itself — shared verbatim by web + mobile
// (a centered overlay card works identically at any viewport width, unlike
// a DOM-anchored spotlight tour, which would need real, separately-
// maintained positioning logic for web's sidebar vs. mobile's bottom nav).
// Skippable and closeable at every step — never forced, never blocks the
// rest of the page (dismissing just closes it; the marketplace underneath
// is always still there).
import React, { useState } from 'react';
import { X, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';
import { ONBOARDING_STEPS, markOnboardingSeen } from './onboarding';

export default function OnboardingTour({ onClose }) {
  const [step, setStep] = useState(0);
  const isFirst = step === 0;
  const isLast = step === ONBOARDING_STEPS.length - 1;
  const current = ONBOARDING_STEPS[step];

  const finish = () => { markOnboardingSeen(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={finish}>
      <div
        className="w-full max-w-sm bg-white dark:bg-[#1E293B] rounded-3xl shadow-2xl p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={finish}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <X size={18} />
        </button>

        <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-4">
          <Sparkles size={18} className="text-indigo-500" />
        </div>

        <h2 className="text-lg font-bold mb-2">{current.title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-6">{current.body}</p>

        <div className="flex items-center justify-center gap-1.5 mb-5">
          {ONBOARDING_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-indigo-500' : 'w-1.5 bg-gray-200 dark:bg-gray-700'}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {!isFirst && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ArrowLeft size={13} /> Back
            </button>
          )}
          {!isLast && (
            <button onClick={finish} className="text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-1">
              Skip
            </button>
          )}
          <button
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            {isLast ? "Let's go" : 'Next'} {!isLast && <ArrowRight size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
