// Plausible tagged-events helper (same as the gridcoin.club hub's).
//
// The script the Analytics component loads supports class-based event
// tracking: an element with `plausible-event-name=<event>` in its class list
// fires that custom event on click, and `plausible-event-<prop>=<value>`
// attaches a prop. Apply the returned string alongside any existing className.
//
// Spaces become '+' (Plausible decodes them back); empty values are dropped.
// Props are low-cardinality labels only: never addresses, tokens or amounts.
export function plausibleClass(
  eventName: string,
  props: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const enc = (s: string) => String(s).replace(/\s+/g, '+');
  const out = [`plausible-event-name=${enc(eventName)}`];
  for (const [key, raw] of Object.entries(props)) {
    if (raw === null || raw === undefined || raw === '') continue;
    out.push(`plausible-event-${key}=${enc(String(raw))}`);
  }
  return out.join(' ');
}

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
  }
}

/**
 * Fire an event that is not a click on an element (a demo wallet changing
 * status, the 404 page view).
 *
 * Silently does nothing when the script has not loaded: an ad blocker, a
 * local dev run, or the testnet build, none of which should throw.
 */
export function trackEvent(
  eventName: string,
  props: Record<string, string | number | boolean | null | undefined> = {},
): void {
  if (typeof window === 'undefined' || typeof window.plausible !== 'function') return;

  const clean: Record<string, string> = {};
  for (const [key, raw] of Object.entries(props)) {
    if (raw === null || raw === undefined || raw === '') continue;
    clean[key] = String(raw);
  }
  window.plausible(eventName, Object.keys(clean).length ? { props: clean } : undefined);
}

/**
 * For an event fired as the page loads, before the script may be there yet:
 * install Plausible's own queue stub, which the script replays on load.
 * Harmless when tracking is off: the queue is never read.
 */
export function trackOnLoad(eventName: string, props: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  if (!window.plausible) {
    const stub: NonNullable<Window['plausible']> & { q?: unknown[] } = (...args) => {
      (stub.q = stub.q || []).push(args);
    };
    window.plausible = stub;
  }
  window.plausible(eventName, { props });
}
