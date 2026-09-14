/* One quest-style 3D compass; no minimap or destination selector. */
import * as THREE from 'three';
const NAMES = { viewer: 'The ship', personal: 'The scroll', recruiter: 'The birds', friend: 'The moon' };
export function createCloudGuide(root) {
  const panel = document.createElement('aside');
  panel.id = 'cloud-guide';
  panel.innerHTML = '<div class="guide-arrow" aria-hidden="true"></div><div><strong></strong><p></p></div>';
  panel.setAttribute('aria-label', 'Next destination');
  root.append(panel);
  const hud = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 20);
  camera.position.set(0, 0, 7.2);
  hud.add(new THREE.HemisphereLight(0xffefbe, 0x67431a, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-2, 3, 5); hud.add(light);
  const arrow = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xf0b52d, metalness: .35, roughness: .28 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x6f4715, metalness: .22, roughness: .52 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.16, .21, 1.55, 8), material);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.68, 1.0, 5), material);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(.24, .075, 6, 12), edge);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.38, .5, 4), edge);
  shaft.position.y = -.22;
  tip.position.y = 1.05;
  collar.position.y = .53; collar.rotation.x = Math.PI / 2;
  tail.position.y = -1.06; tail.rotation.z = Math.PI;
  arrow.add(shaft, tip, collar, tail);
  arrow.rotation.z = -.08;
  hud.add(arrow);
  let visible = false;
  return {
    update({ player, yaw, landmarks, passage, terrace, near }) {
      const level = player.y >= terrace ? 'upper' : 'lower';
      const record = [...landmarks.values()]
        .filter(item => !item.visited && item.level === level && (item.id !== 'friend' || !item.locked))
        .sort((a, b) => a.object.position.distanceToSquared(player) - b.object.position.distanceToSquared(player))[0];
      // Once the current floor is complete, the route between floors is the
      // next destination even when every landmark in the world is complete.
      const target = record?.object.position || new THREE.Vector3(
        passage.x,
        level === 'upper' ? terrace - 3 : terrace + 3,
        passage.z,
      );
      visible = true; panel.hidden = false;

      const delta = new THREE.Vector3().subVectors(target, player);
      const cameraRight = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const cameraForward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      // HUD X/Y carry the camera-relative ground direction while HUD Z carries
      // the real elevation. This rotates the 3D mesh toward the full spatial
      // target instead of applying a flat compass bearing with a cosmetic tilt.
      const direction = new THREE.Vector3(
        delta.dot(cameraRight),
        delta.dot(cameraForward),
        delta.y,
      ).normalize();
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      panel.querySelector('strong').textContent = record ? NAMES[record.id] : 'Central opening';
      panel.querySelector('p').textContent = record
        ? (near === record.id ? 'Use to enter' : `${Math.round(target.distanceTo(player))} m · approach`)
        : (level === 'upper' ? 'Drop through to the lower cloud' : 'Fly through to the upper cloud');
    },
    render(renderer) {
      if (!visible) return;
      const rect = panel.querySelector('.guide-arrow').getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      const viewport = new THREE.Vector4(); renderer.getViewport(viewport);
      const oldAuto = renderer.autoClear;
      renderer.autoClear = false; renderer.clearDepth();
      renderer.setViewport(rect.left, innerHeight - rect.bottom, rect.width, rect.height);
      renderer.render(hud, camera);
      renderer.setViewport(viewport); renderer.autoClear = oldAuto;
    },
  };
}
