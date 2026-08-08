import React, { useState, useEffect } from 'react';
import AgentMarketplaceApp from './AgentMarketplaceApp.web.jsx';
import AgentMarketplaceMobileApp from './AgentMarketplaceApp.mobile.jsx';

const MOBILE_BREAKPOINT = 768; // matches Tailwind's `md` breakpoint

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();
  // Genuinely different components, not one component with responsive
  // CSS, per the earlier design requirement (mobile is its own
  // information architecture, not a shrunk desktop grid).
  return isMobile ? <AgentMarketplaceMobileApp /> : <AgentMarketplaceApp />;
}
