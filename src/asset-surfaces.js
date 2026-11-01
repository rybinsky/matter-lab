import { assetParts } from './catalog.js';

// Render-only skins share the asset's local coordinates. They never replace
// assetParts, mass distribution or the compound colliders used by LabWorld.
const surfaces = new Map();

function ellipsoidBounds(parts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const [x, y, z] = part.r || [0, 0, 0], a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
    const rows = [[c * e, -c * f, d], [b * d * e + a * f, -b * d * f + a * e, -b * c], [-a * d * e + b * f, a * d * f + b * e, a * c]];
    for (let axis = 0; axis < 3; axis++) {
      const radius = Math.hypot(...rows[axis].map((v, i) => v * part.d[i]));
      lo[axis] = Math.min(lo[axis], part.p[axis] - radius);
      hi[axis] = Math.max(hi[axis], part.p[axis] + radius);
    }
  }
  return { lo, hi };
}

function bananaSurface() {
  const parts = assetParts('banana'), body = parts.slice(0, 9), bounds = ellipsoidBounds(body);
  const positions = [], indices = [], sections = 32, ring = 12;
  const centre = t => { const angle = -1.40 + 2.80 * t; return [.49 * Math.sin(angle), .20 - .49 * Math.cos(angle), angle]; };
  const start = centre(0), end = centre(1);
  positions.push(start[0], start[1], 0);
  for (let i = 1; i < sections; i++) {
    const t = i / sections, [x, y, angle] = centre(t);
    const taper = Math.sin(Math.PI * t) ** .52;
    for (let j = 0; j < ring; j++) {
      const around = j / ring * Math.PI * 2;
      const radial = Math.cos(around) * .108 * taper;
      positions.push(x + Math.sin(angle) * radial, y - Math.cos(angle) * radial, Math.sin(around) * .111 * taper);
    }
  }
  const last = positions.length / 3; positions.push(end[0], end[1], 0);
  for (let j = 0; j < ring; j++) indices.push(0, 1 + j, 1 + (j + 1) % ring);
  for (let i = 0; i < sections - 2; i++) for (let j = 0; j < ring; j++) {
    const a = 1 + i * ring + j, b = 1 + i * ring + (j + 1) % ring, c = a + ring, d = b + ring;
    indices.push(a, c, b, b, c, d);
  }
  const lastRing = 1 + (sections - 2) * ring;
  for (let j = 0; j < ring; j++) indices.push(lastRing + j, last, lastRing + (j + 1) % ring);

  // Fit the continuous skin to the exact visual bounds of its existing body
  // compound. Keeping the two original tips then preserves the full asset's
  // centre and dimensions, including its asymmetric stem.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const axis = i % 3; lo[axis] = Math.min(lo[axis], positions[i]); hi[axis] = Math.max(hi[axis], positions[i]); }
  for (let i = 0; i < positions.length; i++) { const axis = i % 3; positions[i] = bounds.lo[axis] + (positions[i] - lo[axis]) / (hi[axis] - lo[axis]) * (bounds.hi[axis] - bounds.lo[axis]); }
  return { positions, indices, color: '#dfbd58', finish: 'skin', details: parts.slice(9).map(part => ({ ...part, finish: 'skin' })) };
}

/** Immutable by convention; renderers upload their own typed-array buffers. */
export function assetSurface(assetId) {
  if (assetId !== 'banana') return null;
  if (!surfaces.has(assetId)) surfaces.set(assetId, bananaSurface());
  return surfaces.get(assetId);
}
