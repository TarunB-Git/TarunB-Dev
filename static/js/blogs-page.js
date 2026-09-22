import { errorMessage, v1 } from './v1.js';
import { renderMd } from './blog.js';

const app = document.getElementById('blogs-app');
const progress = document.getElementById('reading-progress');
const PRIMARY = ['work', 'thoughts', 'dreams', 'friends', 'travel', 'life'];
const EMOJI = ['👍', '😂', '🤯', '✨', '🔥'];
const EMBEDDED = new URLSearchParams(location.search).get('embed') === '1';
document.documentElement.classList.toggle('is-embedded', EMBEDDED);
const journalHref = path => EMBEDDED ? `${path}${path.includes('?') ? '&' : '?'}embed=1` : path;
const esc = value => { const node = document.createElement('div'); node.textContent = value ?? ''; return node.innerHTML; };
const date = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '';
const tagHtml = post => [post.primary_tag, ...(post.secondary_tags || [])].filter(Boolean).map(tag => `<span class="tag">${esc(tag)}</span>`).join('');

async function renderArchive() {
  document.title = 'Writing — The Scroll';
  app.innerHTML = `<section class="archive-head"><div><div class="eyebrow">All paths · one archive</div><h1>Writing</h1><p class="archive-intro">Notes, work, dreams, journeys, and the thoughts collected between them.</p></div><div class="archive-controls"><label><span class="eyebrow">Search posts</span><input class="archive-search" type="search" placeholder="Words, tags, or series" aria-label="Search posts"></label><div class="archive-filters"><button class="on" data-tag="">all</button>${PRIMARY.map(tag => `<button data-tag="${tag}">${tag}</button>`).join('')}</div></div></section><section class="archive-list" aria-live="polite"></section>`;
  const list = app.querySelector('.archive-list');
  const search = app.querySelector('.archive-search');
  let activeTag = '', timer;
  async function load() {
    list.innerHTML = '<p class="archive-empty">Searching the scroll…</p>';
    const query = new URLSearchParams({ sort: 'new', limit: '50' });
    if (activeTag) query.set('tag', activeTag);
    if (search.value.trim()) query.set('q', search.value.trim());
    try {
      const payload = await v1.get(`/posts?${query}`);
      const posts = payload.items || payload;
      list.innerHTML = posts.length ? posts.map(post => `<a class="archive-card" href="${journalHref(`/blog/${encodeURIComponent(post.slug)}`)}"><time class="archive-date" datetime="${esc(post.created_at)}">${esc(date(post.created_at))}</time><span class="archive-copy"><h2>${esc(post.title)}</h2><p>${esc(post.excerpt || '')}</p><span class="archive-tags">${tagHtml(post)}</span></span><span class="archive-read">${post.reading_minutes} min read →</span></a>`).join('') : '<p class="archive-empty">No posts match that search.</p>';
    } catch (error) { list.innerHTML = `<p class="archive-empty">${esc(errorMessage(error, 'Writing could not be loaded.'))}</p>`; }
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 180); });
  app.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => {
    app.querySelectorAll('[data-tag]').forEach(item => item.classList.toggle('on', item === button));
    activeTag = button.dataset.tag; load();
  }));
  load();
}

function sideLinks(title, items) {
  if (!items?.length) return '';
  return `<section class="side-block"><div class="side-label">${esc(title)}</div>${items.map(item => `<a href="${journalHref(`/blog/${encodeURIComponent(item.slug)}`)}">${esc(item.title)}<small> · ${item.reading_minutes} min</small></a>`).join('')}</section>`;
}

function commentNode(comment) {
  return `<article class="comment"><small>${esc(comment.author_name || 'anonymous')} · ${esc(date(comment.created_at))}</small><p>${esc(comment.body)}</p>${(comment.replies || []).map(commentNode).join('')}</article>`;
}

async function renderPost(slug) {
  try {
    const post = await v1.get(`/posts/${encodeURIComponent(slug)}`);
    document.title = `${post.title} — The Scroll`;
    app.innerHTML = `<div class="post-layout"><article><header class="post-head"><div class="post-kicker">${esc(post.primary_tag)}${post.series ? ` · ${esc(post.series)}` : ''}</div><h1 class="post-title">${esc(post.title)}</h1><div class="post-meta"><time datetime="${esc(post.created_at)}">${esc(date(post.created_at))}</time><span>${post.reading_minutes} min read</span><span>${post.word_count} words</span></div><div class="post-tags">${tagHtml(post)}</div></header><div class="post-body">${renderMd(post.body_md)}</div><section class="post-engagement" aria-label="Post reactions"><button class="post-like ${post.liked ? 'on' : ''}" type="button" aria-pressed="${Boolean(post.liked)}">♥ <span>${post.likes || 0}</span></button><div class="post-reactions">${EMOJI.map(emoji => `<button class="${post.my_reactions?.includes(emoji) ? 'on' : ''}" type="button" data-emoji="${emoji}" aria-pressed="${post.my_reactions?.includes(emoji) || false}" aria-label="React ${emoji}">${emoji} <span>${post.reactions?.[emoji] || ''}</span></button>`).join('')}</div><span class="engagement-status" role="status"></span></section><nav class="post-nav">${post.newer ? `<a href="${journalHref(`/blog/${encodeURIComponent(post.newer.slug)}`)}"><small>← newer</small><br>${esc(post.newer.title)}</a>` : '<span></span>'}${post.older ? `<a href="${journalHref(`/blog/${encodeURIComponent(post.older.slug)}`)}"><small>older →</small><br>${esc(post.older.title)}</a>` : ''}</nav><section class="post-comments"><h2>Comments</h2><div class="comment-list"><p class="journal-loading">Loading comments…</p></div><form class="comment-form"><input name="name" maxlength="60" placeholder="Name (optional)"><input name="website" tabindex="-1" autocomplete="off" hidden><textarea name="body" maxlength="4000" required placeholder="Join the conversation"></textarea><button>Post comment</button><span class="comment-status" role="status"></span></form></section></article><aside class="post-side">${sideLinks(post.series ? `More in ${post.series}` : 'Related posts', post.related)}${sideLinks('Recent posts', post.recent)}<section class="side-block"><a href="${journalHref('/blogs')}">← All writing</a></section></aside></div>`;
    const engagementStatus = app.querySelector('.engagement-status');
    app.querySelector('.post-like').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        const result = await v1.post(`/posts/${post.id}/like`, {});
        const active = Boolean(result.active ?? result.liked);
        button.classList.toggle('on', active); button.setAttribute('aria-pressed', String(active));
        button.querySelector('span').textContent = result.count ?? result.likes ?? 0;
        engagementStatus.textContent = active ? 'Post liked.' : 'Like removed.';
      } catch (error) { engagementStatus.textContent = errorMessage(error, 'Could not update the like.'); }
      finally { button.disabled = false; }
    });
    app.querySelectorAll('.post-reactions button').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await v1.post(`/posts/${post.id}/reactions`, { emoji: button.dataset.emoji });
        button.classList.toggle('on', Boolean(result.active)); button.setAttribute('aria-pressed', String(Boolean(result.active)));
        button.querySelector('span').textContent = result.count || '';
        engagementStatus.textContent = result.active ? `Reaction ${button.dataset.emoji} added.` : `Reaction ${button.dataset.emoji} removed.`;
      } catch (error) { engagementStatus.textContent = errorMessage(error, 'Could not update the reaction.'); }
      finally { button.disabled = false; }
    }));
    const comments = app.querySelector('.comment-list');
    const loadComments = async () => {
      const result = await v1.get(`/posts/${post.id}/comments?limit=50`);
      comments.innerHTML = result.items?.length ? result.items.map(commentNode).join('') : '<p class="archive-empty">No comments yet.</p>';
    };
    loadComments().catch(() => { comments.innerHTML = '<p class="archive-empty">Comments could not be loaded.</p>'; });
    app.querySelector('.comment-form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('.comment-status');
      const data = new FormData(form); const button = form.querySelector('button'); button.disabled = true;
      try { await v1.post(`/posts/${post.id}/comments`, { author_name: data.get('name') || 'anonymous', body: data.get('body'), website: data.get('website') || '' }); form.reset(); status.textContent = 'Posted.'; await loadComments(); }
      catch (error) { status.textContent = errorMessage(error, 'Could not post comment.'); }
      finally { button.disabled = false; }
    });
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = `${max > 0 ? Math.min(100, scrollY / max * 100) : 100}%`;
    };
    addEventListener('scroll', updateProgress, { passive: true }); updateProgress();
  } catch (error) {
    app.innerHTML = `<p class="archive-empty">${esc(errorMessage(error, 'This post could not be opened.'))}<br><a href="${journalHref('/blogs')}">Return to all writing</a></p>`;
  }
}

const slug = location.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/)?.[1];
if (slug) renderPost(slug); else renderArchive();
