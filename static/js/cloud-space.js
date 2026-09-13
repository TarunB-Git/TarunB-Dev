/* Closed, two-storey cloud arena. Geometry and safety limits share dimensions. */
import * as THREE from 'three';

export const CLOUD_SPACE = { radiusX: 48, radiusZ: 68, terraceY: 26, thickness: 2.4, holeRadius: 8 };
export function lowerFloorAt(x, z) {
  const radial = Math.min(1, Math.hypot(x / 48, z / 68));
  const vertical = Math.sqrt(1 - radial * radial);
  return .5 + 33.5 * (1 - vertical) ** 5 + relief(x, z) * 1.45 * vertical;
}
export function upperCeilingAt(x, z) {
  return 34 + 36 * Math.sqrt(Math.max(0, 1 - (x / 48) ** 2 - (z / 68) ** 2)) - relief(x, z) * 3;
}
export function inPassage(x, z, padding = 0) {
  return Math.hypot(x, z) < CLOUD_SPACE.holeRadius - padding;
}
export function constrainCloudPoint(point, headroom = 1.8) {
  const radius = Math.hypot(point.x / 47, point.z / 67);
  if (radius > 1) { point.x /= radius; point.z /= radius; }
  point.y = THREE.MathUtils.clamp(point.y, lowerFloorAt(point.x, point.z) + .12, upperCeilingAt(point.x, point.z) - headroom - 1.1);
  return point;
}
let authoredRelief = null;
const relief = (x, z) => authoredRelief ? authoredRelief(x, z) : .5 + ripple(x, z) * .22;
export function setCloudRelief(sample) { authoredRelief = sample; }
export function terraceHeightAt(x, z) { return CLOUD_SPACE.terraceY + relief(x, z) * 1.25; }
const ripple = (x, z) => Math.sin(x * .43) * Math.cos(z * .36) + .5 * Math.sin(x * .21 + z * .52);

export function createCloudGeometry() {
  // A welded sphere is the enclosure: no imported seams or missing triangles.
  const shell = new THREE.SphereGeometry(1, 88, 56);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const x = ux * 48, z = uz * 68;
    const y = uy >= 0 ? 34 + uy * 36 - relief(x, z) * 3 * uy : .5 + 33.5 * (1 + uy) ** 5 + relief(x, z) * 1.45 * -uy;
    p.setXYZ(i, x, y, z);
  }
  shell.computeVertexNormals(); shell.computeBoundingSphere();

  // A complete annular floor, with top, underside and a closed opening rim.
  const positions = [], uvs = [], indices = [];
  const segments = 128, rings = 28;
  for (let side = 0; side < 2; side++) {
    for (let ring = 0; ring <= rings; ring++) {
      const t = ring / rings;
      for (let j = 0; j <= segments; j++) {
        const a = j / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const x = c * THREE.MathUtils.lerp(8, 48.3, t), z = s * THREE.MathUtils.lerp(8, 68.3, t);
        positions.push(x, terraceHeightAt(x, z) - side * CLOUD_SPACE.thickness, z);
        uvs.push(x / 18, z / 18);
      }
    }
  }
  const stride = segments + 1, layer = (rings + 1) * stride;
  for (let side = 0; side < 2; side++) for (let ring = 0; ring < rings; ring++) for (let j = 0; j < segments; j++) {
    const a = side * layer + ring * stride + j, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  for (const ring of [0, rings]) for (let j = 0; j < segments; j++) {
    const a = ring * stride + j, b = a + 1;
    indices.push(a, b, a + layer, b, b + layer, a + layer);
  }
  const terrace = new THREE.BufferGeometry();
  terrace.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  terrace.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  terrace.setIndex(indices); terrace.computeVertexNormals(); terrace.computeBoundingSphere();
  return { shell, terrace };
}
