/* Scroll/library path. The timeline scroll itself supplies the opening and
   closing motion; there is no separate overture. */
import { renderTimeline } from '../timeline.js';
import { mountBlog } from '../blog.js';
import { mountMessageBox, renderWall } from '../messages.js';
import { setCursorPath } from '../cursor.js';

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
const SESSION_COMPLETE = 'scroll_library_opened_v1';
const SAMPLE_TIMELINE = {
  periods: [
    { label: 'Milestones', events: [{ slug: 'sample-first-pages', category: 'Reading', title: 'A book changed the direction', summary: 'The first book, essay, or idea that materially changed the work.', details_md: 'Add the title, when you found it, and what changed afterward.', layout: 'upper', accent: 'gold' }] },
    { label: 'Field work', events: [{ slug: 'sample-in-practice', category: 'Fun project', title: 'An idea escaped the notebook', summary: 'A small experiment made for curiosity before usefulness.', details_md: 'Add the source, the experiment, and the surprising result.', layout: 'feature', accent: 'teal' }] },
    { label: 'Reading now', events: [{ slug: 'sample-on-desk', category: 'Open question', title: 'What is on the desk', summary: 'Current reading, unfinished notes, and questions still being tested.', details_md: 'Add one book, one question, and one current experiment.', layout: 'lower', accent: 'violet' }] },
  ],
};

let contentInited = false;
let openingTimer = 0;

function openingComplete() {
  try { return sessionStorage.getItem(SESSION_COMPLETE) === '1'; } catch { return false; }
}

function rememberOpening() {
  try { sessionStorage.setItem(SESSION_COMPLETE, '1'); } catch { /* storage unavailable */ }
}

function showLibrary() {
  clearTimeout(openingTimer);
  const opening = document.getElementById('pers-scroll-opening');
  const wrap = document.getElementById('pers-wrap');
  if (opening) {
    opening.classList.remove('show');
    opening.hidden = true;
    opening.inert = true;
    opening.setAttribute('aria-hidden', 'true');
  }
  wrap?.classList.remove('scroll-waiting');
  rememberOpening();
  if (!contentInited) {
    contentInited = true;
    renderTimeline(document.getElementById('pers-timeline'), 'personal', wrap, SAMPLE_TIMELINE);
    renderLibraryShelves();
    mountBlog(document.getElementById('pers-blog'));
    mountMessageBox(document.getElementById('pers-msgbox'), 'personal');
  }
  renderWall(document.getElementById('pers-wall'), { compact: true });
}

function renderLibraryShelves() {
  const shelf = document.getElementById('pers-reading-shelf');
  const projects = document.getElementById('pers-projects');
  if (shelf) shelf.innerHTML = [
    ['Currently reading', 'Book Title', 'One sentence on the question this book is helping answer.'],
    ['Returned to often', 'Essay or Reference', 'Why this source remains useful after the first reading.'],
    ['Margin note', 'A Small Idea', 'A short connection between the page and work in progress.'],
  ].map(([eyebrow, title, copy]) => `<article><small>${eyebrow}</small><strong>${title}</strong><p>${copy}</p></article>`).join('');
  if (projects) projects.innerHTML = [
    ['Weekend build', 'Tiny Instrument', 'A playful prototype, what it tested, and what survived.'],
    ['Reading experiment', 'Annotated Map', 'A visual index connecting notes, places, and sources.'],
    ['In progress', 'Unfinished Thing', 'A candid project note with the next question still open.'],
  ].map(([eyebrow, title, copy]) => `<article><small>${eyebrow}</small><strong>${title}</strong><p>${copy}</p></article>`).join('');
}

function startOpening() {
  const opening = document.getElementById('pers-scroll-opening');
  const wrap = document.getElementById('pers-wrap');
  if (!opening) { showLibrary(); return; }
  opening.hidden = false;
  opening.inert = false;
  opening.setAttribute('aria-hidden', 'false');
  wrap?.classList.add('scroll-waiting');
  requestAnimationFrame(() => opening.classList.add('show'));
  openingTimer = setTimeout(showLibrary, 4300);
}

export function initPersonalPath() {
  setCursorPath('personal');
  showLibrary();
}
