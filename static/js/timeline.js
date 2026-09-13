/* Accessible illustrated timeline.
   Desktop uses a sticky scene whose selected period follows normal vertical
   scrolling. The same data is rendered as a linear, fully readable timeline
   on narrow screens and for print. */
import { maybeGet } from './v1.js';

const controllers = new WeakMap();
const mqMobile = matchMedia('(max-width: 760px)');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const esc = value => {
  const node = document.createElement('div');
  node.textContent = value ?? '';
  return node.innerHTML;
};

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100);
}

function safeMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, location.origin);
    if (url.origin === location.origin || url.protocol === 'https:') return url.href;
  } catch { /* invalid URL */ }
  return '';
}

function linkView(link) {
  if (link?.kind === 'post' && safeSlug(link.slug)) {
    return {
      kind: 'post', slug: safeSlug(link.slug), href: `/blog/${safeSlug(link.slug)}`,
      label: link.label || 'Read post', external: false,
    };
  }
  const raw = link?.url || link?.href;
  try {
    const url = new URL(String(raw || ''), location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return {
      kind: 'external',
      href: url.href,
      label: link?.label || (url.hostname === location.hostname ? 'Open' : url.hostname),
      external: url.origin !== location.origin,
    };
  } catch { return null; }
}

function eventLinkHref(link, container, event) {
  if (link.kind !== 'post') return link.href;
  const path = container.dataset.timelinePath;
  const url = new URL(`/blog/${link.slug}`, location.origin);
  url.searchParams.set('from', path);
  url.searchParams.set('returnEvent', event.slug);
  if (path === 'recruiter' && document.body.classList.contains('rm-on')) {
    url.searchParams.set('mode', 'light');
  }
  return `${url.pathname}${url.search}`;
}

function normalizeTimeline(raw, path) {
  if (raw?.periods) {
    return {
      path,
      periods: raw.periods
        .map((period, periodIndex) => ({
          id: period.id ?? `period-${periodIndex}`,
          label: period.label || period.year_label || `Period ${periodIndex + 1}`,
          sort_order: period.sort_order ?? periodIndex,
          events: (period.events || []).map((event, eventIndex) => normalizeEvent(event, period, eventIndex))
            .sort((a, b) => a.sort_order - b.sort_order),
        }))
        .sort((a, b) => a.sort_order - b.sort_order),
    };
  }

  const groups = new Map();
  (Array.isArray(raw) ? raw : []).forEach((event, eventIndex) => {
    const label = event.year_label || event.period || 'Undated';
    if (!groups.has(label)) groups.set(label, {
      id: `legacy-${groups.size}`,
      label,
      sort_order: groups.size,
      events: [],
    });
    groups.get(label).events.push(normalizeEvent(event, { label }, eventIndex));
  });
  return {
    path,
    periods: [...groups.values()].map(period => ({
      ...period, events: period.events.sort((a, b) => a.sort_order - b.sort_order),
    })),
  };
}

function normalizeEvent(event, period, index) {
  const legacyLinks = (event.links || []).map(link => link.kind ? link : {
    kind: 'external', label: link.label, url: link.href,
  });
  const layouts = ['upper', 'lower', 'feature', 'media-left', 'media-right'];
  return {
    id: event.id ?? `${period.id || period.label}-${index}`,
    slug: safeSlug(event.slug || `${period.label || 'period'}-${event.title || index}`) || `event-${index}`,
    category: event.category || event.subtitle || '',
    title: event.title || 'Untitled event',
    subtitle: event.subtitle || '',
    summary: event.summary || event.description || '',
    details_md: event.details_md || event.details || event.description || '',
    layout: layouts.includes(event.layout) ? event.layout : layouts[index % layouts.length],
    accent: ['gold', 'teal', 'violet', 'crimson', 'blue'].includes(event.accent) ? event.accent : '',
    media: event.media || null,
    links: legacyLinks.map(linkView).filter(Boolean),
    sort_order: event.sort_order ?? index,
    important: event.important === true || (event.important !== false && (
      index === 0 || ['feature', 'media-right'].includes(event.layout)
    )),
  };
}

async function loadTimeline(path) {
  const current = await maybeGet(`/timelines/${encodeURIComponent(path)}`);
  return normalizeTimeline(current || { path, periods: [] }, path);
}

function iconFor(event) {
  const key = `${event.category} ${event.title}`.toLowerCase();
  if (/book|read/.test(key)) return '▤';
  if (/education|school|university/.test(key)) return '⌂';
  if (/project|build|work/.test(key)) return '◇';
  if (/friend|people|crew/.test(key)) return '◎';
  if (/value|identity|story/.test(key)) return '✦';
  return '○';
}

function mediaMarkup(event, expanded = false) {
  const url = safeMediaUrl(event.media?.url);
  if (!url) return '';
  const alt = event.media?.alt_text || '';
  if ((event.media?.mime_type || '').startsWith('video/')) {
    return `<video class="tl-media" src="${esc(url)}" aria-label="${esc(alt)}" muted playsinline preload="metadata"${expanded ? ' controls' : ''}></video>`;
  }
  return `<img class="tl-media" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

function detailsMarkup(source) {
  let html = esc(source || '');
  html = html.replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return html.split(/\n{2,}/).map(block => /^<h\d/.test(block)
    ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
}

function eventButton(event, index, periodIndex, mobile = false) {
  const article = document.createElement('article');
  article.className = `tl-event tl-layout-${event.layout}${event.accent ? ` tl-accent-${event.accent}` : ''}`;
  article.style.setProperty('--event-index', index);
  article.dataset.event = event.slug;
  article.dataset.period = periodIndex;
  article.dataset.important = String(Boolean(event.important));
  article.innerHTML = `
    ${mediaMarkup(event)}
    <div class="tl-event-copy">
      <div class="tl-kicker"><span aria-hidden="true">${iconFor(event)}</span>${esc(event.category || event.subtitle)}</div>
      <h3 class="tl-title">${esc(event.title)}</h3>
      ${event.summary ? `<p class="tl-summary">${esc(event.summary)}</p>` : ''}
    </div>
    <button class="tl-plus" type="button" aria-label="More about ${esc(event.title)}">+</button>`;
  if (mobile) article.classList.add('tl-mobile-event');
  return article;
}

function dialogShell(container) {
  let dialog = container.querySelector('.tl-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'tl-dialog';
  dialog.dataset.path = container.dataset.timelinePath || 'recruiter';
  const titleId = `tl-dialog-title-${safeSlug(container.dataset.timelinePath || 'timeline')}`;
  dialog.dataset.titleId = titleId;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = '<div class="tl-dialog-inner"></div>';
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => {
    dialog._returnFocus?.focus?.({ preventScroll: true });
    dialog._returnFocus = null;
    const skipHistorySync = dialog._skipHistorySync;
    dialog._skipHistorySync = false;
    if (skipHistorySync) return;
    const url = new URL(location.href);
    if (url.searchParams.has('event')) {
      if (dialog._historyPushed) {
        dialog._historyPushed = false;
        history.back();
      } else {
        url.searchParams.delete('event');
        history.replaceState(history.state, '', url);
      }
    }
  });
  container.appendChild(dialog);
  return dialog;
}

function showDialog(dialog, opener) {
  dialog._returnFocus = opener || document.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  requestAnimationFrame(() => dialog.querySelector('.tl-dialog-close,button,a')?.focus());
}

function openEvent(container, event, period, opener, updateUrl = true) {
  const dialog = dialogShell(container);
  dialog.dataset.path = container.dataset.timelinePath || 'recruiter';
  dialog.dataset.eventSlug = event.slug;
  const copy = detailsMarkup(event.details_md || event.summary);
  dialog.querySelector('.tl-dialog-inner').innerHTML = `
    <button class="tl-dialog-close" type="button" aria-label="Close details">×</button>
    <div class="tl-dialog-period">${esc(period.label)}${event.category ? ` · ${esc(event.category)}` : ''}</div>
    <h2 id="${esc(dialog.dataset.titleId)}">${esc(event.title)}</h2>
    ${mediaMarkup(event, true)}
    <div class="tl-dialog-copy">${copy}</div>
    ${event.links.length ? `<div class="tl-dialog-links">${event.links.map(link =>
      `<a href="${esc(eventLinkHref(link, container, event))}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(link.label)}${link.external ? ' ↗' : ' →'}</a>`).join('')}</div>` : ''}`;
  dialog.querySelector('.tl-dialog-close').addEventListener('click', () => dialog.close());
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('event', event.slug);
    history.pushState({ ...(history.state || {}), timelineEvent: event.slug }, '', url);
  }
  dialog._historyPushed = Boolean(updateUrl || history.state?.timelineEvent === event.slug);
  showDialog(dialog, opener);
}

function openOverview(container, timeline, selectPeriod, opener) {
  const dialog = dialogShell(container);
  dialog.dataset.eventSlug = '';
  dialog._historyPushed = false;
  dialog.querySelector('.tl-dialog-inner').innerHTML = `
    <button class="tl-dialog-close" type="button" aria-label="Close overview">×</button>
    <div class="tl-dialog-period">Timeline overview</div>
    <h2 id="${esc(dialog.dataset.titleId)}">Choose a period</h2>
    <div class="tl-overview-grid">${timeline.periods.map((period, index) => `
      <button type="button" data-period="${index}">
        <strong>${esc(period.label)}</strong>
        <span>${period.events.length} ${period.events.length === 1 ? 'event' : 'events'}</span>
      </button>`).join('')}</div>`;
  dialog.querySelector('.tl-dialog-close').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    dialog.close();
    selectPeriod(Number(button.dataset.period), true);
  }));
  showDialog(dialog, opener);
}

function buildDesktop(container, timeline) {
  const desktop = document.createElement('div');
  const theme = ['viewer', 'personal', 'friend'].includes(timeline.path) ? timeline.path : '';
  desktop.className = `tl-desktop tl-continuous${theme ? ` tl-theme-${theme}` : ''}`;
  const actor = theme === 'viewer'
    ? '<div class="tl-path-actor tl-sailing-ship" aria-hidden="true"><i></i><i></i><span></span></div><div class="tl-theme-sea" aria-hidden="true"></div>'
    : theme === 'personal'
      ? '<div class="tl-scroll-paper" aria-hidden="true"></div><i class="tl-scroll-roller tl-scroll-left" aria-hidden="true"></i><i class="tl-scroll-roller tl-scroll-right" aria-hidden="true"></i>'
      : theme === 'friend'
        ? '<div class="tl-path-actor tl-orbiting-moon" aria-hidden="true"><i></i></div><div class="tl-theme-stars" aria-hidden="true"></div>'
        : '';
  desktop.innerHTML = `
    <div class="tl-scroll-shell">
      <section class="tl-stage" tabindex="0" aria-label="${esc(timeline.path)} timeline. Use up and down scrolling or left and right arrow keys.">
        <div class="tl-periods" role="group" aria-label="Timeline periods"></div>
        <div class="tl-scene">
          ${actor}
          <svg class="tl-route" viewBox="0 0 1600 650" preserveAspectRatio="none" aria-hidden="true">
            <path class="tl-route-shadow" d="M-80 460 C180 520 260 180 530 248 S820 565 1050 330 S1370 115 1680 240"/>
            <path class="tl-route-progress" pathLength="1" d="M-80 460 C180 520 260 180 530 248 S820 565 1050 330 S1370 115 1680 240"/>
          </svg>
          <div class="tl-event-layer"></div>
          <div class="tl-empty-period" hidden>No published events in this period.</div>
        </div>
        <div class="tl-controls">
          <button type="button" class="tl-prev" aria-label="Previous period">‹</button>
          <label class="tl-scrubber-wrap">
            <span class="tl-sr">Timeline period</span>
            <input class="tl-scrubber" type="range" min="0" max="${Math.max(0, timeline.periods.length - 1)}" step="1" value="0">
            <span class="tl-scrubber-labels" aria-hidden="true"></span>
          </label>
          <button type="button" class="tl-next" aria-label="Next period">›</button>
          <button type="button" class="tl-overview" aria-label="Open timeline overview"><span aria-hidden="true">⠿</span></button>
        </div>
      </section>
    </div>`;
  container.appendChild(desktop);
  return desktop;
}

function buildMobile(container, timeline, open, scrollRoot) {
  const mobile = document.createElement('div');
  mobile.className = 'tl-mobile';
  mobile.innerHTML = `
    <label class="tl-mobile-picker-label">Jump to a period
      <select class="tl-mobile-picker">${timeline.periods.map((period, index) =>
        `<option value="${index}">${esc(period.label)}</option>`).join('')}</select>
    </label>
    <div class="tl-mobile-route"></div>`;
  const route = mobile.querySelector('.tl-mobile-route');
  timeline.periods.forEach((period, periodIndex) => {
    const section = document.createElement('section');
    section.className = 'tl-mobile-period';
    section.dataset.periodIndex = periodIndex;
    section.id = `tl-${timeline.path}-${safeSlug(period.label) || 'period'}-${periodIndex}`;
    section.innerHTML = `<h2><span>${esc(period.label)}</span></h2><div class="tl-mobile-events"></div>`;
    const events = section.querySelector('.tl-mobile-events');
    if (!period.events.length) events.innerHTML = '<p class="tl-mobile-empty">No published events.</p>';
    period.events.forEach((event, index) => {
      const node = eventButton(event, index, periodIndex, true);
      node.querySelector('.tl-plus').addEventListener('click', e => open(event, period, e.currentTarget));
      events.appendChild(node);
    });
    route.appendChild(section);
  });
  const picker = mobile.querySelector('.tl-mobile-picker');
  picker.addEventListener('change', event => {
    route.children[Number(event.target.value)]?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
    });
  });
  container.appendChild(mobile);
  const observerRoot = scrollRoot && scrollRoot !== window && scrollRoot !== document.body && scrollRoot !== document.documentElement
    ? scrollRoot : null;
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (visible[0]) picker.value = visible[0].target.dataset.periodIndex;
  }, { root: observerRoot, rootMargin: '-8% 0px -55% 0px', threshold: [0, .1, .35, .6] }) : null;
  [...route.children].forEach(section => observer?.observe(section));
  return () => observer?.disconnect();
}

function rootMetrics(scrollRoot) {
  if (!scrollRoot || scrollRoot === window || scrollRoot === document.body || scrollRoot === document.documentElement) {
    return { top: 0, height: innerHeight, scrollTop: scrollY, root: window };
  }
  const rect = scrollRoot.getBoundingClientRect();
  return { top: rect.top, height: scrollRoot.clientHeight, scrollTop: scrollRoot.scrollTop, root: scrollRoot };
}

function setupController(container, timeline, scrollRoot, desktop) {
  const shell = desktop.querySelector('.tl-scroll-shell');
  const stage = desktop.querySelector('.tl-stage');
  const periodBar = desktop.querySelector('.tl-periods');
  const layer = desktop.querySelector('.tl-event-layer');
  const empty = desktop.querySelector('.tl-empty-period');
  const scrubber = desktop.querySelector('.tl-scrubber');
  const labels = desktop.querySelector('.tl-scrubber-labels');
  const route = desktop.querySelector('.tl-route-progress');
  const count = timeline.periods.length;
  const isScrollTimeline = timeline.path === 'personal';
  const SCROLL_OPEN_END = .18;
  const SCROLL_CLOSE_START = .78;
  let selected = -1;
  let frame = 0;
  let pointerStart = null;
  let journeyTravel = 0;

  function contentProgress(rawProgress) {
    if (!isScrollTimeline) return rawProgress;
    return clamp((rawProgress - SCROLL_OPEN_END) / (SCROLL_CLOSE_START - SCROLL_OPEN_END), 0, 1);
  }

  function rawProgressForContent(progress) {
    if (!isScrollTimeline) return progress;
    return SCROLL_OPEN_END + progress * (SCROLL_CLOSE_START - SCROLL_OPEN_END);
  }

  const pills = timeline.periods.map((period, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tl-period-pill';
    button.textContent = period.label;
    button.dataset.index = index;
    button.addEventListener('click', () => selectPeriod(index, true));
    periodBar.appendChild(button);
    return button;
  });
  labels.innerHTML = timeline.periods.map(period => `<span>${esc(period.label)}</span>`).join('');

  const routeTrack = desktop.querySelector('.tl-route');
  const themedJourney = container.id !== 'rec-timeline';
  const trackWidth = `${Math.max(1, count) * 100}%`;
  layer.style.width = trackWidth;
  routeTrack.style.width = '100%';
  routeTrack.style.left = '0';
  routeTrack.style.right = 'auto';

  function renderJourney() {
    layer.replaceChildren();
    timeline.periods.forEach((period, periodIndex) => {
      period.events.forEach((event, eventIndex) => {
        const node = eventButton(event, eventIndex, periodIndex);
        const recruiterBase = event.layout === 'feature' ? .47
          : event.layout === 'media-right' ? .58
            : event.layout === 'lower' ? .2 : .12;
        const narrativeBase = event.layout === 'feature' ? .5
          : event.layout === 'media-right' ? .65 : .3;
        const base = timeline.path === 'personal' ? .68
          : timeline.path === 'recruiter' ? recruiterBase : narrativeBase;
        const local = clamp(base + eventIndex * .17, .08, .76);
        node.style.setProperty('--event-x', `${((periodIndex + local) / Math.max(1, count)) * 100}%`);
        node.style.setProperty('--event-count', period.events.length);
        node.dataset.periodIndex = String(periodIndex);
        node.querySelector('.tl-plus').addEventListener('click', e => openEvent(container, event, period, e.currentTarget));
        layer.appendChild(node);
      });
    });
    requestAnimationFrame(() => layer.querySelectorAll('.tl-event').forEach(node => node.classList.add('is-visible')));
  }

  function setJourneyProgress(rawProgress) {
    const progress = contentProgress(rawProgress);
    const shift = count <= 1 ? 0 : progress * ((count - 1) / count) * 100;
    const transform = `translate3d(-${shift}%,0,0)`;
    layer.style.transform = transform;
    routeTrack.style.transform = 'none';
    if (themedJourney) {
      container.style.setProperty('--tl-progress', progress.toFixed(4));
      const actor = desktop.querySelector('.tl-path-actor');
      const curve = desktop.querySelector('.tl-route-shadow');
      const length = curve?.getTotalLength?.() || 0;
      const point = length ? curve.getPointAtLength(length * progress) : { x: 160 + progress * 1280, y: 360 };
      const nextPoint = length ? curve.getPointAtLength(Math.min(length, length * progress + 3)) : { x: point.x + 3, y: point.y };
      const left = clamp(point.x / 1600 * 100, 4, 96);
      const top = clamp(7 + point.y / 650 * 90, 12, 88);
      if (actor?.classList.contains('tl-sailing-ship')) {
        actor.style.left = `${left}%`; actor.style.top = `${top}%`;
        actor.style.setProperty('--ship-angle', `${Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x) * 180 / Math.PI}deg`);
      } else if (actor?.classList.contains('tl-orbiting-moon')) {
        actor.style.left = `${left}%`; actor.style.top = `${top}%`;
        actor.dataset.phase = progress < .42 ? 'waxing' : progress < .72 ? 'full' : 'afterglow';
        actor.style.setProperty('--moon-shadow', `${progress < .5 ? 100 - progress * 190 : (progress - .5) * -70}%`);
      } else if (isScrollTimeline) {
        const open = clamp(rawProgress / SCROLL_OPEN_END, 0, 1);
        const close = clamp((rawProgress - SCROLL_CLOSE_START) / (1 - SCROLL_CLOSE_START), 0, 1);
        const easedOpen = open * open * (3 - 2 * open);
        const easedClose = close * close * (3 - 2 * close);
        const left = 7 + 86 * easedClose;
        const right = 7 + 86 * easedOpen;
        container.style.setProperty('--scroll-left', `${left.toFixed(3)}%`);
        container.style.setProperty('--scroll-right', `${right.toFixed(3)}%`);
        container.style.setProperty('--scroll-progress', progress.toFixed(4));
        const leftRoller = desktop.querySelector('.tl-scroll-left');
        const rightRoller = desktop.querySelector('.tl-scroll-right');
        rightRoller?.classList.toggle('is-turning', rawProgress > 0.002 && rawProgress < SCROLL_OPEN_END - 0.002);
        leftRoller?.classList.toggle('is-turning', rawProgress > SCROLL_CLOSE_START + 0.002 && rawProgress < 0.998);
      }
    }
  }

  function setShellHeight() {
    const viewport = rootMetrics(scrollRoot).height;
    journeyTravel = Math.max(0, count - 1) * clamp(viewport * .74, 420, 720);
    const endLinger = count > 1 ? clamp(viewport * .38, 220, 360) : 0;
    shell.style.height = `${Math.max(620, viewport) + journeyTravel + endLinger}px`;
  }

  function scrollProgress() {
    const metrics = rootMetrics(scrollRoot);
    const rect = shell.getBoundingClientRect();
    return clamp((metrics.top - rect.top) / Math.max(1, journeyTravel), 0, 1);
  }

  function periodProgress(index) {
    return count <= 1 ? 0 : clamp(index, 0, count - 1) / (count - 1);
  }

  function scrollToPeriod(index, behavior) {
    if (mqMobile.matches) return;
    const metrics = rootMetrics(scrollRoot);
    const rect = shell.getBoundingClientRect();
    const start = metrics.scrollTop + rect.top - metrics.top;
    const target = start + rawProgressForContent(periodProgress(index)) * journeyTravel;
    metrics.root.scrollTo({
      top: target,
      behavior: behavior || (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'),
    });
  }

  function renderPeriod(index) {
    const period = timeline.periods[index];
    empty.hidden = period.events.length > 0;
    layer.querySelectorAll('.tl-event').forEach(node => {
      const active = Number(node.dataset.periodIndex) === index;
      node.classList.toggle('is-period-active', active);
      node.setAttribute('aria-hidden', String(!active));
      node.querySelector('.tl-plus').tabIndex = active ? 0 : -1;
    });
    stage.setAttribute('aria-label', `${timeline.path} timeline, ${period.label}, ${period.events.length} events. Use arrow keys to change period.`);
  }

  function selectPeriod(index, shouldScroll = false) {
    index = clamp(index, 0, Math.max(0, count - 1));
    if (shouldScroll) scrollToPeriod(index);
    if (index === selected) return;
    selected = index;
    scrubber.value = index;
    desktop.querySelector('.tl-prev').disabled = index === 0;
    desktop.querySelector('.tl-next').disabled = index === count - 1;
    pills.forEach((pill, pillIndex) => {
      const active = pillIndex === index;
      pill.classList.toggle('is-selected', active);
      pill.classList.toggle('is-adjacent', Math.abs(pillIndex - index) === 1);
      pill.setAttribute('aria-pressed', String(active));
      pill.tabIndex = active ? 0 : -1;
    });
    const activePill = pills[index];
    if (activePill) {
      /* Only center the year inside its horizontal rail. scrollIntoView also
         moves the outer vertical storyteller in some browsers, which can
         silently jump a deep-linked period back to the first scene. */
      const left = activePill.offsetLeft - (periodBar.clientWidth - activePill.offsetWidth) / 2;
      periodBar.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    }
    renderPeriod(index);
  }

  function alignPeriod(index) {
    index = clamp(index, 0, Math.max(0, count - 1));
    selectPeriod(index);
    if (mqMobile.matches) return;
    setShellHeight();
    route.style.strokeDashoffset = String(1 - periodProgress(index));
    setJourneyProgress(rawProgressForContent(periodProgress(index)));
    scrollToPeriod(index, 'auto');
  }

  function syncFromScroll() {
    frame = 0;
    if (mqMobile.matches || !count) return;
    const progress = scrollProgress();
    const journeyProgress = contentProgress(progress);
    route.style.strokeDashoffset = String(1 - journeyProgress);
    setJourneyProgress(progress);
    selectPeriod(Math.round(journeyProgress * Math.max(0, count - 1)));
  }
  function onScroll() {
    if (!frame) frame = requestAnimationFrame(syncFromScroll);
  }

  scrubber.addEventListener('input', event => selectPeriod(Number(event.target.value), true));
  desktop.querySelector('.tl-prev').addEventListener('click', () => selectPeriod(selected - 1, true));
  desktop.querySelector('.tl-next').addEventListener('click', () => selectPeriod(selected + 1, true));
  desktop.querySelector('.tl-overview').addEventListener('click', event =>
    openOverview(container, timeline, selectPeriod, event.currentTarget));
  stage.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault(); selectPeriod(selected - 1, true);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault(); selectPeriod(selected + 1, true);
    } else if (event.key === 'Home') {
      event.preventDefault(); selectPeriod(0, true);
    } else if (event.key === 'End') {
      event.preventDefault(); selectPeriod(count - 1, true);
    }
  });
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || event.target.closest('button,input,a,select')) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture?.(event.pointerId);
  });
  stage.addEventListener('pointerup', event => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) selectPeriod(selected + (dx < 0 ? 1 : -1), true);
  });
  stage.addEventListener('pointercancel', () => { pointerStart = null; });

  function onPopState() {
    const requested = safeSlug(new URL(location.href).searchParams.get('event'));
    const dialog = container.querySelector('.tl-dialog');
    if (!requested) {
      if (dialog?.open) {
        dialog._skipHistorySync = true;
        dialog.close();
      }
      return;
    }
    for (let periodIndex = 0; periodIndex < timeline.periods.length; periodIndex += 1) {
      const event = timeline.periods[periodIndex].events.find(item => item.slug === requested);
      if (!event) continue;
      alignPeriod(periodIndex);
      if (!dialog?.open || dialog.dataset.eventSlug !== event.slug) {
        if (dialog?.open) {
          dialog._skipHistorySync = true;
          dialog.close();
        }
        const mobileOpener = container.querySelector(`.tl-mobile [data-event="${requested}"] .tl-plus`);
        if (mqMobile.matches) mobileOpener?.closest('.tl-mobile-period')?.scrollIntoView({ block: 'start' });
        openEvent(container, event, timeline.periods[periodIndex], mqMobile.matches ? mobileOpener || stage : stage, false);
        /* Opening a top-layer dialog may cause Chromium to restore the
           previously focused scroller position. Re-align after focus settles
           so a deep-linked period remains the selected illustrated scene. */
        requestAnimationFrame(() => alignPeriod(periodIndex));
      }
      break;
    }
  }

  const scrollTarget = rootMetrics(scrollRoot).root;
  scrollTarget.addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', setShellHeight, { passive: true });
  addEventListener('popstate', onPopState);
  mqMobile.addEventListener?.('change', onScroll);
  setShellHeight();
  renderJourney();
  selectPeriod(0);
  setJourneyProgress(0);
  syncFromScroll();

  return {
    selectPeriod,
    alignPeriod,
    destroy() {
      scrollTarget.removeEventListener('scroll', onScroll);
      removeEventListener('resize', setShellHeight);
      removeEventListener('popstate', onPopState);
      mqMobile.removeEventListener?.('change', onScroll);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}


export async function renderTimeline(container, path, scrollRoot, fallbackTimeline = null) {
  if (!container) return 0;
  controllers.get(container)?.destroy?.();
  container.classList.add('tline');
  container.dataset.timelinePath = path;
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = '<div class="tl-loading" role="status">Loading the timeline…</div>';

  let timeline = await loadTimeline(path);
  const usesFallback = !timeline.periods.length && fallbackTimeline;
  if (usesFallback) timeline = normalizeTimeline(fallbackTimeline, path);
  container.timelineData = timeline;
  container.dataset.timelineSample = String(Boolean(usesFallback));
  container.innerHTML = '';
  container.setAttribute('aria-busy', 'false');
  if (!timeline.periods.length) {
    container.innerHTML = '<div class="tl-empty" role="status">This timeline is being written.</div>';
    return 0;
  }

  const desktop = buildDesktop(container, timeline);
  const destroyMobile = buildMobile(container, timeline,
    (event, period, opener) => openEvent(container, event, period, opener), scrollRoot);
  const controller = setupController(container, timeline, scrollRoot, desktop);
  const destroyDesktop = controller.destroy.bind(controller);
  controller.destroy = () => { destroyDesktop(); destroyMobile(); };
  controllers.set(container, controller);

  const requested = safeSlug(new URL(location.href).searchParams.get('event'));
  if (requested) {
    for (let periodIndex = 0; periodIndex < timeline.periods.length; periodIndex += 1) {
      const event = timeline.periods[periodIndex].events.find(item => item.slug === requested);
      if (event) {
        controller.alignPeriod(periodIndex);
        requestAnimationFrame(() => {
          const mobileOpener = container.querySelector(`.tl-mobile [data-event="${requested}"] .tl-plus`);
          if (mqMobile.matches) mobileOpener?.closest('.tl-mobile-period')?.scrollIntoView({ block: 'start' });
          openEvent(container, event, timeline.periods[periodIndex],
            mqMobile.matches ? mobileOpener || desktop.querySelector('.tl-stage') : desktop.querySelector('.tl-stage'), false);
          requestAnimationFrame(() => controller.alignPeriod(periodIndex));
        });
        break;
      }
    }
  }
  return timeline.periods.reduce((total, period) => total + period.events.length, 0);
}
