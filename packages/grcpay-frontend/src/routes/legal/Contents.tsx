import React from 'react';
import { PageContents, PageContentsEntry } from '@/components/PageContents/PageContents';

const entries: PageContentsEntry[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'line', label: 'Where the line sits' },
  { id: 'eu', label: 'EU regulatory map' },
  { id: 'us', label: 'United States' },
  { id: 'uk-other', label: 'UK & other major jurisdictions' },
  { id: 'aml-kyc', label: 'AML, KYC, and sanctions' },
  { id: 'travel-rule', label: 'The Travel Rule' },
  { id: 'tax', label: 'Tax orientation' },
  { id: 'lawyer', label: 'When to talk to a lawyer' },
  { id: 'not-advice', label: 'This is not legal advice' },
];

export function Contents() {
  return <PageContents entries={entries} />;
}
