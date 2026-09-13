/* Closed, two-storey cloud arena. Geometry and safety limits share dimensions. */
import * as THREE from 'three';

export const CLOUD_SPACE = { radiusX: 36, radiusZ: 52, terraceY: 14, thickness: 1.2, holeRadius: 8 };
export function lowerFloorAt(x, z) {
  const radial = Math.min(1, Math.hypot(x / 36, z / 52));
  return .5 + 21.5 * (1 - Math.sqrt(1 - radial * radial)) ** 5;
}
export function upperCeilingAt(x, z) {
  return 22 + 20 * Math.sqrt(Math.max(0, 1 - (x / 36) ** 2 - (z / 52) ** 2));
}
export function inPassage(x, z, padding = 0) {
  return Math.hypot(x, z) < CLOUD_SPACE.holeRadius - padding;
}
export function constrainCloudPoint(point, headroom = 1.8) {
  const radius = Math.hypot(point.x / 35, point.z / 51);
  if (radius > 1) { point.x /= radius; point.z /= radius; }
  point.y = THREE.MathUtils.clamp(point.y, lowerFloorAt(point.x, point.z) + .12, upperCeilingAt(point.x, point.z) - headroom - 1.1);
  return point;
}
const ripple = (x, z) => Math.sin(x * .43) * Math.cos(z * .36) + .5 * Math.sin(x * .21 + z * .52);

export function createCloudGeometry() {
  // A welded sphere is the enclosure: no imported seams or missing triangles.
  const shell = new THREE.SphereGeometry(1, 96, 64);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const x = ux * 36, z = uz * 52;
    const y = uy >= 0 ? 22 + uy * 20 + ripple(x, z) * .45 * uy : .5 + 21.5 * (1 + uy) ** 5 + ripple(x, z) * .035 * -uy;
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
        const x = c * THREE.MathUtils.lerp(8, 36.3, t), z = s * THREE.MathUtils.lerp(8, 52.3, t);
        positions.push(x, 14 - side * 1.2 + ripple(x, z) * .065 * Math.sin(Math.PI * t), z);
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
