import { SITE_NAME, SITE_URL } from '@/components/Seo';

export const ORG_ID = `${SITE_URL}/#org`;

export const PUBLISHER_ORG = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE_NAME,
  url: SITE_URL,
  logo: { '@type': 'ImageObject', url: `${SITE_URL}/ic-logo.svg` },
};

export const AUTHOR_GRIDCAT = {
  '@type': 'Person',
  name: '@gridcat',
};

export interface Breadcrumb {
  name: string;
  path: string;
}

export function breadcrumbList(crumbs: Breadcrumb[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function faqPage(entries: FaqEntry[]): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer },
    })),
  };
}
