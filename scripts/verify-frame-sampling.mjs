import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { sampleCapturedFrame } from '../src/frame-sampling.js';
import { initializePhysics, LabWorld } from '../src/physics.js';
import { settingsFor } from '../src/catalog.js';

const began = performance.now();
const pack = values => Buffer.from(new Float32Array(values).buffer).toString('base64');
const unpack = packed => Array.from(new Float32Array(Uint8Array.from(Buffer.from(packed, 'base64')).buffer));
const near = (a, b, tolerance = 1e-6) => assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const vectorNear = (a, b, tolerance) => { assert.equal(a.length, b.length); a.forEach((value, index) => near(value, b[index], tolerance)); };
const quaternion = degrees => [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)];
const object = (id, x, degrees = 0) => ({ id, name: id, position: [x, 2, 3], velocity: [x, 0, 0], quaternion: quaternion(degrees), bounds: [1 + x, 2, 3], distance: x, initialPosition: [0, 2, 3], fixed: false });
const frame = (x, degrees = 0) => ({
  poses: pack([x, 2, 3, ...quaternion(degrees)]), vertices: { specimen: pack([x, 0, 0, x + 1, 2, 3]) },
  fluidParticles: pack([x, 1, 2, x + 1, 3, 4]), fluidColor: '#123456',
  objects: [object('carrier', x, degrees)], hero: object('carrier', x, degrees),
  stats: { time: x, energy: x * 10, heroSpeed: x, heroHeight: x + 2, softHeight: x + 1, displacement: x, apex: x, movedObjects: x, collected: x, objects: x + 2, particles: x + 3, moving: x, metric: { value: x, unit: 'предметов', precision: 0, label: 'Сдвинулось' }, caption: `observed ${x}`, outcome: `outcome ${x}` },
  measuredChanges: x ? ['carrier'] : [],
  thermal: { depth: x, temperature: 1000 - x, elapsed: x, passed: !!x },
  orbit: { altitude: x, speed: x, elapsed: x, status: x ? 'impact' : 'flight' },
});
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; };
let checks = 0, slowFrames = 0;
async function check(label, run) { await run(); checks++; console.log(`✓ ${label}`); }

await check('Endpoints are exact, clamped and independently copied', () => {
  const samples = freeze([frame(0), frame(1)]), before = JSON.stringify(samples);
  for (const time of [-Infinity, -1, 0, NaN, undefined]) assert.deepEqual(sampleCapturedFrame(samples, time, 1), samples[0]);
  for (const time of [1, 2, Infinity]) assert.deepEqual(sampleCapturedFrame(samples, time, 1), samples[1]);
  const copied = sampleCapturedFrame(samples, 0, 1); copied.objects[0].position[0] = 99; copied.stats.metric.value = 99; copied.measuredChanges.push('invented');
  assert.equal(JSON.stringify(samples), before);
  assert.throws(() => sampleCapturedFrame([], 0, 60), RangeError);
  for (const rate of [0, -1, Infinity, NaN]) assert.throws(() => sampleCapturedFrame(samples, 0, rate), RangeError);
  assert.deepEqual(sampleCapturedFrame([samples[0]], .1, 60), samples[0]);
});

await check('Packed poses, soft vertices, particles, hero and object motion interpolate', () => {
  const samples = freeze([frame(0), frame(2)]), before = JSON.stringify(samples), result = sampleCapturedFrame(samples, .25, 1);
  vectorNear(unpack(result.poses), [.5, 2, 3, 0, 0, 0, 1]);
  vectorNear(unpack(result.vertices.specimen), [.5, 0, 0, 1.5, 2, 3]);
  vectorNear(unpack(result.fluidParticles), [.5, 1, 2, 1.5, 3, 4]);
  for (const key of ['position', 'velocity', 'bounds']) vectorNear(result.objects[0][key], object('carrier', .5)[key]);
  near(result.objects[0].distance, .5); near(result.hero.distance, .5);
  for (const key of ['time', 'heroSpeed', 'displacement', 'apex']) near(result.stats[key], .5);
  near(result.stats.energy, 5); near(result.stats.heroHeight, 2.5); near(result.stats.softHeight, 1.5);
  near(result.thermal.depth, .5); near(result.thermal.temperature, 999.5); near(result.orbit.altitude, .5);
  result.hero.position[0] = 999; result.stats.metric.value = 999;
  assert.equal(JSON.stringify(samples), before);
});

await check('Quaternion rotation follows the short arc and remains normalized', () => {
  for (const [angleA, angleB, expected] of [[170, -170, 180], [10, 350, 0], [0, 90, 45]]) {
    const result = sampleCapturedFrame([frame(0, angleA), frame(1, angleB)], .5, 1);
    for (const q of [unpack(result.poses).slice(3, 7), result.hero.quaternion, result.objects[0].quaternion]) {
      near(Math.hypot(...q), 1); near(Math.abs(q.reduce((sum, value, index) => sum + value * quaternion(expected)[index], 0)), 1);
    }
  }
  const a = frame(0), b = frame(1); b.poses = pack([1, 2, 3, 0, 0, 0, -1]); b.hero.quaternion = [0, 0, 0, -1];
  for (const time of [.001, .25, .5, .999]) vectorNear(unpack(sampleCapturedFrame([a, b], time, 1).poses).slice(3, 7), [0, 0, 0, 1]);
});

await check('Discrete observations never arrive early and counters never become fractions', () => {
  const samples = [frame(0), frame(3)];
  for (const unit of ['предметов', 'из 840', 'objects', 'particles', 'шт.', '']) {
    samples.forEach(sample => sample.stats.metric.unit = unit);
    for (const time of [.01, .25, .5, .999]) {
      const result = sampleCapturedFrame(samples, time, 1);
      for (const key of ['movedObjects', 'collected', 'objects', 'particles', 'moving']) {
        assert.equal(result.stats[key], samples[0].stats[key]); assert(Number.isInteger(result.stats[key]));
      }
      assert.equal(result.stats.metric.value, 0); assert.equal(result.stats.metric.precision, 0);
      assert.deepEqual(result.measuredChanges, []); assert.equal(result.thermal.passed, false); assert.equal(result.orbit.status, 'flight');
      assert.equal(result.stats.caption, 'observed 0'); assert.equal(result.stats.outcome, 'outcome 0');
    }
  }
  assert.deepEqual(sampleCapturedFrame(samples, 1, 1).measuredChanges, ['carrier']);
  const dense = Array.from({ length: 121 }, (_, index) => frame(index));
  assert.deepEqual(sampleCapturedFrame(dense, 113 / 120, 120), dense[113], 'An exact snapshot must not be treated as an earlier observation by rounding noise');
});

await check('Continuous metrics interpolate even when displayed without decimals', () => {
  for (const unit of ['%', 'км', 'см', 'м/с', 'Дж']) {
    const samples = [frame(0), frame(3)]; samples.forEach(sample => sample.stats.metric.unit = unit);
    const result = sampleCapturedFrame(samples, .5, 1); near(result.stats.metric.value, 1.5); assert.equal(result.stats.metric.precision, 0);
  }
});

await check('Object identity, hero changes, mesh topology and particle births stay discrete', () => {
  const a = frame(0), b = frame(1); a.objects.push(object('removed', 100)); b.objects.unshift(object('new', 500));
  b.hero = object('different-hero', 1000); b.vertices.specimen = pack([0, 0, 0]); b.vertices.new = pack([1, 2, 3]);
  b.fluidParticles = pack([2, 1, 2, 3, 3, 4, 100, 100, 100]);
  const result = sampleCapturedFrame([a, b], .5, 1);
  assert.deepEqual(result.objects.map(object => object.id), ['carrier', 'removed']); near(result.objects[0].position[0], .5); near(result.objects[1].position[0], 100);
  assert.deepEqual(result.hero, a.hero); assert.deepEqual(result.vertices, a.vertices);
  vectorNear(unpack(result.fluidParticles), [1, 1, 2, 2, 3, 4]);
  assert.equal(unpack(sampleCapturedFrame([a, b], 1, 1).fluidParticles).length, 9);
});

await check('Quarter-speed and 10% slow motion at 60 fps have a new pose on every moving frame', () => {
  for (const rate of [60, 120]) {
    const samples = Array.from({ length: rate + 1 }, (_, index) => frame(index / rate, index / rate * 90));
    for (const scale of [.25, .1]) {
      let previous = -Infinity;
      for (let index = 0; index <= 120; index++) {
        const sourceTime = index / 60 * scale, result = sampleCapturedFrame(samples, sourceTime, rate), poses = unpack(result.poses);
        near(poses[0], sourceTime); assert(poses[0] > previous, `${scale} speed at ${rate} source fps repeated frame ${index}`);
        near(result.hero.position[0], sourceTime); assert(poses.every(Number.isFinite));
        assert(unpack(result.vertices.specimen).every(Number.isFinite)); assert(unpack(result.fluidParticles).every(Number.isFinite));
        previous = poses[0]; slowFrames++;
      }
    }
  }
});

await check('Real 120 Hz rigid-body snapshots stay smooth at 10% speed / 60 fps', async () => {
  await initializePhysics();
  const lab = new LabWorld({ ...settingsFor('blank'), experiment: 'blank', gravity: 0 }, [{ id: 'carrier', asset: 'ball', position: [0, 3, 0], velocity: [2, 0, 0], scale: .3, mass: 1, material: 'metal' }]);
  try {
    const carrier = lab.find('carrier'), samples = [];
    for (let index = 0; index <= 60; index++) {
      if (index) lab.step();
      const p = carrier.body.translation(), q = carrier.body.rotation();
      samples.push({ poses: pack([p.x, p.y, p.z, q.x, q.y, q.z, q.w]), stats: lab.stats(), measuredChanges: lab.measuredChanges() });
    }
    let previous = -Infinity;
    for (let index = 0; index <= 180; index++) {
      const result = sampleCapturedFrame(samples, index / 60 * .1, 120), pose = unpack(result.poses);
      assert(pose[0] > previous, `Real physical slow motion repeated frame ${index}`); assert(pose.every(Number.isFinite));
      near(Math.hypot(...pose.slice(3)), 1); assert(Number.isInteger(result.stats.objects)); assert(Number.isInteger(result.stats.movedObjects));
      previous = pose[0]; slowFrames++;
    }
  } finally { lab.dispose(); }
});

console.log(`Frame-sampling QA passed: ${checks} checks; ${slowFrames} smooth 60-fps output frames; shortest quaternion paths, soft/fluid motion, exact endpoints and observed integer counts. ${Math.round(performance.now() - began)} ms.`);
