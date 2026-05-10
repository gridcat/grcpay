import React from 'react';
import { PageContents, PageContentsEntry } from '@/components/PageContents/PageContents';

const entries: PageContentsEntry[] = [
  { id: 'acceptance', label: 'Read this first' },
  { id: 'facilitator', label: 'A passive facilitator' },
  { id: 'immutable', label: 'On-chain payments are final', indent: true },
  { id: 'not', label: 'What we are not' },
  { id: 'public-instance', label: 'The public instance' },
  { id: 'no-production', label: 'Production use is prohibited', indent: true },
  { id: 'custody', label: 'Custody & self-hosting' },
  { id: 'plugins', label: 'Plugins & integrations' },
  { id: 'eligibility', label: 'Eligibility & sanctions' },
  { id: 'prohibited', label: 'Prohibited use' },
  { id: 'merchant-obligations', label: 'Your own legal obligations' },
  { id: 'asis', label: 'Use at your own risk' },
  { id: 'accuracy', label: 'No accuracy guarantee', indent: true },
  { id: 'liability', label: 'No liability' },
  { id: 'no-advice', label: 'No financial advice' },
  { id: 'indemnification', label: 'Indemnification' },
  { id: 'user-content', label: 'User-supplied data' },
  { id: 'third-parties', label: 'Third-party services' },
  { id: 'governing-law', label: 'Governing law' },
  { id: 'changes', label: 'Changes' },
  { id: 'contact', label: 'Contact' },
];

export function Contents() {
  return <PageContents entries={entries} />;
}
