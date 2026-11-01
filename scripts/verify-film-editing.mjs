import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { trimFilmClip, splitFilmClip } from '../src/film-editing.js';
import { normalizeCameraRig, sampleCameraRig } from '../src/camera-rig.js';
import { settingsFor } from '../src/catalog.js';
import { validateProject } from '../src/validation.js';
import { capture } from './capture.mjs';

const began = performance.now(), temporary = await mkdtemp(path.join(tmpdir(), 'matter-film-editing-'));
let passed = 0, captures = 0, comparedFrames = 0, comparedFloats = 0, maxPoseError = 0, maxCameraError = 0;
const failures = [];
const near = (a, b, tolerance = 1e-7) => assert(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} differs from ${b} by ${Math.abs(a - b)}`);
const point = (time, sourceTime, x = 6, cut = false) => ({ time, sourceTime, position: [x, 3 + x / 6, 7 + x / 8], target: [x / 8, 1 + x / 20, 0], fov: 34 + x / 2, cut });
const project = (cameraRig, exportFps = 24) => ({
  version: 1, name: 'Frame-accurate clip edit', series: false, edits: {},
  settings: {
    ...settingsFor('blank'), experiment: 'blank', gravity: 0, exportFps, simulationDuration: 1.2,
    story: { duration: 6, enabled: false, heroId: 'carrier', metric: 'distance', metricStart: 1.1, cues: [] },
    cameraRig, environment: { id: 'arena', background: '#122134' },
    soundDesign: { musicGain: .73, effectsGain: .42, ambience: 'off', vacuum: false },
  },
  objects: [
    { id: 'carrier', asset: 'ball', position: [1, 3, 2], velocity: [1.5, 0, .2], scale: .3, mass: 1, material: 'metal' },
    { id: 'landmark', asset: 'crate', position: [0, 1, 6], scale: .5, mass: 2, material: 'wood', fixed: true },
  ],
});
const clip = (rig, fps) => ({ id: 'original', label: 'Авторский дубль', project: project(rig, fps) });
const smoothRig = () => ({ mode: 'recorded', interpolation: 'smooth', anchorId: '', points: [
  point(0, 0, 7), point(.7, .404, 5.1), point(1.6, .404, 3.2), point(2.2, 1.1, 5), point(3.2, .2, -3), point(4.013, 1.2, -5),
] });
async function check(name, run) {
  try { await run(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures.push(`${name}: ${error.stack || error.message}`); console.error(`✗ ${name}: ${error.message}`); }
}
async function recorded(input, fps = input.project.settings.exportFps) {
  const data = await capture({ ...input.project, series: false, settings: { ...input.project.settings, exportFps: fps } }, path.join(temporary, `${captures++}.json`));
  assert.equal(data.takes.length, 1);
  near(data.duration, data.takes[0].frames.length / fps);
  return data.takes[0].frames;
}
function packedNear(a, b) {
  assert.equal(typeof a, 'string'); assert.equal(typeof b, 'string');
  const left = Buffer.from(a, 'base64'), right = Buffer.from(b, 'base64');
  assert.equal(left.length, right.length); assert.equal(left.length % 4, 0);
  for (let index = 0; index < left.length; index += 4) {
    const x = left.readFloatLE(index), y = right.readFloatLE(index), error = Math.abs(x - y);
    maxPoseError = Math.max(maxPoseError, error); near(x, y, 1e-6); comparedFloats++;
  }
}
function sameFrames(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    const a = actual[index], b = expected[index];
    near(a.sourceTime, b.sourceTime, 1e-10);
    packedNear(a.poses, b.poses);
    assert.deepEqual(Object.keys(a.vertices), Object.keys(b.vertices));
    for (const id of Object.keys(a.vertices)) packedNear(a.vertices[id], b.vertices[id]);
    if (a.fluidParticles !== undefined || b.fluidParticles !== undefined) packedNear(a.fluidParticles, b.fluidParticles);
    for (const key of ['position', 'target']) for (let axis = 0; axis < 3; axis++) {
      maxCameraError = Math.max(maxCameraError, Math.abs(a.camera[key][axis] - b.camera[key][axis]));
      near(a.camera[key][axis], b.camera[key][axis], 1e-7);
    }
    near(a.camera.fov, b.camera.fov); near(a.camera.scale, b.camera.scale);
    assert.equal(a.stats.movedObjects, b.stats.movedObjects);
    near(a.stats.displacement, b.stats.displacement, 1e-8);
    comparedFrames++;
  }
}

try {
  await check('Trim and split do not mutate or share project, object, cue or camera arrays', () => {
    const input = clip(smoothRig(), 30);
    input.project.settings.story.cues = [{ start: .5, end: 2.1, text: 'Подпись автора', label: '', hideMetric: false, fade: .8 }];
    input.extra = { nested: [1, 2, 3] };
    const before = structuredClone(input), trimmed = trimFilmClip(input, { start: .4, end: 3.2, fps: 30 });
    const [left, right] = splitFilmClip(input, 1.5, { rightId: 'right', fps: 30 });
    assert.deepEqual(input, before); assert.equal(left.id, 'original'); assert.equal(right.id, 'right');
    for (const result of [trimmed, left, right]) {
      assert.deepEqual(result.project.objects, before.project.objects);
      assert.deepEqual(result.project.edits, before.project.edits);
      assert.deepEqual(result.project.settings.soundDesign, before.project.settings.soundDesign);
      assert.equal(result.project.settings.gravity, before.project.settings.gravity);
      assert.equal(Object.hasOwn(result.project, 'film'), false); validateProject(result.project);
    }
    trimmed.project.objects[0].position[0] = 999;
    left.project.settings.story.cues[0].text = 'Изменён только левый клип';
    right.project.settings.cameraRig.points[0].position[0] = -999;
    trimmed.extra.nested[0] = 8;
    assert.deepEqual(input, before);
    assert.equal(right.project.settings.story.cues[0].text, 'Подпись автора');
    assert.notEqual(left.project.settings.cameraRig.points[0].position[0], -999);
  });
  await check('Cue intersections keep authored text, empty labels, false flags, and bounded fades', () => {
    const input = clip(smoothRig(), 30);
    input.project.settings.story.cues = [
      { start: .05, end: .15, text: 'До фрагмента' },
      { start: .5, end: 1, text: 'Пересечён в начале', label: '', hideMetric: false, fade: .8 },
      { start: 1, end: 2, text: 'Пересечён в конце', label: 'Мои условия', hideMetric: true, fade: .05 },
      { start: 2.5, end: 3, text: 'После фрагмента' },
    ];
    const output = trimFilmClip(input, { start: .8, end: 1.8, fps: 30 });
    const story = output.project.settings.story;
    assert.equal(story.cues.length, 2); near(story.duration, 1); near(story.metricStart, .3);
    near(story.cues[0].start, 0); near(story.cues[0].end, .2); near(story.cues[0].fade, .1);
    assert.equal(story.cues[0].label, ''); assert.equal(story.cues[0].hideMetric, false);
    near(story.cues[1].start, .2); near(story.cues[1].end, 1); near(story.cues[1].fade, .05);
    assert.equal(story.cues[1].label, 'Мои условия'); assert.equal(story.cues[1].hideMetric, true);
    const [left, right] = splitFilmClip(input, 1.5, { rightId: 'other', fps: 30 });
    const a = left.project.settings.story.cues.at(-1), b = right.project.settings.story.cues[0];
    assert.equal(a.text, 'Пересечён в конце'); assert.equal(b.text, a.text);
    near(a.start, 1); near(a.end, 1.5); near(b.start, 0); near(b.end, .5);
    near(right.project.settings.story.metricStart, 0);
  });
  await check('Invalid ranges, unsupported rigs/fps, nested films and duplicate ids fail clearly', () => {
    const input = clip(smoothRig(), 30);
    for (const range of [{ start: NaN, end: 1 }, { start: -1, end: 2 }, { start: 2, end: 1 }, { start: 0, end: 20 }, { start: 1, end: 1.04 }]) assert.throws(() => trimFilmClip(input, { ...range, fps: 30 }), /Монтаж клипа/);
    for (const fps of [0, 25, NaN, Infinity]) assert.throws(() => trimFilmClip(input, { start: 0, end: 1, fps }), /частота кадров/);
    for (const rightId of ['', 'original', 'bad\nline', 'x'.repeat(161)]) assert.throws(() => splitFilmClip(input, 1, { rightId }), /идентификатор/);
    for (const at of [NaN, 0, 4, 20, .01]) assert.throws(() => splitFilmClip(input, at, { rightId: 'other', fps: 24 }), /Монтаж клипа/);
    for (const mode of ['auto', 'static']) assert.throws(() => trimFilmClip(clip({ ...smoothRig(), mode }), { start: 0, end: 1 }), /запишите камеру/);
    assert.throws(() => trimFilmClip(clip({ ...smoothRig(), points: [point(0, 0)] }), { start: 0, end: 1 }), /запишите камеру/);
    const nested = structuredClone(input); nested.project.film = undefined;
    assert.throws(() => trimFilmClip(nested, { start: 0, end: 1 }), /вложенные фильмы/);
  });
  await check('Smooth 24 fps trim matches actual camera and physical frames on a rounded movie clock', async () => {
    const input = clip(smoothRig(), 24), original = await recorded(input);
    const trimmed = trimFilmClip(input, { start: .367, end: 2.71, fps: 24 });
    const frames = await recorded(trimmed);
    sameFrames(frames, original.slice(Math.round(.367 * 24), Math.round(2.71 * 24)));
  });
  await check('Splitting a smooth 24 fps take reproduces every original exported frame', async () => {
    const input = clip(smoothRig(), 24), original = await recorded(input);
    const [left, right] = splitFilmClip(input, 1.39, { rightId: 'part-two', fps: 24 });
    const a = await recorded(left), b = await recorded(right);
    sameFrames([...a, ...b], original);
    near(normalizeCameraRig(left.project.settings.cameraRig).duration + normalizeCameraRig(right.project.settings.cameraRig).duration, original.length / 24);
  });
  await check('Recorded 30 fps split retains a source hold and a backwards physical replay', async () => {
    const rig = { mode: 'recorded', interpolation: 'linear', points: [point(0, 0), point(.7, .404, 5), point(1.6, .404, 4), point(2.2, .15, 2), point(3.017, 1.2, -2)] };
    const input = clip(rig, 30), original = await recorded(input);
    const [left, right] = splitFilmClip(input, 1.167, { rightId: 'right', fps: 30 });
    sameFrames([...(await recorded(left)), ...(await recorded(right))], original);
    const held = original.filter(f => Math.abs(f.sourceTime - .404) < 1e-10);
    assert(held.length > 15); assert(held.every(f => f.poses === held[0].poses));
    assert.notDeepEqual(held[0].camera.position, held.at(-1).camera.position);
    assert(original.some((f, index) => index > 0 && f.sourceTime < original[index - 1].sourceTime));
  });
  await check('A 60 fps cropped camera anchored to a moving body receives the anchor exactly once', async () => {
    const rig = { ...smoothRig(), anchorId: 'carrier', points: smoothRig().points.map(p => ({ ...p, time: p.time / 2 })) };
    const input = clip(rig, 60), original = await recorded(input);
    const output = trimFilmClip(input, { start: .117, end: 1.91, fps: 60 });
    assert.equal(output.project.settings.cameraRig.anchorId, 'carrier');
    sameFrames(await recorded(output), original.slice(Math.round(.117 * 60), Math.round(1.91 * 60)));
  });
  for (const fps of [24, 30, 60]) await check(`${fps} fps camera cuts survive a non-grid trim and split`, async () => {
    const rig = { mode: 'keys', interpolation: 'smooth', points: [
      point(0, 0, 7), point(.53, .25, 5), point(1, .404, -5, true), point(1.717, .9, -3, true), point(2.213, 1.2, 2),
    ] };
    const input = clip(rig, fps), original = await recorded(input);
    const trimmed = trimFilmClip(input, { start: .217, end: 2.117, fps });
    sameFrames(await recorded(trimmed), original.slice(Math.round(.217 * fps), Math.round(2.117 * fps)));
    const [left, right] = splitFilmClip(input, 1.067, { rightId: 'cut-right', fps });
    sameFrames([...(await recorded(left)), ...(await recorded(right))], original);
  });
  await check('Fractional final source time produces the same physical freeze after trimming', async () => {
    const input = clip({ mode: 'keys', interpolation: 'linear', points: [
      point(0, 0), point(.5, .404, 5), point(1.5, .404, 3), point(2.5, 1.2, 1),
    ] }, 30);
    const original = await recorded(input), output = trimFilmClip(input, { start: .6, end: 1.4, fps: 30 });
    const frames = await recorded(output);
    sameFrames(frames, original.slice(18, 42));
    assert(frames.every(f => Math.abs(f.sourceTime - .404) < 1e-10));
    assert(frames.every(f => f.poses === frames[0].poses));
  });
  await check('An entire two-minute linear take stays exact without exceeding the key limit', () => {
    const input = clip({ mode: 'keys', interpolation: 'linear', points: [point(0, 0, 8), point(120, 20, 2)] }, 60);
    const output = trimFilmClip(input, { start: 0, end: 120, fps: 60 }), rig = output.project.settings.cameraRig;
    assert.equal(rig.points.length, 2); near(rig.duration, 120);
    for (const t of [0, 1 / 60, 7.43, 60, 119.9, 120]) {
      const a = sampleCameraRig(input.project.settings.cameraRig, t), b = sampleCameraRig(rig, t);
      for (const key of ['position', 'target']) a[key].forEach((v, i) => near(v, b[key][i], 1e-10));
      near(a.sourceTime, b.sourceTime, 1e-10);
    }
  });
  await check('Dense smooth crops are rejected before the camera normalizer can silently truncate', () => {
    const input = clip({ mode: 'keys', interpolation: 'smooth', points: [point(0, 0, 8), point(35, 10, -5), point(70, 20, 4)] }, 60);
    const before = structuredClone(input);
    assert.throws(() => trimFilmClip(input, { start: 0, end: 70, fps: 60 }), /предел — 3601/);
    assert.deepEqual(input, before);
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed, failed: failures.length, captures, comparedFrames, comparedFloats, maxPoseError, maxCameraError, seconds: +((performance.now() - began) / 1000).toFixed(3) }, null, 2));
if (failures.length) { console.error(failures.join('\n\n')); process.exitCode = 1; }
