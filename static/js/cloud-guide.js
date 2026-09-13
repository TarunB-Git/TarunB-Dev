/* Level-aware map and an optional world-space navigation arrow. */
import * as THREE from 'three';
const ICONS = { viewer: '⛵', personal: '▤', recruiter: '⌁', friend: '☾' };
const COLORS = { viewer: '#ecc68e', personal: '#f2dfb3', recruiter: '#eed77a', friend: '#cad9f5' };

export function createCloudGuide(root, scene) {
  const panel = document.createElement('aside');
  panel.id = 'cloud-guide';
  panel.setAttribute('aria-label', 'Current floor map');
  panel.innerHTML = '<canvas width="180" height="220" aria-label="Current floor, landmarks and your position"></canvas><button type="button" aria-label="Switch between map and 3D direction arrow">↗</button>';
  root.append(panel);
  const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
  const button = panel.querySelector('button');
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 2.8, 0xeed4a1, .85, .65);
  arrow.visible = false;
  scene.add(arrow);
  let mode = 'map';
  try { mode = localStorage.getItem('cloud_navigation') === 'directions' ? 'directions' : 'map'; } catch {}
  const sync = () => {
    canvas.hidden = mode !== 'map';
    button.textContent = mode === 'map' ? '↗' : '◉';
    button.title = mode === 'map' ? 'Show 3D arrow' : 'Show minimap';
  };
  button.onclick = () => {
    mode = mode === 'map' ? 'directions' : 'map';
    try { localStorage.setItem('cloud_navigation', mode); } catch {}
    sync();
  };
  sync();
  const mapPoint = p => ({ x: 90 + p.x * 2.1, y: 110 + p.z * 1.85 });
  let upperLevel = false;
  return {
    update({ player, yaw, landmarks, passage, terrace }) {
      // Hysteresis keeps the map stable while crossing the opening.
      if (player.y > terrace + .4) upperLevel = true;
      else if (player.y < terrace - 2) upperLevel = false;
      const available = [...landmarks.values()].filter(r => !r.visited && (r.id !== 'friend' || !r.locked));
      const sameLevel = available.filter(r => (r.object.position.y >= terrace) === upperLevel);
      let target = sameLevel.sort((a, b) => a.object.position.distanceToSquared(player) - b.object.position.distanceToSquared(player))[0]?.object.position;
      if (!target && available.length) target = new THREE.Vector3(passage.x, upperLevel ? terrace - 5 : terrace + 3, passage.z);
      arrow.visible = mode === 'directions' && Boolean(target);
      if (arrow.visible) {
        arrow.position.copy(player).add(new THREE.Vector3(0, 2.6, 0));
        arrow.setDirection(new THREE.Vector3().subVectors(target, arrow.position).normalize());
      }
      if (mode !== 'map' || !ctx) return;
      ctx.clearRect(0, 0, 180, 220);
      ctx.fillStyle = upperLevel ? '#535166e8' : '#303044e8';
      ctx.strokeStyle = '#c5bdce88'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(90, 110, 36 * 2.1, 52 * 1.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const hole = mapPoint(passage);
      ctx.fillStyle = '#171825'; ctx.strokeStyle = '#eee0bd';
      ctx.beginPath(); ctx.ellipse(hole.x, hole.y, 8 * 2.1, 8 * 1.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [id, r] of landmarks) {
        if ((r.object.position.y >= terrace) !== upperLevel) continue;
        const p = mapPoint(r.object.position);
        ctx.globalAlpha = r.visited ? .4 : 1;
        ctx.fillStyle = COLORS[id]; ctx.fillText(ICONS[id], p.x, p.y);
      }
      ctx.globalAlpha = 1;
      const p = mapPoint(player);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-yaw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#181822'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(0, 2); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      panel.setAttribute('aria-label', upperLevel ? 'Upper cloud floor map' : 'Lower cloud floor map');
    },
  };
}
