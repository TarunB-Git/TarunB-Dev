/* Cloud navigation is a view of live world state, never a separate map of it. */
const LABELS = { viewer: 'Ship · About', personal: 'Scroll · Library', recruiter: 'Birds · Work', friend: 'Moon · Friends', passage: 'Central passage' };
const COLORS = { viewer: '#e8bb8e', personal: '#f2d7a2', recruiter: '#e4cf70', friend: '#b9cff4' };

export function createCloudGuide(root, { onRead }) {
  const panel = document.createElement('aside');
  panel.id = 'cloud-guide'; panel.setAttribute('aria-label', 'Cloud navigation');
  panel.innerHTML = `<header><strong>Cloud atlas</strong><button type="button" class="guide-toggle">Use directions</button></header>
    <canvas width="260" height="250" aria-label="Map: player, central passage, ship, scroll, birds and moon"></canvas>
    <div class="guide-direction" hidden><span aria-hidden="true">↑</span><p></p></div>
    <label>Head towards <select aria-label="Navigation destination">${Object.entries(LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
    <p class="guide-level"></p><p class="guide-hint">Rise through the central opening to reach the ship terrace. Return through the same opening.</p>`;
  root.append(panel);
  const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
  const toggle = panel.querySelector('button'), direction = panel.querySelector('.guide-direction');
  const select = panel.querySelector('select'); select.value = 'passage';
  let mode = 'map';
  try { mode = localStorage.getItem('cloud_navigation') || 'map'; } catch { /* optional */ }
  const renderMode = () => { canvas.hidden = mode !== 'map'; direction.hidden = mode === 'map'; toggle.textContent = mode === 'map' ? 'Use directions' : 'Show map'; };
  toggle.onclick = () => { mode = mode === 'map' ? 'directions' : 'map'; renderMode(); try { localStorage.setItem('cloud_navigation', mode); } catch { /* optional */ } };
  renderMode();
  const board = document.createElement('aside'); board.id = 'cloud-board'; board.hidden = true;
  board.innerHTML = '<strong>From the reading terrace</strong><div></div><button type="button">Open the library</button>';
  board.querySelector('button').onclick = onRead; root.append(board);
  let lastPosts = null;
  const mapPoint = p => ({ x: 130 + p.x * 3.5, y: 126 + p.z * 2.1 });
  return {
    update({ player, yaw, landmarks, passage, terrace, moonState, posts, near, board: boardPosition }) {
      const onTerrace = player.y > terrace - 1;
      panel.querySelector('.guide-level').textContent = onTerrace ? 'Upper level · ship terrace' : 'Lower level · cloud hollow';
      const nearPassage = Math.hypot(player.x - passage.x, player.z - passage.z) < passage.radius + 3;
      panel.querySelector('.guide-hint').textContent = nearPassage
        ? (onTerrace ? 'Opening below: hold Shift / Drop to descend through it.' : 'Opening above: hold Space / Rise to reach the ship terrace.')
        : (onTerrace ? 'To return below, find the central opening marked ○.' : 'The ship and scroll are upstairs. Follow ○ to the opening, then rise.');
      const targetId = select.value;
      const target = targetId === 'passage' ? { x: passage.x, y: terrace, z: passage.z } : landmarks.get(targetId)?.object.position;
      if (target) {
        const dx = target.x - player.x, dz = target.z - player.z;
        const bearing = Math.atan2(-dx, -dz) - yaw;
        direction.querySelector('span').style.transform = `rotate(${-bearing}rad)`;
        direction.querySelector('p').textContent = `${LABELS[targetId]} · ${Math.round(Math.hypot(dx, dz))} m${target.y > player.y + 3 ? ' · above you' : target.y < player.y - 3 ? ' · below you' : ''}`;
      }
      if (mode === 'map' && ctx) {
        ctx.clearRect(0, 0, 260, 250);
        ctx.fillStyle = '#222439'; ctx.strokeStyle = '#77748b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(130, 126, 108, 112, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#aaa0a144';
        for (const r of [35, 67]) { ctx.beginPath(); ctx.ellipse(130, 116, r, r * 1.15, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.font = '11px sans-serif'; ctx.fillStyle = '#d9d2de'; ctx.textAlign = 'center'; ctx.fillText('N', 130, 11);
        const hole = mapPoint(passage); ctx.strokeStyle = '#f2e4bd'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.ellipse(hole.x, hole.y, 23, 15, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText('passage', hole.x, hole.y + 28);
        landmarks.forEach((record, id) => {
          const p = mapPoint(record.object.position);
          ctx.fillStyle = COLORS[id]; ctx.strokeStyle = COLORS[id]; ctx.lineWidth = select.value === id ? 3 : 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, record.visited ? 4 : 5.5, 0, Math.PI * 2);
          if (id === 'friend' && moonState === 'locked') ctx.stroke(); else ctx.fill();
          ctx.font = '11px sans-serif'; ctx.fillText(record.label, Math.max(25, Math.min(230, p.x)), p.y - 10);
        });
        const p = mapPoint(player); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-yaw);
        ctx.fillStyle = '#fff7e7'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      board.hidden = !boardPosition || Math.hypot(player.x - boardPosition.x, player.y - boardPosition.y, player.z - boardPosition.z) > 9;
      board.querySelector('button').disabled = near !== 'personal';
      board.querySelector('button').textContent = near === 'personal' ? 'Open the library' : 'Approach the scroll to read';
      if (posts !== lastPosts) {
        lastPosts = posts;
        const list = board.querySelector('div'); list.replaceChildren();
        for (const post of posts) { const article = document.createElement('p'); article.textContent = post.title; list.append(article); }
        if (!posts.length) list.textContent = 'New writing will appear here when published.';
      }
    },
  };
}
