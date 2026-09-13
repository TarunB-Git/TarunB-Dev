/* Structured portfolio administration for the versioned content API. */
import { clearCsrf, errorMessage, maybeGet, v1 } from './v1.js';

const $ = id => document.getElementById(id);
const esc = value => {
  const node = document.createElement('div');
  node.textContent = value ?? '';
  return node.innerHTML;
};
const PATHS = ['recruiter', 'viewer', 'friend', 'personal'];
const LAYOUTS = ['upper', 'lower', 'feature', 'media-left', 'media-right'];
const ACCENTS = ['gold', 'teal', 'violet', 'crimson', 'blue'];
const PATH_ACCENT = { recruiter: 'gold', friend: 'teal', viewer: 'violet', personal: 'crimson' };
const PATH_CATEGORIES = {
  recruiter: ['experience', 'project', 'education'],
  friend: ['people', 'place', 'interest', 'memory', 'message'],
  viewer: ['story', 'value', 'identity', 'interest'],
  personal: ['milestone', 'book', 'fun-project'],
};
const contentCache = new Map();
const contentRecords = new Map();
let mediaCache = [];
let needsOwnerSetup = false;
const cleanSlug = value => String(value || '').trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function setNote(node, message, kind = '') {
  if (!node) return;
  node.textContent = message;
  node.className = `note${kind ? ` ${kind}` : ''}`;
}

function unwrapContent(raw) {
  return raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
}

async function getContent(key) {
  const current = await maybeGet(`/content/${encodeURIComponent(key)}`);
  let data = unwrapContent(current);
  let record = current && typeof current === 'object' && 'data' in current ? current : null;
  data = data && typeof data === 'object' ? data : {};
  contentCache.set(key, data);
  contentRecords.set(key, record || { data, published: false, version: 0 });
  return data;
}

async function saveContent(key, ownedData, noteText = '', published = true) {
  const latest = await getContent(key);
  const data = Array.isArray(ownedData) ? ownedData : { ...latest, ...ownedData };
  const result = await v1.put(`/admin/content/${encodeURIComponent(key)}`, { data, published, note: noteText || `Updated ${key}` });
  contentRecords.set(key, { data, published, version: result?.version || 0 });
  contentCache.set(key, data);
  return data;
}

function openDialog(title, body) {
  const dialog = $('admin-dialog');
  const inner = dialog.querySelector('.dialog-inner');
  inner.innerHTML = `<button class="dialog-close" type="button" aria-label="Close">×</button><div class="preview-copy"><h2 id="admin-dialog-title">${esc(title)}</h2>${body}</div>`;
  inner.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  if (dialog.open) dialog.close();
  dialog.showModal();
  inner.querySelector('.dialog-close').focus();
}

$('admin-dialog').addEventListener('click', event => { if (event.target === $('admin-dialog')) $('admin-dialog').close(); });

/* ── authentication ───────────────────────────────────── */
async function authGet() {
  try { return await v1.get('/admin/me'); }
  catch { return null; }
}

async function boot() {
  const me = await authGet();
  if (me?.admin) { enter(); return; }
  try {
    const status = await v1.get('/admin/setup-status');
    needsOwnerSetup = Boolean(status?.needs_setup);
  } catch { needsOwnerSetup = false; }
  if (!needsOwnerSetup) return;
  $('login-title').textContent = 'CREATE OWNER ACCESS';
  $('pass-label').textContent = 'Choose a passphrase';
  $('pass').autocomplete = 'new-password';
  $('confirm-label').classList.remove('hidden');
  $('pass-confirm').classList.remove('hidden');
  $('login-btn').textContent = 'create access';
  $('login-help').textContent = 'Choose any non-empty passphrase. It is stored only as a one-way hash.';
}

async function login() {
  const errorNode = $('login-err');
  errorNode.textContent = '';
  const passphrase = $('pass').value;
  if (!passphrase) { errorNode.textContent = 'enter a passphrase'; return; }
  if (needsOwnerSetup && passphrase !== $('pass-confirm').value) {
    errorNode.textContent = 'the two passphrases do not match'; return;
  }
  try {
    await v1.post(needsOwnerSetup ? '/admin/setup' : '/admin/login', { passphrase });
    clearCsrf();
    enter();
  } catch (error) {
    if (error.status === 429) errorNode.textContent = 'too many attempts — wait a few minutes';
    else if (needsOwnerSetup && error.status === 409) errorNode.textContent = 'owner access was already created — reload and sign in';
    else errorNode.textContent = needsOwnerSetup ? 'could not create owner access' : 'wrong passphrase';
  }
}

$('login-btn').addEventListener('click', login);
$('pass').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });
$('pass-confirm').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });
$('logout').addEventListener('click', async () => {
  await v1.post('/admin/logout', {}).catch(() => null);
  location.reload();
});
$('revoke').addEventListener('click', async () => {
  if (!confirm('Revoke every admin session, including this one?')) return;
  await v1.post('/admin/sessions/revoke', {}).catch(() => null);
  location.reload();
});

function enter() {
  $('login').classList.add('hidden');
  $('shell').classList.remove('hidden');
  const jobs = [
    [renderReadiness, 'readiness'], [renderSetup, 'setup'], [renderCard, 'card'],
    [renderResume, 'resume'], [renderWork, 'work'], [renderTimelines, 'timelines'],
    [renderMedia, 'media'], [renderBlog, 'blog'], [renderComments, 'comments'],
    [renderMessages, 'messages'], [renderStats, 'stats'], [renderRevisions, 'revisions'],
  ];
  jobs.forEach(([render, target]) => Promise.resolve().then(render).catch(error => {
    if (error?.status === 401) {
      $('shell').classList.add('hidden');
      $('login').classList.remove('hidden');
      $('login-err').textContent = 'session expired — sign in again';
      return;
    }
    const node = target === 'readiness' ? $('readiness') : $(`p-${target}`);
    if (node) node.innerHTML = `<div class="card"><h3>Could not load</h3><div class="note error">${esc(errorMessage(error, 'This admin section is unavailable.'))}</div><button class="btn sm retry" type="button" style="margin-top:10px">Retry</button></div>`;
    node?.querySelector('.retry')?.addEventListener('click', () => render().catch(() => {}));
  }));
}

const adminNavButtons = [...document.querySelectorAll('nav button')];
adminNavButtons.forEach(button => {
  const panel = $(`p-${button.dataset.p}`);
  button.id = `admin-nav-${button.dataset.p}`;
  button.setAttribute('aria-controls', panel?.id || '');
  button.setAttribute('aria-pressed', String(button.classList.contains('on')));
  panel?.setAttribute('aria-labelledby', button.id);
  button.addEventListener('click', () => {
    adminNavButtons.forEach(item => {
      const selected = item === button;
      item.classList.toggle('on', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('on', item === panel));
  });
});

async function renderReadiness() {
  const node = $('readiness');
  const status = await maybeGet('/admin/readiness');
  if (status) {
    node.classList.toggle('ready', Boolean(status.ready));
    const missing = status.missing || status.issues || [
      ...(status.missing_legal || []).map(item => `legal: ${item}`),
      ...(status.missing_content || []).map(item => `content: ${item}`),
      ...(status.missing_timelines || []).map(item => `timeline: ${item}`),
    ];
    node.innerHTML = status.ready
      ? '<strong>Launch check</strong><span>Required content and legal details are complete.</span>'
      : `<strong>Not ready</strong><span>${missing.length ? esc(missing.join(' · ')) : 'Complete the required setup fields before launch.'}</span>`;
    return;
  }
  const [card, resume, legal] = await Promise.all([getContent('card'), getContent('resume'), getContent('legal')]);
  const missing = [];
  if (!card.name || !card.email) missing.push('real card name and contact');
  if (!Array.isArray(resume.experience) || !resume.experience.length) missing.push('resume experience');
  if (!legal.controller_name || !legal.controller_contact) missing.push('legal controller details');
  node.classList.toggle('ready', !missing.length);
  node.innerHTML = !missing.length
    ? '<strong>Launch check</strong><span>Core content is present. Run the server readiness check before release.</span>'
    : `<strong>Not ready</strong><span>Missing ${esc(missing.join(', '))}.</span>`;
}

/* ── structured content helpers ───────────────────────── */
function makeField(definition, value = '') {
  const label = document.createElement('label');
  label.className = `${definition.type === 'checkbox' ? 'check' : 'field'}${definition.wide ? ' wide' : ''}${definition.narrow ? ' narrow' : ''}${definition.required ? ' required' : ''}`;
  label.innerHTML = `<span>${esc(definition.label)}</span>`;
  let input;
  if (definition.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = definition.rows || 3;
  } else if (definition.type === 'select') {
    input = document.createElement('select');
    input.innerHTML = definition.options.map(option => `<option value="${esc(option)}">${esc(option)}</option>`).join('');
  } else {
    input = document.createElement('input');
    input.type = definition.type || 'text';
  }
  input.dataset.field = definition.key;
  if (definition.type === 'checkbox') {
    input.checked = value === true || value === 'true' || value === 1;
    label.prepend(input);
  } else {
    input.value = value ?? '';
    label.appendChild(input);
  }
  input.placeholder = definition.placeholder || '';
  if (definition.required) input.required = true;
  if (definition.maxlength) input.maxLength = definition.maxlength;
  return label;
}

function readFields(root) {
  return Object.fromEntries([...root.querySelectorAll('[data-field]')].map(input => [
    input.dataset.field,
    input.type === 'checkbox' ? input.checked : (input.type === 'number' ? Number(input.value || 0) : input.value.trim()),
  ]));
}

function wireSortable(list, itemSelector) {
  let dragging = null;
  list.addEventListener('dragstart', event => {
    const handle = event.target.closest('[data-drag-handle]');
    const item = handle?.closest(itemSelector);
    if (!item || item.parentElement !== list) return;
    event.stopPropagation();
    dragging = item;
    dragging.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', 'reorder');
  });
  list.addEventListener('dragend', event => {
    if (!dragging) return;
    event.stopPropagation();
    dragging.classList.remove('dragging'); dragging = null;
  });
  list.addEventListener('dragover', event => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const item = event.target.closest(itemSelector);
    if (!item || item === dragging || item.parentElement !== list) return;
    const after = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
    list.insertBefore(dragging, after ? item.nextSibling : item);
  });
}

function makeRepeater(title, items, fields) {
  const section = document.createElement('section');
  section.innerHTML = `<div class="section-head"><h4>${esc(title)}</h4><button class="btn sm ghost add" type="button">+ add</button></div><div class="repeat-list"></div>`;
  const list = section.querySelector('.repeat-list');
  const append = data => {
    const item = document.createElement('div');
    item.className = 'repeat-item';
    item.innerHTML = '<button class="drag" type="button" draggable="true" data-drag-handle aria-label="Drag to reorder">⠿</button><div class="repeat-body"></div><div class="repeat-actions"><button type="button" class="up" aria-label="Move up">↑</button><button type="button" class="down" aria-label="Move down">↓</button><button type="button" class="remove" aria-label="Remove">×</button></div>';
    const body = item.querySelector('.repeat-body');
    fields.forEach(field => body.appendChild(makeField(field, data?.[field.key] || '')));
    item.querySelector('.remove').addEventListener('click', () => item.remove());
    item.querySelector('.up').addEventListener('click', () => item.previousElementSibling && list.insertBefore(item, item.previousElementSibling));
    item.querySelector('.down').addEventListener('click', () => item.nextElementSibling && list.insertBefore(item.nextElementSibling, item));
    list.appendChild(item);
  };
  (Array.isArray(items) ? items : []).forEach(append);
  section.querySelector('.add').addEventListener('click', () => append({}));
  wireSortable(list, '.repeat-item');
  section.read = () => [...list.children].map(item => readFields(item));
  return section;
}

function contentEditor(panel, options) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h3>${esc(options.title)}</h3>${options.intro ? `<div class="note">${esc(options.intro)}</div>` : ''}<div class="form-grid"></div>`;
  const grid = card.querySelector('.form-grid');
  options.fields.forEach(field => grid.appendChild(makeField(field, options.data[field.key] || '')));
  const repeaters = (options.repeaters || []).map(repeater => {
    const source = Array.isArray(options.data[repeater.key]) ? options.data[repeater.key] : [];
    const items = repeater.transformItem ? source.map(repeater.transformItem) : source;
    const node = makeRepeater(repeater.title, items, repeater.fields);
    node.dataset.key = repeater.key;
    node._definition = repeater;
    card.appendChild(node);
    return node;
  });
  const actions = document.createElement('div');
  actions.className = 'editor-actions';
  const isPublished = contentRecords.get(options.key)?.published !== false;
  actions.innerHTML = `<button class="btn ok save" type="button">Save</button><label class="check"><input class="content-published" type="checkbox" ${isPublished ? 'checked' : ''}><span>Publish now</span></label><button class="btn preview" type="button">Preview</button><button class="btn ghost revisions" type="button">Revisions</button><span class="note" role="status"></span>`;
  card.appendChild(actions);
  const collect = () => {
    const data = readFields(grid);
    repeaters.forEach(repeater => {
      const values = repeater.read();
      data[repeater.dataset.key] = repeater._definition.transformRead ? repeater._definition.transformRead(values) : values;
    });
    return data;
  };
  actions.querySelector('.save').addEventListener('click', async () => {
    const note = actions.querySelector('.note');
    const data = collect();
    const invalidInput = card.querySelector('input:invalid,textarea:invalid,select:invalid');
    if (invalidInput) {
      setNote(note, 'Correct the highlighted required field or URL before saving.', 'error');
      invalidInput.reportValidity?.();
      invalidInput.focus();
      return;
    }
    const invalid = options.fields.find(field => field.required && !data[field.key]);
    if (invalid) { setNote(note, `${invalid.label} is required.`, 'error'); return; }
    try {
      const published = actions.querySelector('.content-published').checked;
      await saveContent(options.key, options.serialize ? options.serialize(data) : data, `Updated ${options.title}`, published);
      setNote(note, published ? 'Saved and published ✓' : 'Saved as draft ✓', 'success');
      renderReadiness();
    } catch (error) { setNote(note, errorMessage(error, 'Save failed.'), 'error'); }
  });
  actions.querySelector('.preview').addEventListener('click', () => options.preview(collect()));
  actions.querySelector('.revisions').addEventListener('click', () => showRevisions(options.key, options.title));
  panel.appendChild(card);
}

async function renderSetup() {
  const panel = $('p-setup');
  panel.innerHTML = '<div class="card"><div class="note">Loading setup…</div></div>';
  const [site, legal] = await Promise.all([getContent('site'), getContent('legal')]);
  panel.innerHTML = '<div class="legal-warning">Legal text is generated from these fields. Publishing is blocked until the controller/contact, purposes, lawful basis, hosting/processors, transfers, retention, rights, withdrawal, and complaint details are complete.</div>';
  contentEditor(panel, {
    key: 'site', title: 'Site setup', data: site,
    fields: [
      { key: 'site_title', label: 'Site title', required: true },
      { key: 'canonical_url', label: 'Canonical HTTPS URL', type: 'url', required: true },
      { key: 'owner_name', label: 'Public owner name', required: true },
      { key: 'owner_contact', label: 'Public contact email', type: 'email', required: true },
      { key: 'booking_url', label: 'Booking URL', type: 'url' },
      { key: 'hosting_provider', label: 'Hosting provider' },
      { key: 'friend_story_consent_confirmed', label: 'I have permission to publish the friend stories entered on this site', type: 'checkbox', wide: true, required: true },
    ],
    preview: data => openDialog('Site setup preview', `<p><strong>${esc(data.site_title)}</strong></p><p>${esc(data.canonical_url)}</p><p>${esc(data.owner_name)} · ${esc(data.owner_contact)}</p>`),
  });
  contentEditor(panel, {
    key: 'legal', title: 'Privacy, cookies, and terms', data: legal,
    fields: [
      { key: 'controller_name', label: 'Data controller', required: true },
      { key: 'controller_contact', label: 'Controller contact', required: true },
      { key: 'purpose', label: 'Processing purposes', type: 'textarea', wide: true, required: true },
      { key: 'lawful_basis', label: 'Lawful bases', type: 'textarea', wide: true, required: true },
      { key: 'processor_hosting', label: 'Processors and hosting', type: 'textarea', wide: true, required: true },
      { key: 'international_transfers', label: 'International transfers', type: 'textarea', wide: true, required: true },
      { key: 'retention', label: 'Retention periods', type: 'textarea', wide: true, required: true },
      { key: 'rights', label: 'Data subject rights', type: 'textarea', wide: true, required: true },
      { key: 'withdrawal', label: 'Consent withdrawal', type: 'textarea', wide: true, required: true },
      { key: 'complaint_authority', label: 'Complaint authority', type: 'textarea', wide: true, required: true },
      { key: 'cookie_details', label: 'Cookie details', type: 'textarea', wide: true, required: true },
      { key: 'terms', label: 'Terms of use', type: 'textarea', wide: true, required: true },
      { key: 'last_updated', label: 'Last updated', type: 'date', required: true },
    ],
    preview: data => openDialog('Legal-page preview', Object.entries(data).map(([key, value]) => `<p><strong>${esc(key.replaceAll('_', ' '))}</strong><br>${esc(value)}</p>`).join('')),
  });
  const ops = document.createElement('div');
  ops.className = 'card';
  ops.innerHTML = '<h3>Export & backup</h3><div class="note">Download a portable content export or ask the server to create a verified SQLite backup.</div><div class="editor-actions"><a class="btn" href="/api/v1/admin/export" download>Download export</a><button class="btn" id="backup-now" type="button">Create backup</button><span class="note" role="status"></span></div>';
  ops.querySelector('#backup-now').addEventListener('click', async () => {
    const note = ops.querySelector('[role=status]');
    try { const result = await v1.post('/admin/backup', {}); setNote(note, result?.filename ? `Created ${result.filename}` : 'Backup created ✓', 'success'); }
    catch (error) { setNote(note, errorMessage(error, 'Backup endpoint unavailable.'), 'error'); }
  });
  panel.appendChild(ops);
  const security = document.createElement('div');
  security.className = 'card';
  security.innerHTML = '<h3>Owner security</h3><div class="note">Changing the passphrase revokes every active admin session. Recovery is performed with the server owner command.</div><div class="form-grid" style="margin-top:12px"><label class="field required"><span>Current passphrase</span><input class="current-pass" type="password" autocomplete="current-password"></label><label class="field required"><span>New passphrase</span><input class="new-pass" type="password" autocomplete="new-password"></label></div><div class="editor-actions"><button class="btn warn rotate-pass" type="button">Rotate passphrase</button><span class="note" role="status"></span></div>';
  security.querySelector('.rotate-pass').addEventListener('click', async () => {
    const current = security.querySelector('.current-pass').value;
    const next = security.querySelector('.new-pass').value;
    const note = security.querySelector('[role=status]');
    if (!current || !next) { setNote(note, 'Provide the current passphrase and a non-empty new passphrase.', 'error'); return; }
    if (!confirm('Rotate the owner passphrase and revoke all sessions?')) return;
    try {
      await v1.post('/admin/passphrase', { current_passphrase: current, new_passphrase: next });
      location.reload();
    } catch (error) { setNote(note, errorMessage(error, 'Passphrase rotation failed.'), 'error'); }
  });
  panel.appendChild(security);
}

async function renderCard() {
  const panel = $('p-card'); panel.innerHTML = '';
  const card = await getContent('card');
  contentEditor(panel, {
    key: 'card', title: 'Business card', data: card,
    intro: 'Public identity and contact fields. Leave no demo names, companies, quotes, or metrics before launch.',
    fields: [
      { key: 'name', label: 'Name', required: true }, { key: 'role', label: 'Role', required: true },
      { key: 'status', label: 'Availability status' }, { key: 'updated', label: 'Updated label' },
      { key: 'email', label: 'Email', type: 'email', required: true }, { key: 'phone', label: 'Phone URI value' },
      { key: 'phone_display', label: 'Phone display' }, { key: 'url', label: 'Website', type: 'url' },
      { key: 'cal_link', label: 'Booking URL', type: 'url' }, { key: 'tagline', label: 'Tagline', type: 'textarea', wide: true },
      { key: 'footer', label: 'Footer', wide: true },
    ],
    repeaters: [
      { key: 'chips', title: 'Availability chips', transformItem: value => ({ value }), transformRead: values => values.map(item => item.value).filter(Boolean), fields: [{ key: 'value', label: 'Label', wide: true }] },
      { key: 'logos', title: 'Logo / client labels', transformItem: value => ({ value }), transformRead: values => values.map(item => item.value).filter(Boolean), fields: [{ key: 'value', label: 'Label', wide: true }] },
      { key: 'recs', title: 'Recommendations', fields: [{ key: 'q', label: 'Quote', type: 'textarea', wide: true }, { key: 'a', label: 'Attribution', wide: true }] },
    ],
    preview: data => openDialog('Business card preview', `<p><strong>${esc(data.name)}</strong><br>${esc(data.role)}</p><p>${esc(data.tagline)}</p><p>${esc(data.email)} · ${esc(data.phone_display)}</p>`),
  });
}

async function renderResume() {
  const panel = $('p-resume'); panel.innerHTML = '';
  const download = document.createElement('section');
  download.className = 'card';
  download.innerHTML = '<h3>Downloadable résumé PDF</h3><p>Used by the card download and Device → Downloads. Uploading does not change the abridged résumé.</p><p class="pdf-current"></p><label>PDF document <input class="pdf-file" type="file" accept="application/pdf,.pdf"></label><button type="button" class="pdf-upload">Upload PDF</button><p class="pdf-note" role="status"></p>';
  panel.append(download);
  const showPdf = info => { download.querySelector('.pdf-current').textContent = info.original_name ? `Current file: ${info.original_name}` : 'No PDF uploaded yet. Downloads currently use the generated résumé.'; };
  try { showPdf(await v1.get('/admin/resume-pdf')); } catch { /* upload remains available */ }
  download.querySelector('.pdf-upload').addEventListener('click', async event => {
    const file = download.querySelector('.pdf-file').files[0];
    const note = download.querySelector('[role="status"]');
    if (!file) { setNote(note, 'Choose a PDF first.', 'error'); return; }
    const form = new FormData(); form.append('file', file);
    event.currentTarget.disabled = true;
    try {
      showPdf(await v1.upload('/admin/resume-pdf', form));
      setNote(note, 'PDF published. Card and Downloads now use this file.', 'success');
    } catch (error) { setNote(note, errorMessage(error, 'Upload failed.'), 'error'); }
    finally { download.querySelector('.pdf-upload').disabled = false; }
  });
  const source = await getContent('resume');
  const resume = {
    ...source,
    name: source.name || source.identity?.name || '',
    headline: source.headline || source.identity?.headline || source.stub || '',
    projects: Array.isArray(source.projects) ? source.projects : (Array.isArray(source.notable) ? source.notable : []),
  };
  const entryFields = [{ key: 'role', label: 'Role / qualification', required: true }, { key: 'co', label: 'Organization' }, { key: 'dates', label: 'Dates' }, { key: 'desc', label: 'Details', type: 'textarea', wide: true }];
  contentEditor(panel, {
    key: 'resume', title: 'Resume source', data: resume,
    intro: 'Edit the abridged résumé shown on the card and accessible page. The downloadable PDF is managed separately below.',
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'headline', label: 'Professional headline', required: true },
      { key: 'stub', label: 'Compact card/resume line', type: 'textarea', wide: true },
      { key: 'summary', label: 'Profile summary', type: 'textarea', wide: true, required: true, rows: 4 },
    ],
    repeaters: [
      { key: 'contact', title: 'Contact', fields: [{ key: 'label', label: 'Label' }, { key: 'value', label: 'Value', required: true }] },
      { key: 'experience', title: 'Experience', transformItem: item => ({ role: item.role || item.title || '', co: item.co || item.company || item.organization || '', dates: item.dates || item.year || '', desc: item.desc || item.description || '' }), fields: entryFields },
      { key: 'education', title: 'Education', transformItem: item => ({ role: item.role || item.title || '', co: item.co || item.company || item.organization || '', dates: item.dates || item.year || '', desc: item.desc || item.description || '' }), fields: entryFields },
      { key: 'projects', title: 'Projects / notable work', transformItem: item => ({ title: item.title || item.role || '', desc: item.desc || item.description || '' }), fields: [{ key: 'title', label: 'Title' }, { key: 'desc', label: 'Description', type: 'textarea', wide: true }] },
      { key: 'skills', title: 'Skills', transformItem: value => ({ value }), transformRead: values => values.map(item => item.value).filter(Boolean), fields: [{ key: 'value', label: 'Skill', wide: true }] },
    ],
    serialize: data => ({
      ...data,
      identity: { ...(source.identity && typeof source.identity === 'object' ? source.identity : {}), name: data.name, headline: data.headline },
    }),
    preview: data => openDialog('Resume preview', `<p><strong>${esc(data.name)}</strong><br>${esc(data.headline || data.stub)}</p><p>${esc(data.summary)}</p><p>${(data.contact || []).map(item => `${esc(item.label)}: ${esc(item.value)}`).join(' · ')}</p>${(data.experience || []).map(item => `<p><strong>${esc(item.role)}</strong> · ${esc(item.co)} · ${esc(item.dates)}<br>${esc(item.desc)}</p>`).join('')}<p><strong>Skills:</strong> ${(data.skills || []).map(esc).join(' · ')}</p>`),
  });
}

async function renderWork() {
  const panel = $('p-work'); panel.innerHTML = '';
  const [card, linksRaw] = await Promise.all([getContent('card'), getContent('friend_links')]);
  contentEditor(panel, {
    key: 'card', title: 'Selected work & career', data: card,
    fields: [],
    repeaters: [
      { key: 'selected_work', title: 'Selected work', fields: [{ key: 'num', label: 'Number' }, { key: 'title', label: 'Title', required: true }, { key: 'sub', label: 'Subtitle', wide: true }, { key: 'stat', label: 'Result / metric' }, { key: 'year', label: 'Year' }] },
      { key: 'career', title: 'Career', fields: [{ key: 'year', label: 'Dates' }, { key: 'role', label: 'Role', required: true }, { key: 'co', label: 'Organization' }, { key: 'desc', label: 'Description', type: 'textarea', wide: true }] },
    ],
    preview: data => openDialog('Work preview', [...(data.selected_work || []), ...(data.career || [])].map(item => `<p><strong>${esc(item.title || item.role)}</strong> · ${esc(item.year)}<br>${esc(item.sub || item.desc)}</p>`).join('')),
  });
  const friendLinks = Array.isArray(linksRaw) ? { links: linksRaw } : { links: linksRaw.links || [] };
  contentEditor(panel, {
    key: 'friend_links', title: 'Friend-path links', data: friendLinks, fields: [],
    repeaters: [{ key: 'links', title: 'Links', fields: [{ key: 'icon', label: 'Icon' }, { key: 'label', label: 'Label', required: true }, { key: 'href', label: 'HTTPS URL', type: 'url', wide: true }] }],
    serialize: data => data.links,
    preview: data => openDialog('Friend links preview', (data.links || []).map(item => `<p>${esc(item.icon)} <strong>${esc(item.label)}</strong> · ${esc(item.href)}</p>`).join('')),
  });
}

/* ── timeline periods and events ──────────────────────── */
function normalizeAdminTimeline(raw, path) {
  if (raw?.periods) return raw.periods.map((period, index) => ({
    ...period, sort_order: period.sort_order ?? index,
    events: (period.events || []).map((event, eventIndex) => ({ ...event, sort_order: event.sort_order ?? eventIndex })),
  }));
  const groups = new Map();
  (Array.isArray(raw) ? raw : []).forEach((event, index) => {
    const label = event.year_label || 'Undated';
    if (!groups.has(label)) groups.set(label, { id: `legacy-${groups.size}`, path, label, sort_order: groups.size, published: true, legacy: true, events: [] });
    groups.get(label).events.push({
      ...event, slug: event.slug || `${path}-${event.id || index}`, category: event.subtitle || '',
      summary: event.description || '', details_md: event.details || '', layout: LAYOUTS[index % LAYOUTS.length], accent: PATH_ACCENT[path],
      links: (event.links || []).map(link => ({ kind: 'external', label: link.label, url: link.href })),
    });
  });
  return [...groups.values()];
}

async function getAdminTimeline(path) {
  const current = await maybeGet(`/timelines/${path}`);
  return normalizeAdminTimeline(current || { path, periods: [] }, path);
}

function linkEditor(links = []) {
  const section = document.createElement('section');
  section.innerHTML = '<div class="section-head"><h4>Detail links</h4><button class="btn sm ghost add-link" type="button">+ add link</button></div><div class="link-list"></div>';
  const list = section.querySelector('.link-list');
  const add = link => {
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `
      <select class="link-kind"><option value="external">external</option><option value="post">blog post</option></select>
      <input class="link-label" placeholder="label" value="${esc(link?.label || '')}">
      <input class="link-target" placeholder="HTTPS URL or post slug" value="${esc(link?.kind === 'post' ? link.slug : link?.url || link?.href || '')}">
      <button class="btn sm warn" type="button" aria-label="Remove link">×</button>`;
    row.querySelector('.link-kind').value = link?.kind || 'external';
    row.querySelector('.btn').addEventListener('click', () => row.remove());
    list.appendChild(row);
  };
  links.forEach(add);
  section.querySelector('.add-link').addEventListener('click', () => add({ kind: 'external' }));
  section.read = () => [...list.children].map(row => {
    const kind = row.querySelector('.link-kind').value;
    const target = row.querySelector('.link-target').value.trim();
    return kind === 'post'
      ? { kind, slug: cleanSlug(target) }
      : { kind, label: row.querySelector('.link-label').value.trim() || 'Open', url: target };
  }).filter(link => link.kind === 'post' ? link.slug : /^https?:\/\//i.test(link.url));
  section.validationError = () => {
    for (const row of list.children) {
      const kind = row.querySelector('.link-kind').value;
      const target = row.querySelector('.link-target').value.trim();
      if (!target) return 'Every detail link needs a target.';
      if (kind === 'external' && !/^https?:\/\//i.test(target)) return 'External detail links must use HTTP or HTTPS.';
      if (kind === 'post' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(target)) return 'Blog-post links need a valid post slug.';
    }
    return '';
  };
  return section;
}

function eventEditor(path, period, event, reload, isNew = false) {
  const card = document.createElement('div');
  card.className = 'event-card';
  card.dataset.eventId = event.id || '';
  card.innerHTML = `
    <div class="event-summary">
      <button class="drag" type="button" draggable="true" data-drag-handle aria-label="Drag event to reorder">⠿</button>
      <div><strong>${esc(event.title || 'New event')}</strong><div class="meta">${esc(event.category || 'uncategorized')} · ${esc(event.layout || 'feature')}${event.published === false ? ' · draft' : ''}</div></div>
      <button class="btn sm event-up" type="button" aria-label="Move event up">↑</button><button class="btn sm event-down" type="button" aria-label="Move event down">↓</button><button class="btn sm toggle" type="button" aria-expanded="${isNew}">${isNew ? 'collapse' : 'edit'}</button>
    </div>
    <div class="event-fields" ${isNew ? '' : 'hidden'}><div class="form-grid"></div></div>`;
  const fields = card.querySelector('.event-fields');
  const grid = fields.querySelector('.form-grid');
  [
    { key: 'slug', label: 'Deep-link slug', required: true }, { key: 'category', label: 'Category', type: 'select', options: [...new Set([event.category || PATH_CATEGORIES[path][0], ...PATH_CATEGORIES[path]])], required: true },
    { key: 'title', label: 'Title', required: true }, { key: 'subtitle', label: 'Subtitle' },
    { key: 'summary', label: 'Short summary', type: 'textarea', wide: true, required: true, rows: 2 },
    { key: 'details_md', label: 'Expanded details (Markdown)', type: 'textarea', wide: true, rows: 5 },
    { key: 'alt_text', label: 'Event media alt text', wide: true },
    { key: 'layout', label: 'Layout preset', type: 'select', options: LAYOUTS },
    { key: 'accent', label: 'Accent', type: 'select', options: ACCENTS },
    { key: 'sort_order', label: 'Order', type: 'number', narrow: true },
  ].forEach(def => {
    const fallback = def.key === 'layout' ? 'feature' : def.key === 'accent' ? ACCENTS[PATHS.indexOf(path)] : '';
    const value = def.key === 'alt_text' ? (event.alt_text ?? event.media?.alt_text ?? '') : (event[def.key] ?? fallback);
    grid.appendChild(makeField(def, value));
  });
  const mediaLabel = document.createElement('label');
  mediaLabel.className = 'field';
  const mediaChoices = [...mediaCache];
  const currentMediaId = Number(event.media?.id || event.media_id || 0);
  if (currentMediaId && !mediaChoices.some(media => Number(media.id) === currentMediaId)) {
    mediaChoices.push({ ...event.media, id: currentMediaId, original_name: `Current media ${currentMediaId}` });
  }
  mediaLabel.innerHTML = `<span>Media asset</span><select class="event-media"><option value="">none</option>${mediaChoices.map(media => `<option value="${media.id}">${esc(media.original_name || media.alt_text || media.stored_name || `Media ${media.id}`)}</option>`).join('')}</select>`;
  mediaLabel.querySelector('select').value = event.media?.id || event.media_id || '';
  grid.appendChild(mediaLabel);
  const pub = document.createElement('label');
  pub.className = 'check'; pub.innerHTML = `<input class="event-pub" type="checkbox" ${event.published === false ? '' : 'checked'}><span>Published</span>`;
  grid.appendChild(pub);
  const links = linkEditor(event.links || []);
  fields.appendChild(links);
  fields.insertAdjacentHTML('beforeend', '<div class="editor-actions"><button class="btn ok save-event" type="button">Save event</button><button class="btn preview-event" type="button">Preview</button><button class="btn warn delete-event" type="button">Delete</button><span class="note" role="status"></span></div>');
  card.querySelector('.toggle').addEventListener('click', eventObject => {
    fields.hidden = !fields.hidden;
    eventObject.currentTarget.textContent = fields.hidden ? 'edit' : 'collapse';
    eventObject.currentTarget.setAttribute('aria-expanded', String(!fields.hidden));
  });
  card.querySelector('.event-up').addEventListener('click', () => card.previousElementSibling && card.parentElement.insertBefore(card, card.previousElementSibling));
  card.querySelector('.event-down').addEventListener('click', () => card.nextElementSibling && card.parentElement.insertBefore(card.nextElementSibling, card));
  const collect = () => {
    const data = readFields(grid);
    data.slug = cleanSlug(data.slug);
    data.category = cleanSlug(data.category) || 'story';
    data.published = card.querySelector('.event-pub').checked;
    data.links = links.read();
    const mediaId = Number(card.querySelector('.event-media').value || 0);
    data.media_id = mediaId || null;
    return data;
  };
  fields.querySelector('.save-event').addEventListener('click', async () => {
    const note = fields.querySelector('[role=status]');
    const data = collect();
    if (!data.slug || !data.title || !data.category || !data.summary) { setNote(note, 'Slug, category, title, and summary are required.', 'error'); return; }
    const linkError = links.validationError();
    if (linkError) { setNote(note, linkError, 'error'); return; }
    try {
      if (event.id) {
        await v1.put(`/admin/timeline-events/${event.id}`, data);
      } else {
        await v1.post(`/admin/timeline-periods/${period.id}/events`, data);
      }
      setNote(note, 'Saved ✓', 'success');
      if (isNew) reload();
    } catch (error) { setNote(note, errorMessage(error, 'Could not save event.'), 'error'); }
  });
  fields.querySelector('.preview-event').addEventListener('click', () => {
    const data = collect();
    openDialog(`${period.label} · ${data.title || 'Untitled'}`, `<p><strong>${esc(data.category)}</strong></p><p>${esc(data.summary)}</p><p>${esc(data.details_md)}</p><p>Preset: ${esc(data.layout)} · ${esc(data.accent)}</p>`);
  });
  fields.querySelector('.delete-event').disabled = !event.id;
  fields.querySelector('.delete-event').addEventListener('click', async () => {
    if (!event.id || !confirm(`Permanently delete “${event.title}”?`)) return;
    try {
      await v1.del(`/admin/timeline-events/${event.id}`);
      reload();
    } catch (error) { setNote(fields.querySelector('[role=status]'), errorMessage(error, 'Delete failed.'), 'error'); }
  });
  return card;
}

function periodEditor(path, period, reload) {
  const card = document.createElement('section');
  card.className = 'card period-card';
  card.dataset.periodId = period.id;
  card.innerHTML = `
    <div class="period-header"><button class="drag" type="button" draggable="true" data-drag-handle aria-label="Drag period to reorder">⠿</button>
      <input class="period-label" value="${esc(period.label)}" aria-label="Period label">
      <input class="period-slug" value="${esc(period.slug || '')}" aria-label="Stable period slug" placeholder="period-slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*">
      <input class="period-order" type="number" value="${period.sort_order ?? 0}" aria-label="Period sort order" style="max-width:75px">
      <label class="check"><input class="period-pub" type="checkbox" ${period.published === false ? '' : 'checked'}><span>live</span></label>
      <span class="spacer"></span><button class="btn sm period-up" type="button" aria-label="Move period up">↑</button><button class="btn sm period-down" type="button" aria-label="Move period down">↓</button><button class="btn sm save-period" type="button">save period</button><button class="btn sm warn delete-period" type="button">delete</button></div>
    <div class="event-list"></div><div class="editor-actions"><button class="btn sm add-event" type="button">+ add event</button><button class="btn sm save-order" type="button">Save order</button><span class="note" role="status"></span></div>`;
  const list = card.querySelector('.event-list');
  (period.events || []).sort((a, b) => a.sort_order - b.sort_order).forEach(event => list.appendChild(eventEditor(path, period, event, reload)));
  wireSortable(list, '.event-card');
  card.querySelector('.period-up').addEventListener('click', () => card.previousElementSibling && card.parentElement.insertBefore(card, card.previousElementSibling));
  card.querySelector('.period-down').addEventListener('click', () => card.nextElementSibling && card.parentElement.insertBefore(card.nextElementSibling, card));
  card.querySelector('.add-event').addEventListener('click', () => {
    const blank = { slug: '', category: PATH_CATEGORIES[path][0], title: '', subtitle: '', summary: '', details_md: '', layout: 'feature', accent: PATH_ACCENT[path], sort_order: list.children.length, published: false, links: [] };
    list.appendChild(eventEditor(path, period, blank, reload, true));
    list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  card.querySelector('.save-period').addEventListener('click', async () => {
    const note = card.querySelector('[role=status]');
    try {
      await v1.put(`/admin/timeline-periods/${period.id}`, {
        label: card.querySelector('.period-label').value.trim(),
        slug: cleanSlug(card.querySelector('.period-slug').value) || null,
        sort_order: Number(card.querySelector('.period-order').value || 0),
        published: card.querySelector('.period-pub').checked,
      });
      setNote(note, 'Period saved ✓', 'success');
    } catch (error) { setNote(note, errorMessage(error, 'Save failed.'), 'error'); }
  });
  card.querySelector('.delete-period').addEventListener('click', async () => {
    const eventCount = period.events?.length || 0;
    const consequence = eventCount ? ` and its ${eventCount} event${eventCount === 1 ? '' : 's'}` : '';
    if (!confirm(`Permanently delete period “${period.label}”${consequence}?`)) return;
    try { await v1.del(`/admin/timeline-periods/${period.id}`); reload(); }
    catch (error) { setNote(card.querySelector('[role=status]'), errorMessage(error, 'Delete failed.'), 'error'); }
  });
  card.querySelector('.save-order').addEventListener('click', () => saveTimelineOrder(path, card.closest('.timeline-path'), reload));
  return card;
}

async function saveTimelineOrder(path, wrapper) {
  const note = wrapper.querySelector('.path-note');
  if (wrapper.querySelector('.event-card[data-event-id=""]')) {
    setNote(note, 'Save or remove each new event editor before saving timeline ordering.', 'error');
    return;
  }
  const periodIds = [...wrapper.querySelectorAll('.period-card')].map(card => Number(card.dataset.periodId)).filter(id => Number.isInteger(id) && id > 0);
  const eventIdsByPeriod = {};
  wrapper.querySelectorAll('.period-card').forEach(card => {
    const id = Number(card.dataset.periodId);
    if (Number.isInteger(id) && id > 0) eventIdsByPeriod[id] = [...card.querySelectorAll('.event-card')].map(event => Number(event.dataset.eventId)).filter(eventId => Number.isInteger(eventId) && eventId > 0);
  });
  try {
    await v1.put(`/admin/timelines/${path}/order`, { period_ids: periodIds, event_ids_by_period: eventIdsByPeriod });
    [...wrapper.querySelectorAll('.period-card')].forEach((card, periodIndex) => {
      card.querySelector('.period-order').value = periodIndex;
      [...card.querySelectorAll('.event-card')].forEach((event, eventIndex) => {
        const order = event.querySelector('[data-field="sort_order"]');
        if (order) order.value = eventIndex;
      });
    });
    setNote(note, 'Timeline order saved ✓', 'success');
  } catch (error) { setNote(note, errorMessage(error, 'Could not save order.'), 'error'); }
}

async function renderTimelines() {
  const panel = $('p-timelines');
  panel.innerHTML = '<div class="card"><div class="note">Loading timelines…</div></div>';
  await loadMedia();
  panel.innerHTML = '';
  for (const path of PATHS) {
    const wrapper = document.createElement('div');
    wrapper.className = 'timeline-path';
    wrapper.innerHTML = `<div class="card"><h3>${path} timeline</h3><div class="row"><input class="new-period-label grow" placeholder="New period label, e.g. 2026"><button class="btn add-period" type="button">+ add period</button><button class="btn save-all-order" type="button">Save all ordering</button></div><div class="note path-note" role="status"></div></div><div class="period-list"></div>`;
    panel.appendChild(wrapper);
    const list = wrapper.querySelector('.period-list');
    const periods = await getAdminTimeline(path);
    periods.sort((a, b) => a.sort_order - b.sort_order).forEach(period => list.appendChild(periodEditor(path, period, renderTimelines)));
    if (!periods.length) list.innerHTML = '<div class="empty">No periods yet. Add the first one above.</div>';
    wireSortable(list, '.period-card');
    wrapper.querySelector('.add-period').addEventListener('click', async () => {
      const label = wrapper.querySelector('.new-period-label').value.trim();
      if (!label) { setNote(wrapper.querySelector('.path-note'), 'Enter a period label.', 'error'); return; }
      try { await v1.post(`/admin/timelines/${path}/periods`, { label, sort_order: periods.length, published: false }); renderTimelines(); }
      catch (error) { setNote(wrapper.querySelector('.path-note'), errorMessage(error, 'Could not add period.'), 'error'); }
    });
    wrapper.querySelector('.save-all-order').addEventListener('click', () => saveTimelineOrder(path, wrapper));
  }
}

/* ── media library ────────────────────────────────────── */
async function loadMedia() {
  try {
    const raw = await v1.get('/admin/media');
    mediaCache = Array.isArray(raw) ? raw : raw?.items || [];
  } catch (error) {
    if (error.status !== 404) throw error;
    mediaCache = [];
  }
  return mediaCache;
}

function mediaUrl(media) {
  const raw = media.url || (media.stored_name ? `/media/${encodeURIComponent(media.stored_name)}` : '');
  try {
    const url = new URL(raw, location.origin);
    return url.origin === location.origin || url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

async function renderMedia() {
  const panel = $('p-media');
  await loadMedia();
  panel.innerHTML = `
    <div class="card"><h3>Upload media</h3><div class="upload-drop" tabindex="0"><div><strong>Drop a web-ready image or short video</strong><div class="note">JPEG, PNG, WebP, AVIF, GIF, MP4, or WebM · alt text is required</div><input class="media-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm" style="margin-top:12px"></div></div><div class="row" style="margin-top:10px"><label class="field grow required"><span>Alt text</span><input class="media-alt" maxlength="300"></label><button class="btn ok media-upload" type="button">Upload</button></div><div class="note upload-note" role="status"></div></div>
    <div class="card"><h3>Media library</h3><div class="media-grid"></div></div>`;
  const drop = panel.querySelector('.upload-drop');
  const fileInput = panel.querySelector('.media-file');
  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', event => {
    const file = event.dataTransfer.files[0];
    if (file) {
      const transfer = new DataTransfer(); transfer.items.add(file); fileInput.files = transfer.files;
    }
  });
  panel.querySelector('.media-upload').addEventListener('click', async () => {
    const note = panel.querySelector('.upload-note');
    const file = fileInput.files[0], alt = panel.querySelector('.media-alt').value.trim();
    if (!file || !alt) { setNote(note, 'Choose a file and provide meaningful alt text.', 'error'); return; }
    const form = new FormData(); form.append('file', file); form.append('alt_text', alt);
    try { await v1.upload('/admin/media', form); setNote(note, 'Uploaded ✓', 'success'); renderMedia(); renderTimelines(); }
    catch (error) { setNote(note, errorMessage(error, 'Upload failed.'), 'error'); }
  });
  const grid = panel.querySelector('.media-grid');
  if (!mediaCache.length) grid.innerHTML = '<div class="empty">No uploaded media.</div>';
  mediaCache.forEach(media => {
    const item = document.createElement('article'); item.className = 'media-item';
    const url = mediaUrl(media), video = String(media.mime_type || '').startsWith('video/');
    item.innerHTML = `${video ? `<video src="${esc(url)}" muted></video>` : `<img src="${esc(url)}" alt="${esc(media.alt_text || '')}" loading="lazy">`}<div class="meta">${esc(media.original_name || media.stored_name || `media-${media.id}`)}<br>${esc(media.alt_text || '')}</div><button class="btn sm warn" type="button">delete</button>`;
    item.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Delete this media asset? Published content may reference it.')) return;
      try { await v1.del(`/admin/media/${media.id}`); renderMedia(); }
      catch (error) { alert(errorMessage(error, 'Delete failed.')); }
    });
    grid.appendChild(item);
  });
}

/* ── posts ────────────────────────────────────────────── */
async function getPostPage() {
  const items = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ limit: '50', sort: 'new' });
    if (cursor) query.set('cursor', cursor);
    const page = await v1.get(`/posts?${query}`);
    items.push(...(Array.isArray(page) ? page : page.items || []));
    cursor = Array.isArray(page) ? '' : page.next_cursor || '';
  } while (cursor && items.length < 500);
  return items;
}

async function getPost(slug) {
  return await v1.get(`/posts/${encodeURIComponent(slug)}`);
}

function postEditor(post, reload, isNew = false) {
  const card = document.createElement('section'); card.className = 'card';
  card.innerHTML = `<h3>${isNew ? 'New post' : esc(post.title || 'Untitled post')} ${post.published === false ? '<span class="badge pending">draft</span>' : ''}</h3><div class="form-grid"></div><div class="section-head"><h4>Path tags</h4></div><div class="row post-tags"></div><div class="editor-actions"><button class="btn ok save" type="button">${isNew ? 'Create draft' : 'Save'}</button><button class="btn preview" type="button">Preview</button>${isNew ? '' : '<button class="btn ghost revisions" type="button">Revisions</button><button class="btn warn delete" type="button">Delete</button>'}<span class="note" role="status"></span></div>`;
  const grid = card.querySelector('.form-grid');
  [
    { key: 'title', label: 'Title', required: true }, { key: 'slug', label: 'Slug', required: true },
    { key: 'excerpt', label: 'Excerpt', type: 'textarea', wide: true, rows: 2 },
    { key: 'body_md', label: 'Post body (Markdown)', type: 'textarea', wide: true, rows: 12, required: true },
  ].forEach(def => grid.appendChild(makeField(def, post[def.key] || '')));
  PATHS.forEach(path => {
    const label = document.createElement('label'); label.className = 'check';
    label.innerHTML = `<input type="checkbox" value="${path}" ${(post.tags || []).includes(path) ? 'checked' : ''}><span>${path}</span>`;
    card.querySelector('.post-tags').appendChild(label);
  });
  const published = document.createElement('label'); published.className = 'check';
  published.innerHTML = `<input class="post-published" type="checkbox" ${post.published === false || isNew ? '' : 'checked'}><span>Published</span>`;
  card.querySelector('.post-tags').appendChild(published);
  const collect = () => ({
    ...readFields(grid),
    slug: cleanSlug(grid.querySelector('[data-field=slug]').value),
    tags: [...card.querySelectorAll('.post-tags input[value]')].filter(input => input.checked).map(input => input.value),
    published: card.querySelector('.post-published').checked,
  });
  card.querySelector('.save').addEventListener('click', async () => {
    const note = card.querySelector('[role=status]'), data = collect();
    if (!data.title || !data.slug || !data.body_md) { setNote(note, 'Title, slug, and body are required.', 'error'); return; }
    try {
      if (post.id) await v1.put(`/admin/posts/${post.id}`, data);
      else await v1.post('/admin/posts', data);
      setNote(note, 'Saved ✓', 'success'); if (isNew) reload();
    } catch (error) { setNote(note, errorMessage(error, 'Could not save post.'), 'error'); }
  });
  card.querySelector('.preview').addEventListener('click', () => {
    const data = collect();
    openDialog(data.title || 'Post preview', `<p>${esc(data.body_md).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`);
  });
  card.querySelector('.revisions')?.addEventListener('click', () => showRevisions(post.id, post.title, 'blog_post'));
  card.querySelector('.delete')?.addEventListener('click', async () => {
    if (!confirm(`Permanently delete “${post.title}” and its comments?`)) return;
    try { await v1.del(`/admin/posts/${post.id}`); reload(); }
    catch (error) { setNote(card.querySelector('[role=status]'), errorMessage(error, 'Delete failed.'), 'error'); }
  });
  return card;
}

async function renderBlog() {
  const panel = $('p-blog'); panel.innerHTML = '';
  panel.appendChild(postEditor({ slug: '', title: '', excerpt: '', body_md: '', tags: [], published: false }, renderBlog, true));
  const summaries = await getPostPage();
  for (const summary of summaries) {
    const post = await getPost(summary.slug);
    panel.appendChild(postEditor({ ...summary, ...post }, renderBlog));
  }
}

/* ── comments moderation ──────────────────────────────── */
function flattenComments(list, depth = 0, output = []) {
  list.forEach(comment => { output.push([comment, depth]); flattenComments(comment.replies || [], depth + 1, output); });
  return output;
}

async function getComments(postId) {
  const comments = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const raw = await v1.get(`/posts/${postId}/comments?${query}`);
    comments.push(...(Array.isArray(raw) ? raw : raw.items || []));
    cursor = Array.isArray(raw) ? '' : raw.next_cursor || '';
  } while (cursor);
  return comments;
}

async function renderComments() {
  const panel = $('p-comments'); panel.innerHTML = '';
  const posts = await getPostPage();
  for (const post of posts) {
    const comments = flattenComments(await getComments(post.id));
    if (!comments.length) continue;
    const card = document.createElement('section'); card.className = 'card'; card.innerHTML = `<h3>${esc(post.title)}</h3>`;
    comments.forEach(([comment, depth]) => {
      const item = document.createElement('article'); item.className = 'list-item'; item.style.marginLeft = `${Math.min(depth, 3) * 18}px`;
      item.innerHTML = `<div class="body"><div class="meta">${esc(comment.author_name)} · ${esc(comment.created_at)} ${comment.hidden ? '<span class="badge pending">hidden</span>' : ''}</div>${esc(comment.body)}</div><div class="moderation-actions"><button class="btn sm toggle" type="button">${comment.hidden ? 'unhide' : 'hide'}</button><button class="btn sm warn permanent" type="button">delete forever</button></div>`;
      item.querySelector('.toggle').addEventListener('click', async () => {
        try {
          await v1.patch(`/admin/comments/${comment.id}`, { hidden: !comment.hidden });
          renderComments();
        } catch (error) {
          alert(errorMessage(error, 'Hide and unhide require the versioned moderation API.'));
        }
      });
      item.querySelector('.permanent').addEventListener('click', async () => {
        if (!confirm('Permanently delete this comment and its entire reply thread?')) return;
        try { await v1.del(`/admin/comments/${comment.id}`); renderComments(); }
        catch (error) { alert(errorMessage(error, 'Permanent deletion requires the v1 API.')); }
      });
      card.appendChild(item);
    });
    panel.appendChild(card);
  }
  if (!panel.children.length) panel.innerHTML = '<div class="card"><h3>Comments</h3><div class="empty">No comments yet.</div></div>';
}

/* ── message moderation ───────────────────────────────── */
async function getAdminMessages() {
  const raw = await v1.get('/admin/messages');
  return Array.isArray(raw) ? raw : raw.items || [];
}

async function renderMessages() {
  const panel = $('p-messages');
  const messages = await getAdminMessages();
  panel.innerHTML = '<div class="card"><h3>Private inbox</h3><div class="note">Publication is disabled unless the sender explicitly consented. Contact details never appear on the public wall.</div><div class="message-list"></div></div>';
  const list = panel.querySelector('.message-list');
  if (!messages.length) { list.innerHTML = '<div class="empty">No messages.</div>'; return; }
  messages.forEach(message => {
    const consent = Boolean(message.publication_consent ?? message.consent_at ?? false);
    const published = Boolean(message.published_at || message.publish || (!('status' in message) && message.approved));
    const item = document.createElement('article'); item.className = 'list-item';
    item.innerHTML = `<div class="body"><div class="meta"><span class="badge">${esc(message.path)}</span>${esc(message.author_name || 'anonymous')} · ${esc(message.created_at || '')}${message.contact ? ` · PRIVATE CONTACT: ${esc(message.contact)}` : ''} ${consent ? '<span class="badge">publication consent</span>' : '<span class="badge pending">private only</span>'} ${published ? '<span class="badge">published</span>' : ''}</div><div>${esc(message.body)}</div><div class="row" style="margin-top:8px"><label class="field grow"><span>Public display name</span><input class="display-name" value="${esc(message.public_display_name || message.author_name || 'anonymous')}"></label></div></div><div class="moderation-actions"><button class="btn sm publish ${consent ? 'ok' : ''}" type="button" ${consent ? '' : 'disabled'}>${published ? 'update wall' : 'publish'}</button><button class="btn sm private" type="button">keep private</button><button class="btn sm warn reject" type="button">reject</button><button class="btn sm warn delete" type="button">delete</button></div>`;
    const patchMessage = async body => {
      try {
        await v1.patch(`/admin/messages/${message.id}`, body);
        renderMessages();
      } catch (error) {
        alert(errorMessage(error, 'Could not update this message.'));
      }
    };
    item.querySelector('.publish').addEventListener('click', () => patchMessage({ status: 'approved', publish: true, public_display_name: item.querySelector('.display-name').value.trim() || 'anonymous' }));
    item.querySelector('.private').addEventListener('click', () => patchMessage({ status: 'approved', publish: false, public_display_name: '' }));
    item.querySelector('.reject').addEventListener('click', () => patchMessage({ status: 'rejected', publish: false, public_display_name: '' }));
    item.querySelector('.delete').addEventListener('click', async () => {
      if (!confirm('Permanently delete this private message?')) return;
      try { await v1.del(`/admin/messages/${message.id}`); renderMessages(); }
      catch (error) { alert(errorMessage(error, 'Delete failed.')); }
    });
    list.appendChild(item);
  });
}

/* ── privacy-minimized statistics ─────────────────────── */
async function renderStats() {
  const panel = $('p-stats');
  const stats = await v1.get('/admin/stats').catch(() => null);
  if (!stats) { panel.innerHTML = '<div class="card"><div class="empty">Stats are unavailable.</div></div>'; return; }
  const totals = stats.totals || {};
  panel.innerHTML = `<div class="card"><h3>Consented aggregate activity</h3><div class="stat-grid">${Object.entries(totals).map(([label, value]) => `<div class="stat"><div class="value">${Number(value || 0).toLocaleString()}</div><div class="label">${esc(label.replaceAll('_', ' '))}</div></div>`).join('') || '<div class="empty">No consented events yet.</div>'}</div></div>`;
  const paths = stats.paths || stats.path_split || {};
  const sources = stats.source_details || stats.sources || stats.source_buckets || {};
  const daily = stats.daily || [];
  const detail = document.createElement('div'); detail.className = 'card';
  detail.innerHTML = `<h3>Traffic sources and paths · 90 days</h3><table><thead><tr><th>Path / source</th><th>Events</th></tr></thead><tbody>${[...Object.entries(paths), ...Object.entries(sources)].map(([key, value]) => `<tr><td>${esc(key)}</td><td>${Number(value || 0)}</td></tr>`).join('') || '<tr><td colspan="2">No consented traffic yet.</td></tr>'}</tbody></table>`;
  panel.appendChild(detail);
  const engagement = stats.engagement || {};
  const engagementCard = document.createElement('div'); engagementCard.className = 'card';
  engagementCard.innerHTML = `<h3>Published writing engagement</h3><div class="stat-grid">${Object.entries(engagement).map(([label, value]) => `<div class="stat"><div class="value">${Number(value || 0).toLocaleString()}</div><div class="label">${esc(label.replaceAll('_', ' '))}</div></div>`).join('')}</div><table><thead><tr><th>Post</th><th>Likes</th><th>Reactions</th><th>Comments</th></tr></thead><tbody>${(stats.top_posts || []).map(post => `<tr><td>${esc(post.title)}</td><td>${Number(post.likes || 0)}</td><td>${Number(post.reactions || 0)}</td><td>${Number(post.comments || 0)}</td></tr>`).join('') || '<tr><td colspan="4">No published posts yet.</td></tr>'}</tbody></table>`;
  panel.appendChild(engagementCard);
  const audience = stats.audience || {};
  const audienceCard = document.createElement('div'); audienceCard.className = 'card';
  audienceCard.innerHTML = `<h3>Audience profile · 90 days</h3><p class="note">Coarse, consented browser context only. No age, gender, ethnicity, precise location, IP address, or cross-dimension visitor profile is collected.</p>${Object.entries(audience).map(([dimension, values]) => `<h4>${esc(dimension.replaceAll('_', ' '))}</h4><table><tbody>${Object.entries(values).map(([value, count]) => `<tr><td>${esc(value)}</td><td>${Number(count || 0)}</td></tr>`).join('')}</tbody></table>`).join('') || '<div class="empty">No consented audience data yet.</div>'}`;
  panel.appendChild(audienceCard);
  const recent = document.createElement('div'); recent.className = 'card';
  recent.innerHTML = `<h3>Daily aggregates</h3><table><thead><tr><th>Day</th><th>Event</th><th>Count</th></tr></thead><tbody>${[...daily].reverse().map(row => `<tr><td>${esc(row.day)}</td><td>${esc(row.event_type || row.type || '')}</td><td>${Number(row.c ?? row.count ?? 0)}</td></tr>`).join('') || '<tr><td colspan="3">No daily aggregates.</td></tr>'}</tbody></table>`;
  panel.appendChild(recent);
}

/* ── revisions ────────────────────────────────────────── */
async function loadRevisions(entityType, entityId) {
  const raw = await v1.get(`/admin/revisions/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
  return Array.isArray(raw) ? raw : raw.items || [];
}

function revisionList(revisions, onRestore) {
  const list = document.createElement('div'); list.className = 'rev-list';
  if (!revisions.length) { list.innerHTML = '<div class="empty">No saved revisions.</div>'; return list; }
  revisions.forEach(revision => {
    const row = document.createElement('div'); row.className = 'rev';
    row.innerHTML = `<div class="body"><div class="meta">${esc(revision.created_at || '')} · revision ${esc(revision.id)}</div>${esc(revision.note || 'Saved change')}</div><button class="btn sm" type="button">restore</button>`;
    row.querySelector('button').addEventListener('click', async event => {
      if (!confirm(`Restore revision ${revision.id}? The current value will remain in revision history.`)) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await v1.post(`/admin/revisions/${revision.id}/restore`, {});
        onRestore?.();
      } catch (error) {
        button.disabled = false;
        openDialog('Restore failed', `<p>${esc(errorMessage(error, 'Could not restore this revision.'))}</p>`);
      }
    });
    list.appendChild(row);
  });
  return list;
}

async function showRevisions(entityId, title, entityType = 'content') {
  try {
    const revisions = await loadRevisions(entityType, entityId);
    const dialog = $('admin-dialog'), inner = dialog.querySelector('.dialog-inner');
    inner.innerHTML = `<button class="dialog-close" type="button" aria-label="Close">×</button><div class="preview-copy"><h2 id="admin-dialog-title">${esc(title)} revisions</h2><div class="rev-slot"></div></div>`;
    inner.querySelector('.rev-slot').appendChild(revisionList(revisions, () => { dialog.close(); location.reload(); }));
    inner.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    if (dialog.open) dialog.close(); dialog.showModal();
  } catch (error) { openDialog('Revisions unavailable', `<p>${esc(errorMessage(error, 'The revision endpoint is unavailable.'))}</p>`); }
}

async function renderRevisions() {
  const panel = $('p-revisions');
  panel.innerHTML = `<div class="card"><h3>Revision history</h3><div class="note">Choose an entity type and its key or numeric ID. Every published content, timeline, and post save creates a restorable snapshot.</div><div class="row" style="margin-top:12px"><label class="field narrow"><span>Entity type</span><select class="rev-type"><option value="content">content</option><option value="timeline_period">timeline period</option><option value="timeline_event">timeline event</option><option value="blog_post">post</option></select></label><label class="field grow"><span>Key or ID</span><input class="rev-id" placeholder="card, resume, legal, or 42"></label><button class="btn load-revs" type="button">Load history</button></div><div class="note rev-note" role="status"></div><div class="rev-results" style="margin-top:14px"></div></div>`;
  panel.querySelector('.load-revs').addEventListener('click', async () => {
    const type = panel.querySelector('.rev-type').value, id = panel.querySelector('.rev-id').value.trim();
    if (!id) { setNote(panel.querySelector('.rev-note'), 'Enter a key or ID.', 'error'); return; }
    try {
      const revisions = await loadRevisions(type, id);
      const slot = panel.querySelector('.rev-results'); slot.replaceChildren(revisionList(revisions, () => renderRevisions()));
      setNote(panel.querySelector('.rev-note'), `${revisions.length} revision${revisions.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) { setNote(panel.querySelector('.rev-note'), errorMessage(error, 'Could not load revisions.'), 'error'); }
  });
}

boot();
