import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { normalizeCameraRig, sampleCameraRig, retimeCameraRig, simplifyCameraRig, cameraTrackPlan } from '../src/camera-rig.js';
import { validateProject } from '../src/validation.js';
import { settingsFor } from '../src/catalog.js';
import { capture } from './capture.mjs';
import { selectSoundEvents } from '../src/sound-design.js';

const began = performance.now(), failures = [];
const temporary = await mkdtemp(path.join(tmpdir(), 'matter-camera-rig-'));
let passed = 0, capturedFrames = 0, binaryFloats = 0, captureNumber = 0;
const near = (a, b, tolerance = 1e-6) => assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const vectorNear = (a, b) => a.forEach((v, i) => near(v, b[i]));
const point = (time, sourceTime, x = 6) => ({ time, sourceTime, position: [x, 4, 8], target: [0, 1, 0], fov: 40, cut: false });
const rig = mode => ({ version: 1, mode, interpolation: 'linear', anchorId: '', points: [point(0, 0, 6), point(1, .4, 5), point(2, .4, 4), point(3, 1.2, 3)] });
const project = (cameraRig, exportFps = 24) => ({
  version: 1, name: 'Camera timing regression', series: false, edits: {},
  settings: {
    ...settingsFor('blank'), experiment: 'blank', gravity: 0, simulationDuration: 1.2, exportFps,
    story: { duration: 20, enabled: false, heroId: 'carrier', metric: 'distance', autoTrim: true },
    cameraRig, environment: { id: 'arena', background: '#122134' },
    soundDesign: { musicGain: .73, effectsGain: .42, ambience: 'off', vacuum: false },
  },
  objects: [
    { id: 'carrier', asset: 'ball', position: [1, 3, 2], velocity: [1.5, 0, 0], scale: .3, mass: 1, material: 'metal' },
    { id: 'landmark', asset: 'crate', position: [0, 1, 6], scale: .5, mass: 2, material: 'wood', fixed: true },
  ],
});
async function check(name, run) {
  try { await run(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`✗ ${name}: ${error.message}`); }
  assert(performance.now() - began < 19000, 'Camera-rig verification exceeded its 19-second budget');
}
function decode(value) {
  const bytes = Buffer.from(value, 'base64'); assert.equal(bytes.length % 4, 0);
  const values = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
  assert(values.every(Number.isFinite)); binaryFloats += values.length; return values;
}
async function render(input) {
  const data = await capture(input, path.join(temporary, `${captureNumber++}.json`));
  near(data.duration, data.takes.reduce((n, t) => n + t.frames.length, 0) / data.fps);
  for (const take of data.takes) for (const frame of take.frames) {
    const poses = decode(frame.poses); assert.equal(poses.length, take.entities.length * 7);
    for (const value of Object.values(frame.vertices || {})) decode(value);
    for (const value of [...frame.camera.position, ...frame.camera.target, frame.camera.fov, frame.sourceTime]) assert(Number.isFinite(value));
    assert.equal(frame.editorial.enabled, false, 'Raw-video authoring flag must survive capture');
    capturedFrames++;
  }
  assert.equal(data.story.enabled, false);
  assert.equal(data.environment.id, 'arena'); assert.equal(data.environment.background, '#122134');
  assert.deepEqual(data.soundDesign, input.settings.soundDesign);
  return data;
}
function sameCapturedRoute(original,reduced){
 const a=original.takes[0].frames,b=reduced.takes[0].frames;assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++){
  near(a[i].sourceTime,b[i].sourceTime,1e-10);vectorNear(a[i].camera.position,b[i].camera.position);vectorNear(a[i].camera.target,b[i].camera.target);near(a[i].camera.fov,b[i].camera.fov);
  const left=decode(a[i].poses),right=decode(b[i].poses);assert.equal(left.length,right.length);left.forEach((value,index)=>near(value,right[index],1e-6));
 }
}

try {
  await check('Rig roundtrip, retiming and reduction preserve the two independent clocks', () => {
    const normalized = normalizeCameraRig(rig('recorded')), copy = JSON.parse(JSON.stringify(normalized));
    assert.deepEqual(normalizeCameraRig(copy), normalized);
    const stretched = retimeCameraRig(normalized, 6);
    assert.deepEqual(stretched.points.map(p => p.sourceTime), normalized.points.map(p => p.sourceTime));
    assert.deepEqual(stretched.points.map(p => p.time), [0, 2, 4, 6]);
    const plan = cameraTrackPlan(stretched, 6); near(plan.at(3).source, .4);
    const dense = normalizeCameraRig({ ...normalized, anchorId: 'carrier', points: Array.from({ length: 91 }, (_, i) => {
      const t = i / 30, p = sampleCameraRig(normalized, t); return { ...p, time: t };
    }) });
    const reduced = simplifyCameraRig(dense, 12); assert.equal(reduced.points.length, 12); assert.equal(reduced.anchorId, 'carrier');
    assert.deepEqual(reduced.points[0].position, dense.points[0].position); assert.deepEqual(reduced.points.at(-1).position, dense.points.at(-1).position);
  });
  await check('15 authored keys reduced towards 12 retain the exact 7-second cut instead of a camera flight',async()=>{
    const input={mode:'keys',interpolation:'linear',points:Array.from({length:15},(_,i)=>({time:i,sourceTime:i,position:i<7?[0,2,5]:[5,2,0],target:[0,1,0],fov:40,cut:i===7}))};
    const before=structuredClone(input),reduced=simplifyCameraRig(input,12);
    assert.deepEqual(input,before);assert.deepEqual(reduced.points.filter(p=>p.cut).map(p=>p.time),[7]);assert(reduced.points.some(p=>p.time===6));
    for(const time of [6,6.9,6.999999]){vectorNear(sampleCameraRig(reduced,time).position,[0,2,5]);near(sampleCameraRig(reduced,time).sourceTime,time);}
    vectorNear(sampleCameraRig(reduced,7).position,[5,2,0]);
    sameCapturedRoute(await render(project(input)),await render(project(reduced)));
  });
  await check('Off-grid short shots retain cuts, attention changes, physical holds and backwards playback',async()=>{
    const cuts=[.47,.53,.91,1.03],times=[0,.1,.2,.3,.4,.47,.5,.53,.6,.7,.8,.85,.9,.91,.95,1,1.03,1.1,1.2,1.3,1.4,1.5,1.6,1.8,2,2.2,2.4];
    const input={mode:'recorded',interpolation:'linear',anchorId:'carrier',points:times.map(time=>{
      const shot=cuts.filter(cut=>cut<=time).length;
      const sourceTime=time<=.3?time:time<=.9?.3:time<=1.5?.3+(time-.9)*1.5:1.2-(time-1.5)/.9;
      return{...point(time,sourceTime,6-shot),cut:cuts.includes(time),attentionIds:time<.53?['carrier']:time<1.03?['carrier','landmark']:[],attentionOffset:[0,.2,0],attentionTransition:cuts.includes(time)?'cut':'linear'};
    })};
    const reduced=simplifyCameraRig(input,12);
    assert.deepEqual(reduced.points.filter(p=>p.cut).map(p=>p.time),cuts);
    for(const time of [.3,.9,1.5])assert(reduced.points.some(p=>p.time===time),`Source clock boundary ${time} was lost`);
    sameCapturedRoute(await render(project(input,60)),await render(project(reduced,60)));
  });
  await check('A requested 12-key target expands visibly when short shot pairs require more keys',()=>{
    const input={mode:'recorded',interpolation:'linear',points:Array.from({length:24},(_,index)=>({...point(index/10,index/20,4+Math.floor((index+1)/2)),cut:index%2===1}))},before=structuredClone(input);
    const reduced=simplifyCameraRig(input,12);assert.equal(reduced.points.length,24);assert.equal(reduced.points.filter(p=>p.cut).length,12);
    assert.deepEqual(reduced.points,normalizeCameraRig(input).points);assert.deepEqual(input,before);
    for(const invalid of [0,1,1.5,NaN,3602])assert.throws(()=>simplifyCameraRig(input,invalid),/2.*3601/);
  });
  await check('Saved malformed times, optics and coordinates are rejected before simulation', () => {
    for (const change of [
      p => p.settings.cameraRig.points[0].position[0] = NaN,
      p => p.settings.cameraRig.points[1].sourceTime = 21,
      p => p.settings.cameraRig.points[1].time = -1,
      p => p.settings.cameraRig.points[1].time = 0,
      p => p.settings.cameraRig.points[0].fov = 0,
      p => p.settings.cameraRig.points[0].target = p.settings.cameraRig.points[0].position.slice(),
      p => p.settings.cameraRig.mode = 'unknown-camera',
    ]) {
      const p = project(rig('keys')); change(p); assert.throws(() => validateProject(p), error => /Некорректный проект/.test(error.message));
    }
    const p = project(normalizeCameraRig(rig('keys'))), before = JSON.stringify(p); assert.equal(validateProject(p), p); assert.equal(JSON.stringify(p), before);
  });
  for (const [mode, fps] of [['recorded', 24], ['keys', 30]]) await check(`${mode}: physics freezes while the authored camera continues moving`, async () => {
    const data = await render(project(rig(mode), fps));
    assert.equal(data.duration, 3); assert.equal(data.takes[0].frames.length, 3 * fps);
    assert.equal(data.cameraMode, mode);
    const frames = data.takes[0].frames, paused = frames.filter((_, i) => i / fps >= 1.1 && i / fps <= 1.9);
    assert(paused.length > 5); assert(paused.every(f => Math.abs(f.sourceTime - .4) < 1e-8));
    assert(paused.every(f => f.poses === paused[0].poses), 'A paused physical moment cannot drift while the camera moves');
    assert(Math.abs(paused.at(-1).camera.position[0] - paused[0].camera.position[0]) > .5);
    for (let i = 0; i < frames.length; i++) {
      const expected = sampleCameraRig(rig(mode), i / fps); vectorNear(frames[i].camera.position, expected.position); vectorNear(frames[i].camera.target, expected.target);
    }
  });
  await check('An anchor is added once to eye and target at the sampled physical time', async () => {
    const relative = { ...rig('keys'), anchorId: 'carrier', points: rig('keys').points.map(p => ({ ...p, position: [3, 2, 5], target: [0, 0, 0] })) };
    const data = await render(project(relative));
    const take = data.takes[0], index = take.entities.findIndex(e => e.id === 'carrier');
    assert(index >= 0);
    for (const frame of take.frames) {
      const poses = decode(frame.poses), anchor = poses.slice(index * 7, index * 7 + 3);
      vectorNear(frame.camera.position, anchor.map((v, i) => v + [3, 2, 5][i]));
      vectorNear(frame.camera.target, anchor);
    }
    const first = take.frames[0]; vectorNear(first.camera.target, [1, 3, 2]); vectorNear(first.camera.position, [4, 5, 7]);
  });
  await check('Static camera remains fixed while physics advances', async () => {
    const fixed = { mode: 'static', points: [point(0, 0), point(3, 1.2)] };
    const data = await render(project(fixed)), frames = data.takes[0].frames;
    assert.equal(data.cameraMode, 'static'); assert.equal(data.duration, 20);
    assert.notEqual(frames[0].poses, frames.at(-1).poses);
    assert(frames.at(-1).sourceTime > frames[0].sourceTime);
    for (const frame of frames) { vectorNear(frame.camera.position, [6, 4, 8]); vectorNear(frame.camera.target, [0, 1, 0]); }
  });
  await check('An empty manual take is rejected with a useful authoring error', async () => {
    await assert.rejects(() => capture(project({ mode: 'recorded', points: [] }), path.join(temporary, 'empty.json')), /Сначала сохраните ракурс или запишите/);
  });
  await check('Contact at the beginning of a paused moment maps to its first arrival', () => {
    const plan = cameraTrackPlan({ mode: 'recorded', points: [point(0, 0), point(1, .5), point(2, .5), point(3, 1)] }, 3);
    const times = plan.timesFor(.5); assert.equal(times.length, 1); near(times[0], 1);
  });
  await check('One physical contact sounds on two forward replays, never on the rewind cut', () => {
    const fps = 30, resetAt = 2 + 1 / fps, duration = resetAt + 2;
    const input = { mode: 'keys', interpolation: 'linear', points: [
      point(0, 0), point(2, 2), { ...point(resetAt, 0, -6), cut: true }, point(duration, 2, -6),
    ] };
    const plan = cameraTrackPlan(input, duration), times = plan.timesFor(1);
    assert.equal(times.length, 2, 'One source contact has exactly two forward screen appearances');
    near(times[0], 1); near(times[1], resetAt + 1);
    // The camera/source track still rewinds. Only its sound scheduling changes.
    near(plan.at(2 + .5 / fps).source, 1);
    near(plan.at(resetAt).source, 0);
    const data = { fps, duration, experiment: 'blank', takes: [{
      start: 0, entities: [{ id: 'ball', material: 'metal' }, { id: 'wall', material: 'wood' }],
      frames: Array.from({ length: Math.round(duration * fps) }, (_, i) => ({ sourceTime: plan.at(i / fps).source, stats: { moving: 1, energy: 1 } })),
      impacts: times.map(t => ({ t, strength: .7, participants: ['ball', 'wall'] })),
    }] };
    const audible = selectSoundEvents(data);
    assert.equal(audible.length, 2); near(audible[0].t, 1); near(audible[1].t, resetAt + 1);
    const reverse = cameraTrackPlan({ mode: 'keys', points: [point(0, 2), point(2, 0)] }, 2);
    assert.deepEqual(reverse.timesFor(1), [], 'Continuous reverse playback does not invent fresh contact sounds either');
  });
  await check('A camera cut preserves sounds during ordinary forward physics before the new angle', () => {
    const input = { mode: 'keys', points: [point(0, 0), point(1, 1), { ...point(2, 2, -6), cut: true }, point(3, 3, -6)] };
    const plan = cameraTrackPlan(input, 3), times = plan.timesFor(1.5);
    assert.equal(times.length, 1); near(times[0], 1.5);
    near(sampleCameraRig(input, 1.5).position[0], 6);
    near(sampleCameraRig(input, 2).position[0], -6);
  });
  await check('A missing anchor cannot silently turn relative coordinates into world coordinates', async () => {
    const input = project({ ...rig('keys'), anchorId: 'removed-anchor' });
    await assert.rejects(() => capture(input, path.join(temporary, 'missing-anchor.json')), /якор|опор|anchor/i);
  });
} finally { await rm(temporary, { recursive: true, force: true }); }

console.log(`Camera-rig QA: ${passed} checks passed; ${capturedFrames} captured frames / ${binaryFloats} finite binary floats; ${(performance.now() - began).toFixed(0)} ms.`);
assert.equal(failures.length, 0, failures.join('\n'));
