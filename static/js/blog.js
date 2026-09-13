/* Filterable writing, distinct likes/reactions, and three-level threads. */
import { v1, errorMessage } from './v1.js';

const esc = value => {
  const node = document.createElement('div');
  node.textContent = value ?? '';
  return node.innerHTML;
};
const EMOJI = ['👍', '😂', '🤯', '✨', '🔥'];
const PATH_TAGS = ['recruiter', 'friend', 'viewer', 'personal'];
/* Depth 0 + two nested replies = three visible levels, matching the API. */
const MAX_REPLY_DEPTH = 2;
let activeSlug = '';
let returnUrl = '';
let returnFocus = null;
let dialogReady = false;
let historyPushed = false;
let openRequest = 0;

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

function pathUrl(path, mode = false) {
  return path === 'recruiter' && mode ? '/recruiter?mode=light' : `/${path}`;
}

function routeOrigin({ preferPage = false } = {}) {
  const url = new URL(location.href);
  const direct = url.pathname.match(/^\/(recruiter|friend|viewer|personal)\/?$/)?.[1];
  const encoded = url.pathname.startsWith('/blog/') ? url.searchParams.get('from') : '';
  const pagePath = document.body.dataset.path;
  const candidate = preferPage ? (pagePath || direct) : (encoded || pagePath || direct);
  const path = PATH_TAGS.includes(candidate) ? candidate : 'personal';
  const mode = path === 'recruiter' && (
    url.searchParams.get('mode') === 'light' || document.body.classList.contains('rm-on')
  );
  return { path, mode };
}

function blogUrl(slug, origin) {
  const url = new URL(`/blog/${slug}`, location.origin);
  url.searchParams.set('from', origin.path);
  if (origin.path === 'recruiter' && origin.mode) url.searchParams.set('mode', 'light');
  return `${url.pathname}${url.search}`;
}

function safeReturnUrl(value, origin) {
  return typeof value === 'string' && /^\/(recruiter|friend|viewer|personal)(?:[?#]|$)/.test(value)
    ? value : fallbackReturnUrl(origin);
}

function fallbackReturnUrl(origin) {
  const url = new URL(pathUrl(origin.path, origin.mode), location.origin);
  const returnEvent = safeSlug(new URL(location.href).searchParams.get('returnEvent'));
  if (returnEvent) url.searchParams.set('event', returnEvent);
  return `${url.pathname}${url.search}${url.hash}`;
}

/* Escape before applying a deliberately small Markdown subset. Link output is
   restricted to HTTPS/HTTP and receives noopener. */
export function renderMd(source) {
  let html = esc(source || '');
  html = html.replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return html.split(/\n{2,}/).map(block => /^<h\d/.test(block)
    ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
}

function listPayload(value) {
  if (Array.isArray(value)) return { items: value, next_cursor: null };
  return { items: value?.items || [], next_cursor: value?.next_cursor || null };
}

function normalizePost(post) {
  return {
    ...post,
    slug: safeSlug(post.slug),
    tags: Array.isArray(post.tags) ? post.tags : [],
    likes: Number(post.likes ?? post.like_count ?? 0),
    comments: Number(post.comments ?? post.comment_count ?? 0),
    reaction_count: Number(post.reaction_count ?? Object.values(post.reactions || {}).reduce((sum, value) => sum + Number(value || 0), 0)),
    reactions: post.reactions || {},
    my_reactions: post.my_reactions || [],
    liked: Boolean(post.liked ?? post.my_like),
    excerpt: post.excerpt || String(post.body_md || '').slice(0, 220),
  };
}

async function getPosts(params) {
  const query = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const page = listPayload(await v1.get(`/posts?${query}`));
  return { ...page, items: page.items.map(normalizePost) };
}

async function getPost(slug) {
  return normalizePost(await v1.get(`/posts/${encodeURIComponent(slug)}`));
}

export function mountBlog(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="blog-controls">
      <div class="blog-chips" role="group" aria-label="Filter writing by path">
        <button class="bchip on" type="button" data-tag="" aria-pressed="true">all</button>
        ${PATH_TAGS.map(tag => `<button class="bchip" type="button" data-tag="${tag}" aria-pressed="false">${tag}</button>`).join('')}
      </div>
      <div class="blog-sorts" role="group" aria-label="Sort writing">
        <button class="bsort on" type="button" data-sort="new" aria-pressed="true">newest</button>
        <button class="bsort" type="button" data-sort="popular" aria-pressed="false">popular</button>
      </div>
    </div>
    <div class="blog-list" aria-live="polite"></div>
    <button class="blog-more" type="button" hidden>Load more</button>`;
  const state = { tag: '', sort: 'new', cursor: null, request: 0 };
  const list = container.querySelector('.blog-list');
  const more = container.querySelector('.blog-more');

  const refresh = async append => {
    const stamp = ++state.request;
    if (!append) {
      state.cursor = null;
      list.innerHTML = '<div class="blog-empty">Loading writing…</div>';
    }
    const query = new URLSearchParams({ sort: state.sort, limit: '8' });
    if (state.tag) query.set('tag', state.tag);
    if (state.cursor) query.set('cursor', state.cursor);
    const page = await getPosts(query);
    if (stamp !== state.request) return;
    if (!append) list.innerHTML = '';
    page.items.forEach(post => list.appendChild(postRow(post)));
    if (!list.children.length) list.innerHTML = '<div class="blog-empty">Nothing written yet.</div>';
    state.cursor = page.next_cursor;
    more.hidden = !state.cursor;
  };

  container.querySelectorAll('.bchip').forEach(button => button.addEventListener('click', () => {
    container.querySelectorAll('.bchip').forEach(item => {
      item.classList.toggle('on', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    state.tag = button.dataset.tag;
    refresh(false);
  }));
  container.querySelectorAll('.bsort').forEach(button => button.addEventListener('click', () => {
    container.querySelectorAll('.bsort').forEach(item => {
      item.classList.toggle('on', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    state.sort = button.dataset.sort;
    refresh(false);
  }));
  more.addEventListener('click', () => refresh(true));
  refresh(false);
}

export async function mountTaggedPosts(container, tag) {
  if (!container) return;
  const label = container.previousElementSibling;
  const ownsLabel = label?.matches('.sec-label, .frnd-section-label, .view-section-label');
  container.hidden = false;
  if (ownsLabel) label.hidden = false;
  container.innerHTML = '<div class="blog-empty" role="status">Loading writing…</div>';
  const requestId = Number(container.dataset.taggedRequest || 0) + 1;
  container.dataset.taggedRequest = String(requestId);
  const state = { cursor: '', loading: false };
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'blog-more';
  more.textContent = 'Load more';
  more.hidden = true;

  const load = async append => {
    if (state.loading) return;
    state.loading = true;
    more.disabled = true;
    try {
      const query = new URLSearchParams({ tag, sort: 'new', limit: '6' });
      if (append && state.cursor) query.set('cursor', state.cursor);
      const page = await getPosts(query);
      if (container.dataset.taggedRequest !== String(requestId)) return;
      if (!append) container.replaceChildren();
      page.items.forEach(post => container.appendChild(postRow(post, true)));
      state.cursor = page.next_cursor || '';
      more.hidden = !state.cursor;
      container.appendChild(more);
      const hasPosts = Boolean(container.querySelector('.blog-row'));
      container.hidden = !hasPosts;
      if (ownsLabel) label.hidden = !hasPosts;
    } catch (error) {
      if (container.dataset.taggedRequest !== String(requestId)) return;
      if (!append) {
        container.innerHTML = `<div class="blog-empty" role="alert">${esc(errorMessage(error, 'Writing could not be loaded.'))}</div>`;
      }
    } finally {
      state.loading = false;
      more.disabled = false;
    }
  };

  more.addEventListener('click', () => load(true));
  await load(false);
}

function postRow(post, compact = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `blog-row${compact ? ' compact' : ''}`;
  button.innerHTML = `
    <span class="br-main">
      <span class="br-title">${esc(post.title)}</span>
      <span class="br-meta"><time datetime="${esc(post.created_at || '')}">${esc((post.created_at || '').slice(0, 10))}</time>
        <span aria-label="${post.likes} likes">♥ ${post.likes}</span>
        <span aria-label="${post.reaction_count} reactions">✦ ${post.reaction_count}</span>
        <span aria-label="${post.comments} comments">↳ ${post.comments}</span>
        ${post.tags.map(tag => `<span class="br-tag">${esc(tag)}</span>`).join('')}</span>
      ${compact ? '' : `<span class="br-excerpt">${esc(post.excerpt)}${post.excerpt ? '…' : ''}</span>`}
    </span>
    <span class="br-open" aria-hidden="true">read →</span>`;
  button.addEventListener('click', event => openPost(post.slug, { opener: event.currentTarget, push: true }));
  return button;
}

function ensureDialog() {
  const modal = document.getElementById('blog-mo');
  if (!modal) return null;
  if (dialogReady) return modal;
  dialogReady = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-labelledby', 'blog-dialog-title');
  modal.removeAttribute('aria-label');
  modal.inert = true;
  modal.onclick = null;
  modal.addEventListener('click', event => { if (event.target === modal) closePost(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePost(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  return modal;
}

async function toggleLike(post, button) {
  button.disabled = true;
  const status = button.closest('.bp-engagement')?.querySelector('.bp-action-status');
  try {
    const result = await v1.post(`/posts/${post.id}/like`, {});
    const active = Boolean(result.active ?? result.liked);
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('span').textContent = result.count ?? result.likes ?? 0;
    if (status) status.textContent = active ? 'Post liked.' : 'Like removed.';
  } catch (error) {
    if (status) status.textContent = errorMessage(error, 'Could not update the like.');
  }
  finally { button.disabled = false; }
}

async function toggleReaction(post, button) {
  button.disabled = true;
  const status = button.closest('.bp-engagement')?.querySelector('.bp-action-status');
  try {
    const result = await v1.post(`/posts/${post.id}/reactions`, { emoji: button.dataset.emoji });
    button.classList.toggle('on', result.active);
    button.setAttribute('aria-pressed', String(Boolean(result.active)));
    button.querySelector('span').textContent = result.count || '';
    if (status) status.textContent = result.active ? `Reaction ${button.dataset.emoji} added.` : `Reaction ${button.dataset.emoji} removed.`;
  } catch (error) {
    if (status) status.textContent = errorMessage(error, 'Could not update the reaction.');
  }
  finally { button.disabled = false; }
}

async function loadComments(postId, cursor = '') {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return listPayload(await v1.get(`/posts/${postId}/comments?${query}`));
}

async function sendComment(postId, fields, parentId) {
  const payload = {
    author_name: fields.name.value.trim() || 'anonymous',
    body: fields.body.value.trim(),
    website: fields.website.value,
  };
  if (parentId != null) payload.parent_id = parentId;
  return v1.post(`/posts/${postId}/comments`, payload);
}

function commentForm(label = 'Post comment') {
  const form = document.createElement('form');
  form.className = label === 'Post comment' ? 'bp-cform' : 'bc-replybox';
  form.innerHTML = `
    <label><span>Name <small>optional</small></span><input class="bc-name" type="text" maxlength="60" autocomplete="name"></label>
    <label class="bc-hp" aria-hidden="true">Website<input class="bc-website" type="text" tabindex="-1" autocomplete="off"></label>
    <label><span>${label === 'Post comment' ? 'Comment' : 'Reply'}</span><textarea class="bc-body" maxlength="4000" required></textarea></label>
    <div class="bc-form-row"><button class="bc-send" type="submit">${label}</button><span class="bc-status" role="status"></span></div>`;
  return form;
}

function commentEl(comment, postId, reload, depth = 0) {
  const article = document.createElement('article');
  const storedDepth = Number.isInteger(comment.depth) ? comment.depth : depth;
  article.className = 'bcomment';
  article.dataset.depth = Math.min(storedDepth, MAX_REPLY_DEPTH);
  article.innerHTML = `
    <header class="bc-meta"><span class="bc-author">${esc(comment.author_name || 'anonymous')}</span>
      <time class="bc-date" datetime="${esc(comment.created_at || '')}">${esc((comment.created_at || '').slice(0, 16).replace('T', ' '))}</time>
      ${storedDepth < MAX_REPLY_DEPTH ? '<button class="bc-reply" type="button" aria-expanded="false">reply</button>' : ''}</header>
    <div class="bc-text">${esc(comment.body)}</div>
    <div class="bc-replyslot"></div>
    <div class="bc-children"></div>`;
  const reply = article.querySelector('.bc-reply');
  if (reply) reply.addEventListener('click', () => {
    const slot = article.querySelector('.bc-replyslot');
    const open = Boolean(slot.firstChild);
    slot.replaceChildren();
    reply.setAttribute('aria-expanded', String(!open));
    if (open) return;
    const form = commentForm('Post reply');
    slot.appendChild(form);
    form.querySelector('.bc-body').focus();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const send = form.querySelector('.bc-send');
      const status = form.querySelector('.bc-status');
      const fields = { name: form.querySelector('.bc-name'), body: form.querySelector('.bc-body'), website: form.querySelector('.bc-website') };
      if (!fields.body.value.trim()) return;
      const authorName = fields.name.value.trim() || 'anonymous';
      const body = fields.body.value.trim();
      send.disabled = true;
      try {
        const saved = await sendComment(postId, fields, comment.id);
        if (saved?.id) {
          const child = {
            id: saved.id, parent_id: comment.id, depth: saved.depth ?? storedDepth + 1,
            author_name: authorName, body, created_at: new Date().toISOString(), replies: [],
          };
          (comment.replies ||= []).push(child);
          slot.replaceChildren();
          reply.setAttribute('aria-expanded', 'false');
          children.appendChild(commentEl(child, postId, reload, depth + 1));
        } else {
          await reload();
        }
      }
      catch (error) { status.textContent = errorMessage(error, 'Could not post reply.'); }
      finally { send.disabled = false; }
    });
  });
  const children = article.querySelector('.bc-children');
  (comment.replies || []).forEach(child => children.appendChild(commentEl(child, postId, reload, depth + 1)));
  return article;
}

export async function openPost(slug, options = {}) {
  slug = safeSlug(slug);
  if (!slug) return;
  const requestId = ++openRequest;
  const modal = ensureDialog();
  if (!modal) return;
  const origin = routeOrigin({ preferPage: Boolean(options.push) });
  modal.dataset.origin = origin.path;
  modal.dataset.light = String(origin.path === 'recruiter' && origin.mode);
  if (!options.push) {
    returnUrl = safeReturnUrl(history.state?.blogReturn, origin);
  }
  const box = modal.querySelector('.blog-box');
  if (!modal.classList.contains('open')) {
    returnFocus = options.opener || document.getElementById(`ps-${origin.path}`) || document.activeElement;
  }
  box.innerHTML = '<div class="blog-loading" id="blog-dialog-title" role="status">Opening post…</div>';
  modal.inert = false;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('blog-dialog-open');
  activeSlug = slug;
  historyPushed = Boolean(history.state?.blogSlug === slug);
  requestAnimationFrame(() => box.focus());
  let post;
  try { post = await getPost(slug); }
  catch (error) {
    if (requestId !== openRequest) return;
    box.innerHTML = `<button class="xb" id="blog-close" type="button" aria-label="Close post">×</button><div class="blog-loading" id="blog-dialog-title" role="alert">${esc(errorMessage(error, 'Could not open this post.'))}</div>`;
    box.querySelector('#blog-close').addEventListener('click', closePost);
    box.querySelector('#blog-close').focus();
    return;
  }
  if (requestId !== openRequest) return;
  if (!post.id) { closePost(); return; }
  if (options.push) {
    returnUrl = `${location.pathname}${location.search}${location.hash}`;
    history.pushState({
      ...(history.state || {}), blogSlug: slug, blogReturn: returnUrl, blogOrigin: origin,
    }, '', blogUrl(slug, origin));
  }
  historyPushed = Boolean(options.push || history.state?.blogSlug === slug);
  box.innerHTML = `
    <button class="xb" id="blog-close" type="button" aria-label="Close post">×</button>
    <article>
      <h2 class="bp-title" id="blog-dialog-title">${esc(post.title)}</h2>
      <div class="bp-meta"><time datetime="${esc(post.created_at || '')}">${esc((post.created_at || '').slice(0, 10))}</time>${post.tags.map(tag => `<span class="br-tag">${esc(tag)}</span>`).join('')}</div>
      <div class="bp-body">${renderMd(post.body_md)}</div>
      <div class="bp-engagement" aria-label="Post engagement">
        <button class="bp-like ${post.liked ? 'on' : ''}" type="button" aria-pressed="${post.liked}" aria-label="Like this post">♥ Like <span>${post.likes}</span></button>
        <div class="bp-reactions" role="group" aria-label="Emoji reactions">${EMOJI.map(emoji =>
          `<button class="react ${post.my_reactions.includes(emoji) ? 'on' : ''}" type="button" data-emoji="${emoji}" aria-pressed="${post.my_reactions.includes(emoji)}" aria-label="React ${emoji}">${emoji} <span>${post.reactions[emoji] || ''}</span></button>`).join('')}</div>
        <span class="bp-action-status" role="status" aria-live="polite"></span>
      </div>
      <section class="bp-comments" aria-labelledby="comments-title">
        <h3 id="comments-title">Comments</h3>
        <div class="bp-clist" aria-live="polite"></div>
        <button class="blog-more bc-more" type="button" hidden>Load more threads</button>
      </section>
    </article>`;
  box.querySelector('#blog-close').addEventListener('click', closePost);
  box.querySelector('.bp-like').addEventListener('click', event => toggleLike(post, event.currentTarget));
  box.querySelectorAll('.react').forEach(button => button.addEventListener('click', event => toggleReaction(post, event.currentTarget)));
  const list = box.querySelector('.bp-clist');
  const commentsMore = box.querySelector('.bc-more');
  const form = commentForm();
  box.querySelector('.bp-comments').appendChild(form);
  let commentRoots = [];
  let commentCursor = '';
  const renderCommentRoots = () => {
    list.innerHTML = commentRoots.length ? '' : '<div class="bc-empty">No comments yet.</div>';
    commentRoots.forEach(comment => list.appendChild(commentEl(comment, post.id, () => refreshComments(false))));
    commentsMore.hidden = !commentCursor;
  };
  const refreshComments = async (append = false) => {
    const page = await loadComments(post.id, append ? commentCursor : '');
    if (append) {
      const seen = new Set(commentRoots.map(comment => String(comment.id)));
      commentRoots = [...commentRoots, ...page.items.filter(comment => !seen.has(String(comment.id)))];
    } else {
      commentRoots = page.items;
    }
    commentCursor = page.next_cursor || '';
    renderCommentRoots();
  };
  commentsMore.addEventListener('click', async () => {
    commentsMore.disabled = true;
    try { await refreshComments(true); }
    catch (error) { form.querySelector('.bc-status').textContent = errorMessage(error, 'More threads could not be loaded.'); }
    finally { commentsMore.disabled = false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = { name: form.querySelector('.bc-name'), body: form.querySelector('.bc-body'), website: form.querySelector('.bc-website') };
    const status = form.querySelector('.bc-status');
    const send = form.querySelector('.bc-send');
    if (!fields.body.value.trim()) return;
    const authorName = fields.name.value.trim() || 'anonymous';
    const body = fields.body.value.trim();
    send.disabled = true;
    try {
      const saved = await sendComment(post.id, fields);
      fields.body.value = '';
      status.textContent = 'Posted.';
      if (saved?.id) {
        commentRoots.unshift({
          id: saved.id, parent_id: null, depth: saved.depth ?? 0, author_name: authorName,
          body, created_at: new Date().toISOString(), replies: [],
        });
        renderCommentRoots();
      } else {
        await refreshComments(false);
      }
    } catch (error) { status.textContent = errorMessage(error, 'Could not post comment.'); }
    finally { send.disabled = false; }
  });
  try { await refreshComments(false); }
  catch (error) {
    list.innerHTML = `<div class="bc-empty" role="alert">${esc(errorMessage(error, 'Comments could not be loaded.'))}</div>`;
  }
  if (requestId !== openRequest) return;
  requestAnimationFrame(() => box.querySelector('#blog-close')?.focus());
}

export function closePost(options = {}) {
  openRequest += 1;
  const modal = document.getElementById('blog-mo');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('blog-dialog-open');
  const oldSlug = activeSlug;
  activeSlug = '';
  if (!options.fromHistory && location.pathname === `/blog/${oldSlug}`) {
    if (historyPushed) {
      historyPushed = false;
      history.back();
    } else {
      history.replaceState({ ...(history.state || {}), blogSlug: null }, '', returnUrl || '/personal');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }
  }
  if (options.fromHistory) historyPushed = false;
  returnFocus?.focus?.({ preventScroll: true });
  returnFocus = null;
  modal.inert = true;
}

addEventListener('popstate', () => {
  const slug = location.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/)?.[1];
  if (slug && slug !== activeSlug) openPost(slug, { push: false });
  else if (!slug && activeSlug) closePost({ fromHistory: true });
});

queueMicrotask(() => {
  const slug = location.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/)?.[1];
  if (slug) {
    const origin = routeOrigin();
    returnUrl = safeReturnUrl(history.state?.blogReturn, origin);
    openPost(slug, { push: false });
  }
});
