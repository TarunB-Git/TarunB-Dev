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

function privacyNodes(root = document) {
  const banner = root.getElementById?.('cookie-banner') || root.querySelector?.('#cookie-banner');
  const settings = root.querySelectorAll?.('[data-open-privacy]') || [];
  return { banner, settings };
}

export function openPrivacyPreferences(root = document) {
  const { banner, settings } = privacyNodes(root);
  if (!banner) return false;
  banner.classList.add('show');
  banner.setAttribute('aria-hidden', 'false');
  settings.forEach(button => {
    button.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  });
  requestAnimationFrame(() => banner.querySelector('[data-consent="reject"]')?.focus());
  return true;
}

export function bindConsentBanner(root = document) {
  const { banner, settings } = privacyNodes(root);
  if (!banner || banner.dataset.privacyBound === 'true') return;
  banner.dataset.privacyBound = 'true';
  const allow = banner.querySelector('[data-consent="allow"]');
  const reject = banner.querySelector('[data-consent="reject"]');

  const sync = () => {
    const decided = Boolean(privacyChoice());
    banner.classList.toggle('show', !decided);
    banner.setAttribute('aria-hidden', decided ? 'true' : 'false');
    settings.forEach(button => {
      button.hidden = false;
      button.setAttribute('aria-expanded', String(!decided));
    });
  };
  allow?.addEventListener('click', () => { setPrivacyChoice(true); sync(); });
  reject?.addEventListener('click', () => { setPrivacyChoice(false); sync(); });
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-open-privacy]');
    if (!button) return;
    event.preventDefault();
    openPrivacyPreferences(root);
  });
  window.addEventListener('portfolio:open-privacy', () => openPrivacyPreferences(root));
  sync();
}
