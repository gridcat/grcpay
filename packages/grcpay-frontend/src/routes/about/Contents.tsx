import React from 'react';
import { PageContents, PageContentsEntry } from '@/components/PageContents/PageContents';

const entries: PageContentsEntry[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'why', label: 'Why GRCpay?' },
  { id: 'protocol', label: 'Protocol & Lifecycle' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'expiry', label: 'Expiry & Jobs' },
  { id: 'hosting', label: 'Self-host (recommended)' },
  { id: 'privacy', label: 'Privacy' },
];

export function Contents() {
  return <PageContents entries={entries} />;
}
