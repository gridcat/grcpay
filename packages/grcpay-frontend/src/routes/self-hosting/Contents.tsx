import React from 'react';
import { PageContents, PageContentsEntry } from '@/components/PageContents/PageContents';

const entries: PageContentsEntry[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'prerequisites', label: 'Prerequisites' },
  { id: 'quickstart', label: 'Quick start' },
  { id: 'fullstack', label: 'Full stack' },
  { id: 'hot-cold', label: 'Hot/cold wallet (recommended)' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'reverse-proxy', label: 'Reverse proxy' },
  { id: 'verification', label: 'Verifying it works' },
  { id: 'operations', label: 'Operations' },
];

export function Contents() {
  return <PageContents entries={entries} />;
}
