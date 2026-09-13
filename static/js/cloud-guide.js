/* One quest-style 3D compass; no minimap or destination selector. */
import * as THREE from 'three';
const NAMES = { viewer: 'The ship', personal: 'The scroll', recruiter: 'The birds', friend: 'The fallen moon' };
export function createCloudGuide(root) {
  const panel = document.createElement('aside');
  panel.id = 'cloud-guide';
  panel.innerHTML = '<div class="guide-arrow" aria-hidden="true"></div><div><strong></strong><p></p></div>';
  panel.setAttribute('aria-label', 'Next destination');
  root.append(panel);
  const hud = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 20);
  camera.position.set(0, 0, 7);
  hud.add(new THREE.HemisphereLight(0xffefbe, 0x67431a, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-2, 3, 5); hud.add(light);
  const arrow = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xf0b52d, metalness: .35, roughness: .28 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, 1.45, 6), material);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.7, .9, 4), material);
  shaft.position.y = -.25; tip.position.y = .92; arrow.add(shaft, tip); hud.add(arrow);
  let visible = false;
  return {
    update({ player, yaw, landmarks, passage, terrace, near }) {
      const above = player.y > terrace - 1;
      const candidates = [...landmarks.values()].filter(r => !r.visited && (r.id !== 'friend' || !r.locked));
      const sameLevel = candidates.filter(r => (r.object.position.y >= terrace) === above);
      let record = sameLevel.sort((a, b) => a.object.position.distanceToSquared(player) - b.object.position.distanceToSquared(player))[0];
      let crossing = false;
      if (!record && candidates.length) crossing = true;
      // Keep the compass useful after the collection is complete instead of
      // disappearing on desktop: point to the nearest unlocked landmark.
      if (!record && !candidates.length) {
        record = [...landmarks.values()]
          .filter(item => !item.locked && ((item.object.position.y >= terrace) === above))
          .sort((a, b) => a.object.position.distanceToSquared(player) - b.object.position.distanceToSquared(player))[0];
      }
      const target = record?.object.position || (crossing ? new THREE.Vector3(passage.x, above ? 3 : terrace + 3, passage.z) : null);
      visible = Boolean(target); panel.hidden = !visible;
      if (!target) return;
      const dx = target.x - player.x, dz = target.z - player.z;
      const bearing = Math.atan2(-dx, -dz) - yaw;
      const direction = new THREE.Vector3(-Math.sin(bearing), Math.cos(bearing), THREE.MathUtils.clamp((target.y - player.y) / 20, -.7, .7)).normalize();
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      panel.querySelector('strong').textContent = record ? NAMES[record.id] : 'Central opening';
      panel.querySelector('p').textContent = record
        ? (near === record.id ? 'Use to enter' : `${Math.round(target.distanceTo(player))} m · approach`)
        : (above ? 'Drop through to the lower cloud' : 'Fly through to the upper cloud');
    },
    render(renderer) {
      if (!visible) return;
      const rect = panel.querySelector('.guide-arrow').getBoundingClientRect();
      const viewport = new THREE.Vector4(); renderer.getViewport(viewport);
      const oldAuto = renderer.autoClear;
      renderer.autoClear = false; renderer.clearDepth();
      renderer.setViewport(rect.left, innerHeight - rect.bottom, rect.width, rect.height);
      renderer.render(hud, camera);
      renderer.setViewport(viewport); renderer.autoClear = oldAuto;
    },
  };
}
