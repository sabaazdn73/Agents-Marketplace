// EcosystemFallback.jsx
//
// What /ecosystem shows when the globe cannot run.
//
// The globe is three.js, and three.js throws when the browser will not give it
// a WebGL context: hardware acceleration switched off, a locked-down work
// machine, some virtual machines, some headless browsers. Before this, that
// throw unmounted the whole React tree and the visitor got a blank page with
// no way back. Two layers now stand in front of it:
//
//   hasWebGL()            checked in App.jsx before the globe's bundle is
//                         even requested, so a browser that cannot draw it
//                         does not download 900KB to find out.
//   EcosystemBoundary     catches anything the check did not predict, such as
//                         a context that exists but is lost on creation.
//
// Both end on the same page: the standalone bar with its theme control, one
// sentence saying what is missing, and a link to the thing the globe
// summarises.

import React from 'react';
import StandaloneBar from './StandaloneBar';

export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function EcosystemFallback({ onBack }) {
  return (
    <div className="min-h-screen bg-page text-fg">
      <div className="max-w-[1400px] mx-auto px-6 py-10">
        <StandaloneBar onBack={onBack} />
        <h1 className="text-h1 font-bold mb-2">The agent ecosystem</h1>
        <p className="text-body text-muted max-w-prose">
          The globe on this page needs WebGL, and this browser has it switched off or does not
          support it. The same agents, by chain and by category, are on the{' '}
          <a href="/market" className="text-accent font-medium hover:underline">Explore page</a>.
        </p>
      </div>
    </div>
  );
}

export class EcosystemBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <EcosystemFallback onBack={this.props.onBack} />;
    return this.props.children;
  }
}
