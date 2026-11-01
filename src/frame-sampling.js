// Resample the physical timeline without quantizing slow motion to snapshots.
// Geometry and continuous measurements may move between two observed frames;
// counters, events and status changes become visible only at the observed frame.
const decodedFrames = new WeakMap();
const objectVectors = ['position', 'velocity', 'bounds', 'angularVelocity'];
const objectScalars = ['distance', 'speed', 'height', 'altitude'];
const counters = new Set(['objects', 'particles', 'moving', 'movedObjects', 'collected', 'count', 'precision', 'index', 'id']);
const isCounter = key => counters.has(key) || /(?:Count|Counts|Index|Indices)$/.test(key);
const finite = Number.isFinite;
const lerp = (a, b, t) => finite(a) && finite(b) ? a * (1 - t) + b * t : finite(a) ? a : finite(b) ? b : 0;
const clone = value => {
  if (Array.isArray(value)) return value.map(clone);
  if (ArrayBuffer.isView(value)) return value.slice();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

function decode(packed, frame) {
  if (typeof packed !== 'string') return null;
  let cache = decodedFrames.get(frame);
  if (!cache) { cache = new Map(); decodedFrames.set(frame, cache); }
  if (cache.has(packed)) return cache.get(packed);
  const bytes = typeof Buffer !== 'undefined'
    ? Uint8Array.from(Buffer.from(packed, 'base64'))
    : Uint8Array.from(atob(packed), char => char.charCodeAt(0));
  const values = bytes.byteLength % 4 ? null : new Float32Array(bytes.buffer);
  cache.set(packed, values);
  return values;
}

function encode(values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}

function interpolateVector(a, b, t) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    ? a.map((value, index) => lerp(value, b[index], t)) : clone(a);
}

// Unit quaternions q and -q represent the same rotation. Correct the sign
// before SLERP so the renderer follows the short arc, including near 180°.
function interpolateQuaternion(a, b, t) {
  if (!a || !b || a.length !== 4 || b.length !== 4) return clone(a);
  const lengthA = Math.hypot(...a), lengthB = Math.hypot(...b);
  if (!(lengthA > 1e-12) || !finite(lengthA) || !(lengthB > 1e-12) || !finite(lengthB)) return clone(a);
  const qa = Array.from(a, value => value / lengthA), qb = Array.from(b, value => value / lengthB);
  let dot = qa.reduce((sum, value, index) => sum + value * qb[index], 0);
  if (dot < 0) { for (let index = 0; index < 4; index++) qb[index] *= -1; dot = -dot; }
  dot = Math.min(1, Math.max(-1, dot));
  let result;
  if (dot > .9995) result = qa.map((value, index) => lerp(value, qb[index], t));
  else {
    const angle = Math.acos(dot), divisor = Math.sin(angle);
    const weightA = Math.sin((1 - t) * angle) / divisor, weightB = Math.sin(t * angle) / divisor;
    result = qa.map((value, index) => value * weightA + qb[index] * weightB);
  }
  const length = Math.hypot(...result);
  return result.map(value => value / length);
}

function interpolatePacked(a, b, t, frameA, frameB, kind) {
  if (a === b) return a;
  const from = decode(a, frameA), to = decode(b, frameB);
  const stride = kind === 'poses' ? 7 : 3;
  if (!from || !to || from.length % stride || to.length % stride) return a;
  // Particle emission appends to this capture's stable particle order. New
  // particles wait until frame B; surviving particles can still move smoothly.
  if (kind !== 'particles' && from.length !== to.length) return a;
  const result = new Float32Array(from), shared = Math.min(from.length, to.length);
  if (kind === 'poses') {
    for (let offset = 0; offset < shared; offset += 7) {
      for (let axis = 0; axis < 3; axis++) result[offset + axis] = lerp(from[offset + axis], to[offset + axis], t);
      result.set(interpolateQuaternion(from.subarray(offset + 3, offset + 7), to.subarray(offset + 3, offset + 7), t), offset + 3);
    }
  } else for (let index = 0; index < shared; index++) result[index] = lerp(from[index], to[index], t);
  return encode(result);
}

function interpolateObject(a, b, t) {
  const result = clone(a);
  if (!a || !b || a.id !== b.id) return result;
  for (const key of objectVectors) if (a[key] && b[key]) result[key] = interpolateVector(a[key], b[key], t);
  if (a.quaternion && b.quaternion) result.quaternion = interpolateQuaternion(a.quaternion, b.quaternion, t);
  for (const key of objectScalars) if (finite(a[key]) && finite(b[key])) result[key] = lerp(a[key], b[key], t);
  return result;
}

function interpolateNumbers(a, b, t) {
  const result = clone(a);
  if (!a || !b) return result;
  for (const key of Object.keys(a)) if (!isCounter(key) && finite(a[key]) && finite(b[key])) result[key] = lerp(a[key], b[key], t);
  return result;
}

function countMetric(metric, next, stats, nextStats) {
  if (metric.discrete === true || metric.type === 'count' || metric.kind === 'count') return true;
  const unit = String(metric.unit || '').trim();
  if (/^(?:из\s+\d+|of\s+\d+|\/\s*\d+|шт\.?|предмет(?:ов|а|ы)?|объект(?:ов|а|ы)?|частиц(?:а|ы)?|objects?|particles?|items?|count)$/iu.test(unit)) return true;
  // An unlabelled counter can still retain its source measurement semantics.
  // Integer precision alone is insufficient: altitude and percentages also
  // deliberately use zero displayed decimals.
  return !unit && ['movedObjects', 'collected', 'objects', 'particles', 'moving'].some(key =>
    finite(stats[key]) && finite(nextStats[key]) && metric.value === stats[key] && next.value === nextStats[key]);
}

function interpolateStats(a, b, t) {
  const result = interpolateNumbers(a, b, t);
  if (!a?.metric || !b?.metric) return result;
  const metric = a.metric, next = b.metric;
  if (metric.unit === next.unit && metric.label === next.label && !countMetric(metric, next, a, b) && finite(metric.value) && finite(next.value)) {
    result.metric.value = lerp(metric.value, next.value, t);
  }
  return result;
}

/**
 * Samples are capture.mjs physical snapshots at `snapshots` frames/second.
 * Returned data is independent of the source. The caller keeps its exact
 * movie/source clock and computes camera/editorial metadata after sampling.
 * Different mesh topology is held; this never manufactures a new observation.
 */
export function sampleCapturedFrame(samples, sourceTime, snapshots) {
  if (!Array.isArray(samples) || !samples.length) throw new RangeError('Cannot sample an empty physical timeline');
  if (!finite(snapshots) || snapshots <= 0) throw new RangeError('Physical snapshot rate must be positive and finite');
  const time = Number.isNaN(sourceTime) || sourceTime === undefined ? 0 : sourceTime;
  let cursor = Math.max(0, Math.min(samples.length - 1, time * snapshots));
  // Prevent floating-point multiplication from delaying an exact observation.
  const integer = Math.round(cursor);
  if (Math.abs(cursor - integer) <= Number.EPSILON * Math.max(1, Math.abs(cursor)) * 8) cursor = integer;
  const index = Math.floor(cursor), t = cursor - index, a = samples[index], b = samples[index + 1];
  if (!b || t === 0) return clone(a);
  const result = clone(a);
  if (a.poses !== undefined && b.poses !== undefined) result.poses = interpolatePacked(a.poses, b.poses, t, a, b, 'poses');
  if (a.vertices && b.vertices) for (const key of Object.keys(a.vertices)) if (b.vertices[key] !== undefined) {
    result.vertices[key] = interpolatePacked(a.vertices[key], b.vertices[key], t, a, b, 'vertices');
  }
  if (a.fluidParticles !== undefined && b.fluidParticles !== undefined) result.fluidParticles = interpolatePacked(a.fluidParticles, b.fluidParticles, t, a, b, 'particles');
  if (Array.isArray(a.objects) && Array.isArray(b.objects)) {
    const next = new Map(b.objects.map(object => [object.id, object]));
    result.objects = a.objects.map(object => interpolateObject(object, next.get(object.id), t));
  }
  if(a.annotations&&b.annotations){const next=new Map(b.annotations.map(row=>[row.id,row]));result.annotations=a.annotations.map(row=>({...clone(row),position:interpolateVector(row.position,next.get(row.id)?.position,t)}));}
  if (a.hero) result.hero = interpolateObject(a.hero, b.hero, t);
  if (a.stats) result.stats = interpolateStats(a.stats, b.stats, t);
  for (const key of ['thermal', 'orbit', 'penetration']) if (a[key]) result[key] = interpolateNumbers(a[key], b[key], t);
  return result;
}
