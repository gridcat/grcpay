import React from 'react';
import { PageContents, PageContentsEntry } from '@/components/PageContents/PageContents';

const entries: PageContentsEntry[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'conventions', label: 'Conventions' },
  { id: 'status', label: 'Status' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'fee-math', label: 'Fee & refund math' },
  { id: 'qr', label: 'QR Codes' },
  { id: 'rates', label: 'Rates' },
  { id: 'errors', label: 'Errors' },
];

export function Contents() {
  return <PageContents entries={entries} />;
}
