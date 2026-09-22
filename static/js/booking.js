/* One booking destination for the card and Device calendar. */
import { maybeGet } from './v1.js';

// Optional code-defined override for ./run.sh's local code-content preview.
// Leave empty to use the published Site booking URL (then the Card URL).
export const CODE_BOOKING_URL = '';

export function safeBookingUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

let pending = null;
export function loadBookingUrl() {
  if (!pending) pending = (async () => {
    if (document.body.dataset.contentSource === 'code') {
      const override = safeBookingUrl(CODE_BOOKING_URL);
      if (override) return override;
    }
    const site = await maybeGet('/content/site');
    const fromSite = safeBookingUrl(site?.data?.booking_url);
    if (fromSite) return fromSite;
    const card = await maybeGet('/content/card');
    return safeBookingUrl(card?.data?.cal_link);
  })();
  return pending;
}

export function applyBookingLink(link, url) {
  if (!link) return;
  const destination = safeBookingUrl(url);
  link.hidden = !destination;
  if (destination) {
    link.href = destination;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  } else link.removeAttribute('href');
}
