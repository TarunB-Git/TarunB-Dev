/* First-party privacy preferences.
   Analytics stays disabled until the visitor makes an explicit choice. */

const STORAGE_KEY = 'portfolio_privacy_v1';
const CONSENT_VERSION = 1;

function readStored() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!value || value.version !== CONSENT_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

let current = readStored();

export function privacyChoice() {
  return current ? { ...current } : null;
}

export function analyticsAllowed() {
  return current?.analytics === true;
}

export function setPrivacyChoice(analytics) {
  current = {
    version: CONSENT_VERSION,
    analytics: analytics === true,
    decided_at: new Date().toISOString(),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('privacychange', { detail: privacyChoice() }));
  return privacyChoice();
}

export function clearPrivacyChoice() {
  current = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('privacychange', { detail: null }));
}

export function bindConsentBanner(root = document) {
  const banner = root.getElementById?.('cookie-banner') || root.querySelector?.('#cookie-banner');
  if (!banner) return;
  const allow = banner.querySelector('[data-consent="allow"]');
  const reject = banner.querySelector('[data-consent="reject"]');
  const settings = root.querySelectorAll?.('[data-open-privacy]') || [];

  const sync = () => {
    const decided = Boolean(privacyChoice());
    banner.classList.toggle('show', !decided);
    banner.setAttribute('aria-hidden', decided ? 'true' : 'false');
    settings.forEach(button => { button.hidden = !decided; });
  };
  allow?.addEventListener('click', () => { setPrivacyChoice(true); sync(); });
  reject?.addEventListener('click', () => { setPrivacyChoice(false); sync(); });
  settings.forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    button.hidden = true;
    banner.classList.add('show');
    banner.setAttribute('aria-hidden', 'false');
    reject?.focus();
  }));
  sync();
}
