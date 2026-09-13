/* Viewer path — "who this person is", told as a timeline, plus tagged writings
   and a message box. Violet Ancient Scroll framing kept from v7. */
import { renderTimeline } from '../timeline.js';
import { mountTaggedPosts } from '../blog.js';
import { setCursorPath } from '../cursor.js';

let inited = false;

const SAMPLE_TIMELINE = {
  periods: [
    { label: 'Identity', events: [{ slug: 'sample-identity', category: 'Origins', title: 'Where the voyage began', summary: 'The place, curiosity, or problem that first pulled you toward this work.', details_md: 'Replace this with two or three concrete details that reveal how you think, not only where you studied.', layout: 'upper', accent: 'violet' }] },
    { label: 'Values', events: [{ slug: 'sample-values', category: 'Compass', title: 'The standards that steer the work', summary: 'The principles behind the decisions: clarity, care, usefulness, and honest craft.', details_md: 'Name the values you use when the right decision is not obvious.', layout: 'feature', accent: 'gold' }] },
    { label: 'Interests', events: [{ slug: 'sample-interests', category: 'Curiosity', title: 'Questions worth following', summary: 'The subjects, tools, and side paths that keep the work alive.', details_md: 'Use this for interests that reveal range and connect naturally to your projects.', layout: 'media-right', accent: 'blue' }] },
    { label: 'Turning points', events: [{ slug: 'sample-turning-point', category: 'Change', title: 'The moment the course shifted', summary: 'A choice, failure, encounter, or success that changed how you work.', details_md: 'Tell one specific turning point and what became different afterward.', layout: 'lower', accent: 'teal' }] },
  ],
};

export function initViewerPath() {
  setCursorPath('viewer');
  if (inited) return;
  inited = true;
  renderTimeline(document.getElementById('view-timeline'), 'viewer',
    document.getElementById('view-wrap'), SAMPLE_TIMELINE);
  mountTaggedPosts(document.getElementById('view-posts'), 'viewer');
}
