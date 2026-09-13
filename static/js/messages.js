/* Private-first path messages with explicit, optional wall consent. */
import { maybeGet, v1, errorMessage } from './v1.js';

const CONSENT_VERSION = '2026-08-20';
const esc = value => {
  const node = document.createElement('div');
  node.textContent = value ?? '';
  return node.innerHTML;
};
const PROMPTS = {
  recruiter: { title: 'Post on the Recruiter Wall', hint: 'Share a role, question, or first impression…', wall: 'the recruiter wall' },
  friend: { title: 'Leave a Note for the Orbit', hint: 'A memory, thought, or hello…', wall: 'the friends wall' },
  viewer: { title: 'Leave a Trace', hint: 'A thought, a question, a hello…' },
  personal: { title: 'Write on the Wall', hint: 'A note, memory, or hello…', wall: 'the collective wall' },
};

async function submitMessage(payload) {
  return v1.post('/messages', payload);
}

export function mountMessageBox(container, path) {
  if (!container) return;
  const prompt = PROMPTS[path] || PROMPTS.viewer;
  const form = document.createElement('form');
  form.className = 'msgbox';
  form.noValidate = true;
  form.innerHTML = `
    <h3>${esc(prompt.title)}</h3>
    <label class="tl-sr" for="mb-name-${path}">Name, optional</label>
    <input id="mb-name-${path}" class="mb-name" name="name" type="text" maxlength="60" placeholder="Name (optional)" autocomplete="name">
    <label class="tl-sr" for="mb-contact-${path}">Contact details, optional and private</label>
    <input id="mb-contact-${path}" class="mb-contact" name="contact" type="text" maxlength="120" placeholder="Contact (optional, never public)" autocomplete="email">
    <label class="tl-sr" for="mb-body-${path}">Message</label>
    <textarea id="mb-body-${path}" class="mb-body" name="body" maxlength="4000" required placeholder="${esc(prompt.hint)}"></textarea>
    <label class="bc-hp" aria-hidden="true">Website<input class="mb-website" name="website" type="text" tabindex="-1" autocomplete="off"></label>
    <label class="mb-consent">
      <input class="mb-publish" name="publication_consent" type="checkbox">
      <span>You may publish this message on ${esc(prompt.wall || 'the public wall')} using my display name. This is optional and unchecked by default.</span>
    </label>
    <p class="mb-privacy">Every message goes to the private inbox. Contact details are never shown. See the <a href="/privacy">privacy notice</a>.</p>
    <button class="mb-send" type="submit">✦ &nbsp; Send &nbsp; ✦</button>
    <div class="mb-note" role="status" aria-live="polite"></div>`;
  container.replaceChildren(form);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = form.querySelector('.mb-body').value.trim();
    const consent = form.querySelector('.mb-publish').checked;
    const note = form.querySelector('.mb-note');
    const send = form.querySelector('.mb-send');
    if (!body) {
      note.textContent = 'Write something first.';
      form.querySelector('.mb-body').focus();
      return;
    }
    send.disabled = true;
    note.textContent = 'Sending…';
    try {
      await submitMessage({
        path,
        author_name: form.querySelector('.mb-name').value.trim() || 'anonymous',
        contact: form.querySelector('.mb-contact').value.trim(),
        body,
        publication_consent: consent,
        consent_version: consent ? CONSENT_VERSION : null,
        website: form.querySelector('.mb-website').value,
      });
      form.querySelector('.mb-body').value = '';
      form.querySelector('.mb-contact').value = '';
      form.querySelector('.mb-publish').checked = false;
      note.textContent = consent
        ? 'Sent privately for review. If approved, the message may also appear on the wall.'
        : 'Sent privately. It will not be published on the wall.';
    } catch (error) {
      note.textContent = errorMessage(error, 'Could not send. Try again later.');
    } finally { send.disabled = false; }
  });
}

export async function renderWall(container, { path = '', compact = false } = {}) {
  if (!container) return;
  const current = await maybeGet('/messages');
  /* Never fall back to the pre-consent wall API: older approved messages do
     not carry a publication-consent record, so they are not safe to expose. */
  const raw = current || [];
  const allMessages = Array.isArray(raw) ? raw : raw.items || [];
  const messages = path ? allMessages.filter(message => message.path === path) : allMessages;
  container.classList.toggle('wall-scroll', compact);
  container.innerHTML = '';
  if (!messages.length) {
    container.innerHTML = '<div class="wall-empty">No consented messages have been published yet.</div>';
    return;
  }
  messages.forEach(message => {
    const article = document.createElement('article');
    const path = ['recruiter', 'viewer', 'friend', 'personal'].includes(message.path) ? message.path : 'personal';
    const displayName = message.public_display_name || message.author_name || 'anonymous';
    article.className = 'wall-msg';
    article.innerHTML = `
      <header class="wall-meta"><span class="wall-name">${esc(displayName)}</span>
        <span class="wall-path wall-path-${path}">${esc(path)}</span>
        <time class="wall-date" datetime="${esc(message.published_at || message.created_at || '')}">${esc((message.published_at || message.created_at || '').slice(0, 10))}</time></header>
      <div class="wall-body">${esc(message.body)}</div>
      <div class="wall-consented">Published with the sender’s explicit consent.</div>`;
    container.appendChild(article);
  });
}
