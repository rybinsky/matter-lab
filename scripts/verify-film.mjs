import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { normalizeFilm, validateFilm, filmDuration, filmClipDuration, FILM_MAX_CLIPS, prepareFilmClipEditorProject } from '../src/film.js';
import { captureFilm } from './capture-film.mjs';
import { createSoundtrack } from './soundtrack.mjs';
import { selectSoundEvents, soundTakeTimings } from '../src/sound-design.js';
import { settingsFor } from '../src/catalog.js';
import { TRACKS } from '../src/tracks.js';

const began = performance.now(), directory = await mkdtemp(path.join(tmpdir(), 'matter-film-qa-'));
const near = (a, b, tolerance = 1e-7) => assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const point = (time, sourceTime, x = 5) => ({ time, sourceTime, position: [x, 4, 7], target: [0, 1, 0], fov: 40 });
function scene(asset, gravity, enabled, mode, duration) {
  return {
    version: 1, name: asset, series: true, height: 2160, preview: true, previewDuration: 99,
    settings: {
      ...settingsFor('blank'), experiment: 'blank', gravity, exportFps: 60, simulationDuration: 1,
      story: { enabled, title: asset, duration: 5, metric: 'distance', autoTrim: true, heroId: 'subject' },
      cameraRig: { mode, interpolation: 'linear', points: mode === 'recorded'
        ? [point(0, 0, 6), point(.5, .3, 5), point(1, .3, 4), point(duration, .6, 3)]
        : [point(0, 0), point(duration, .8, 4)] },
      environment: 'gallery', musicTrack: TRACKS[0].id,
      soundDesign: { musicGain: .1, effectsGain: .2 },
    },
    objects: [{ id: 'subject', asset, scale: .4, mass: 2, material: 'metal', position: [0, gravity ? 1.8 : 3, 0], velocity: gravity ? [0, 0, 0] : [1.25, 0, 0] }], edits: {},
  };
}
const cube = scene('cube', 0, false, 'recorded', 1.5), ball = scene('ball', 9.81, true, 'keys', 2);
ball.objects.push({ id: 'surface-reference', asset: 'banana', fixed: true, position: [-3, .3, 1], scale: .4, mass: .2, material: 'wood' });
const root = {
  version: 1, name: 'Film fixture', settings: {
    ...settingsFor('blank'), experiment: 'blank', exportFps: 24,
    story: { enabled: false, title: 'Root title', duration: 5 },
    environment: 'arena', audioPreset: 'auto', musicTrack: TRACKS[1].id,
    soundDesign: { musicGain: .45, effectsGain: .8, ambience: 'off', ducking: .25 },
  }, objects: [], edits: {}, height: 720,
  film: { version: 1, enabled: true, title: 'Two independent scenes', clips: [
    { id: 'moving-cube', label: 'Куб: движение и пауза', project: cube },
    { id: 'falling-ball', label: 'Шар: падение', project: ball },
  ] },
};
let checks = 0;
try {
  const editorRoot={...structuredClone(root),id:'root-project',name:'Общий фильм',height:1080};
  editorRoot.film.enabled=false;
  editorRoot.settings.musicTrack=null;
  editorRoot.settings.soundDesign={musicGain:0,effectsGain:0,ducking:0,vacuum:false};
  const editorBefore=JSON.stringify(editorRoot),childBefore=JSON.stringify(cube);
  const opened=prepareFilmClipEditorProject(editorRoot,cube);
  assert.equal(opened.id,editorRoot.id);assert.equal(opened.name,editorRoot.name);assert.equal(opened.height,1080);
  assert.equal(opened.film.enabled,false);assert.equal(opened.settings.musicTrack,null);
  assert.deepEqual(opened.settings.soundDesign,editorRoot.settings.soundDesign);
  assert.equal(opened.settings.exportFps,editorRoot.settings.exportFps);assert.equal(opened.settings.audioPreset,editorRoot.settings.audioPreset);
  for(const key of ['environment','cameraRig','story','gravity'])assert.deepEqual(opened.settings[key],cube.settings[key]);
  assert.deepEqual(opened.objects,cube.objects);assert.deepEqual(opened.edits,cube.edits);
  opened.settings.soundDesign.musicGain=1;
  opened.film.clips[0].project.objects[0].position[0]=999;
  opened.objects[0].position[0]=-999;
  assert.equal(JSON.stringify(editorRoot),editorBefore);assert.equal(JSON.stringify(cube),childBefore);
  const withoutGlobals=structuredClone(editorRoot);delete withoutGlobals.height;
  for(const key of ['musicTrack','audioPreset','soundDesign','exportFps'])delete withoutGlobals.settings[key];
  const defaults=prepareFilmClipEditorProject(withoutGlobals,cube);
  for(const key of ['musicTrack','audioPreset','soundDesign','exportFps'])assert(!Object.hasOwn(defaults.settings,key),'Absent root global must not inherit the child override');
  assert(!Object.hasOwn(defaults,'height'));
  assert.throws(()=>prepareFilmClipEditorProject({},cube),/проект фильма/);
  checks++;
  const before = JSON.stringify(root), normalized = normalizeFilm(root.film);
  assert.equal(validateFilm(root.film), root.film); near(filmDuration(root.film), 3.5);
  assert.equal(filmClipDuration(cube), 1.5); assert.equal(filmClipDuration(ball), 2);
  assert.deepEqual(normalizeFilm(JSON.parse(JSON.stringify(normalized))), normalized);
  normalized.clips[0].project.objects[0].position[0] = 99; assert.equal(cube.objects[0].position[0], 0);
  const invalid = change => { const film = structuredClone(root.film); change(film); assert.throws(() => validateFilm(film), /Некорректный фильм/); checks++; };
  invalid(f => f.clips[0].project.film = { version: 1, enabled: false, clips: [] });
  invalid(f => f.clips[1].id = f.clips[0].id);
  invalid(f => f.clips = Array.from({ length: FILM_MAX_CLIPS+1 }, (_, i) => ({ ...f.clips[0], id: `clip-${i}` })));
  invalid(f => { for (const clip of f.clips) { clip.project.settings.cameraRig.mode = 'auto'; clip.project.settings.story.duration = 100; } });
  invalid(f => f.clips[0].project.objects[0].asset = 'missing-asset');
  const roundedOverflow = { version: 1, enabled: true, clips: [59.98, 59.98, 60.04].map((duration, i) => ({ id: `round-${i}`, project: scene('ball', 0, false, 'keys', duration) })) };
  near(filmDuration(roundedOverflow), 180);
  assert.throws(() => validateFilm(roundedOverflow, { fps: 24 }), /180/); checks++;

  const cache = path.join(directory, 'film.json'), progress = [];
  const data = await captureFilm(root, cache, (p, message) => progress.push({ p, message }));
  assert.equal(JSON.stringify(root), before, 'Capturing a film cannot edit its source projects');
  assert.equal(data.revision, 6); assert.equal(data.experiment, 'film');
  assert.equal(data.fps, 24); assert.equal(data.width, 720); assert.equal(data.height, 1280);
  near(data.duration, 3.5); assert.deepEqual(data.takes.map(t => t.frames.length), [36, 48]);
  assert.deepEqual(data.takes.map(t => t.start), [0, 1.5]);
  assert.deepEqual(data.takes.map(t => t.experiment), ['blank', 'blank']);
  assert.equal(data.takes[0].entities[0].parts[0].shape, 'box');
  assert.equal(data.takes[1].entities[0].parts[0].shape, 'sphere');
  assert.equal(data.story.enabled, true, 'A title-enabled clip cannot be hidden by the root or first clip');
  assert(data.takes[0].frames.every(f => f.editorial.enabled === false));
  assert(data.takes[1].frames.every(f => f.editorial.enabled === true));
  assert.equal(data.musicTrack, root.settings.musicTrack); assert.equal(data.environment.id, 'arena'); assert.deepEqual(data.soundDesign, root.settings.soundDesign);
  assert(progress.every((v, i) => v.p >= 0 && v.p <= 14 && (!i || v.p >= progress[i - 1].p)));
  let globalFrame = 0, sourceImpacts = 0;
  for (const [i, clip] of data.film.clips.entries()) {
    const child = JSON.parse(await readFile(path.join(directory, clip.sourceCache), 'utf8'));
    assert.equal(child.takes.length, 1, 'A film clip is never exported as a comparison series');
    const take = data.takes[i], frames = take.frames, original = child.takes[0];
    assert.equal(take.clipId, root.film.clips[i].id); assert.equal(take.clipIndex, i);
    assert.equal(take.label, root.film.clips[i].label);
    assert.equal(clip.frameStart, globalFrame); assert.equal(clip.frameCount, frames.length);
    for (const [j, frame] of frames.entries()) {
      assert.equal(frame.poses, original.frames[j].poses); assert.deepEqual(frame.camera, original.frames[j].camera);
      assert.deepEqual(JSON.parse(JSON.stringify(frame.stats)), original.frames[j].stats); near(frame.sourceTime, original.frames[j].sourceTime);
      assert.equal(frame.editorial.takeLabel, original.frames[j].editorial.takeLabel, 'Internal clip names cannot replace authored on-screen text');
      assert.equal(frame.editorial.takeIndex, i); assert.equal(frame.editorial.takeCount, 2);
      near(frame.editorial.progress, j / (frames.length - 1)); near(frame.editorial.movieTime, (globalFrame + j) / 24);
      near(frame.editorial.movieProgress, (globalFrame + j) / 83);
      assert([...frame.camera.position, ...frame.camera.target, frame.sourceTime].every(Number.isFinite));
    }
    assert.equal(take.impacts.length, original.impacts.length);
    take.impacts.forEach((impact, n) => { near(impact.t, original.impacts[n].t + clip.start); sourceImpacts++; });
    globalFrame += frames.length;
  }
  assert(sourceImpacts > 0, 'The fall must produce an actual physical sound event');
  const surfaced = data.takes[1].entities.find(e => e.id === 'surface-reference');
  assert(surfaced.surface && data.renderSurfaces[surfaced.surface]?.positions?.length > 0);
  assert.deepEqual(data.models, ['Rapier 0.21']);
  const paused = data.takes[0].frames.filter((_, i) => i / 24 > .55 && i / 24 < .95);
  assert(paused.every(f => f.poses === paused[0].poses));
  assert(Math.abs(paused.at(-1).camera.position[0] - paused[0].camera.position[0]) > .5);
  const events = selectSoundEvents(data); assert(events.length > 0); assert(events.every(e => e.t >= 1.5));
  assert.deepEqual(soundTakeTimings(data).map(t => t.start), [0, 1.5]);
  const audio = createSoundtrack(data); assert.equal(audio.length, 44 + Math.ceil(3.5 * 32000) * 4);
  assert.equal(audio.readUInt32LE(24), 32000); assert.equal(audio.readUInt16LE(22), 2);
  const energy = (a, b) => { let sum = 0; for (let i = Math.floor(a * 32000); i < Math.floor(b * 32000); i++) sum += Math.abs(audio.readInt16LE(44 + i * 4)); return sum; };
  assert(energy(.2, 1.2) > 0 && energy(1.6, 3.2) > 0, 'One continuous film soundtrack covers both clips');
  const stored = JSON.parse(await readFile(cache, 'utf8')); assert.deepEqual(stored.film, data.film); assert.equal(stored.duration, 3.5);
  checks++;

  const fallback = structuredClone(root); fallback.film.enabled = false;
  const ordinary = await captureFilm(fallback, path.join(directory, 'disabled.json'));
  assert.equal(ordinary.experiment, 'blank'); assert.equal(ordinary.film, undefined); assert.equal(ordinary.duration, 5);
  fallback.film.enabled = true; fallback.film.clips = [];
  const empty = await captureFilm(fallback, path.join(directory, 'empty.json')); assert.equal(empty.experiment, 'blank'); assert.equal(empty.duration, 5); checks++;
  assert(performance.now() - began < 19000, 'Film regression exceeded its 19-second budget');
  console.log(`Film QA passed: ${checks} checks; 2 independent scenes / ${globalFrame} merged frames, exact 3.5 s, paused rig, per-clip titles, shared format/music, absolute sound offsets, nested/oversize rejection and disabled/empty fallback. ${(performance.now() - began).toFixed(0)} ms.`);
} finally { await rm(directory, { recursive: true, force: true }); }
