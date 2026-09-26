// MyEtfs.jsx
//
// /my-etfs. A basket of up to five components with weights, bought one leg
// per signature, shareable as a link. Nothing is built yet.

import React from 'react';
import { PageFrame, BeingBuilt } from './PageFrame';

export default function MyEtfs({ layout = 'web' }) {
  return (
    <PageFrame layout={layout} title="My ETFs">
      <BeingBuilt what="Up to five components and their weights, bought with one signature per component, and shareable as a link." />
    </PageFrame>
  );
}
