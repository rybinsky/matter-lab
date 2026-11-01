import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allocateTakeFrames, montagePlan } from '../src/montage.js';
import { createSoundtrack } from './soundtrack.mjs';

let allocations = 0, plans = 0, sourceChecks = 0, audioChecks = 0, cacheFrames = 0;
const sum = values => values.reduce((a, b) => a + b, 0);
const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

// A control changes its screen time, never the integer delivery budget.
for (const fps of [24, 30, 60]) {
  for (const flags of [[false, false, false, false], [true, false, false, false], [false, false, false, true], [true, true, false, true]]) {
    const takes = flags.map(isControl => ({ isControl }));
    const before = JSON.stringify(takes), result = allocateTakeFrames({ duration: 60, fps, takes });
    assert(result.frames.every(n => Number.isInteger(n) && n > 0));
    assert.equal(sum(result.frames), 60 * fps);
    assert.equal(result.shortened, false);
    assert.equal(JSON.stringify(takes), before);
    if (flags.some(Boolean)) assert(result.frames.some(n => n < 15 * fps));
    allocations++;
  }
  const takes = Array.from({ length: 4 }, () => ({ isControl: true }));
  const control = allocateTakeFrames({ duration: 60, fps, takes });
  assert.equal(control.shortened, true);
  assert(sum(control.frames) < 60 * fps);
  assert(control.frames[3] > control.frames[0], 'The final comparison needs room to read');
  const untrimmed = allocateTakeFrames({ duration: 60, fps, takes, autoTrim: false });
  assert.deepEqual(untrimmed.frames, [15, 15, 15, 15].map(seconds => seconds * fps));
  assert.equal(untrimmed.shortened, false);
  const remainder = allocateTakeFrames({ duration: 60.1, fps, takes: [{}, {}, {}, {}, {}, {}, {}], autoTrim: false });
  assert.equal(sum(remainder.frames), Math.round(60.1 * fps));
  assert(Math.max(...remainder.frames) - Math.min(...remainder.frames) <= 1);
  allocations += 3;
}
assert.deepEqual(allocateTakeFrames({ takes: [] }), { frames: [], shortened: false });
assert.deepEqual(allocateTakeFrames({ duration: 20, fps: 30, takes: [{ isControl: true }] }).frames, [600]);
allocations += 2;

// Include a one-frame film, early/late events, very short takes and long holds.
// Sampling after setup catches reversals inside slow-motion interpolation.
for (const duration of [1 / 60, .25, .5, 1, 3.2, 6, 15, 28.4]) {
  for (const maxTime of [1, 7.5, 20]) for (const eventTime of [-100, 0, .12, .5, maxTime, maxTime + 100]) {
    for (const opening of ['event', 'question']) for (const tempo of ['fast', 'calm']) for (const resultHold of [undefined, 3.4]) {
      const plan = montagePlan({ duration, maxTime, eventTime, opening, tempo, resultHold });
      for (const key of ['hook', 'setup', 'eventMovie', 'end']) assert(Number.isFinite(plan[key]));
      assert(plan.hook <= plan.setup && plan.setup < plan.eventMovie && plan.eventMovie < plan.end && plan.end <= duration);
      for (let i = 0; i <= 128; i++) {
        const frame = plan.at(duration * i / 128);
        assert(Number.isFinite(frame.source) && frame.source >= -1e-9 && frame.source <= maxTime + 1e-9);
        sourceChecks++;
      }
      let previous = -Infinity;
      const times = Array.from({ length: 129 }, (_, i) => plan.setup + (duration - plan.setup) * i / 128);
      times.push(...[plan.setup, plan.eventMovie, plan.end].flatMap(t => [Math.max(plan.setup, t - 1e-9), t, Math.min(duration, t + 1e-9)]));
      for (const time of times.sort((a, b) => a - b)) {
        const frame = plan.at(time);
        assert(Number.isFinite(frame.source));
        assert(frame.source >= -1e-9 && frame.source <= maxTime + 1e-9);
        assert(frame.source >= previous - 1e-9, `Physical time reversed inside action: ${JSON.stringify({ duration, maxTime, eventTime, opening, tempo, resultHold, time })}`);
        previous = frame.source; sourceChecks++;
      }
      // Inverse sound-cue mapping must stay inside this take's local timeline.
      for (const source of [0, .01, maxTime * .1, maxTime * .5, maxTime - .01]) {
        for (const time of plan.timesFor(source)) {
          assert(Number.isFinite(time) && time >= -1e-8 && time <= duration + 1e-8);
          near(plan.at(time).source, source, 1e-7);
        }
      }
      near(plan.at(duration).source, maxTime);
      plans++;
    }
  }
}

function pcm(wav) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 2);
  const sr = wav.readUInt32LE(24);
  const energy = (start, end) => {
    let result = 0;
    for (let i = Math.ceil(start * sr); i < Math.floor(end * sr); i++) result += Math.abs(wav.readInt16LE(44 + i * 4)) + Math.abs(wav.readInt16LE(46 + i * 4));
    return result;
  };
  return { sr, energy };
}
const takes = (times, extras = {}) => [6, 30, 12].map((count, i) => ({
  frames: Array.from({ length: count }, () => ({ stats: { time: times[i] }, thermal: { elapsed: times[i], temperature: 500 } })),
  impacts: [], ...extras,
}));

// Scene names and temperature alone must not create a motor/hiss bed.
// Unequal lengths are .25/1.25/.5 s; explicit activity uses those real offsets.
const softData = { duration: 2, fps: 24, experiment: 'soft', audioPreset: 'none', takes: takes([0, 1, 0]) };
const softWav = createSoundtrack(softData), soft = pcm(softWav);
assert.equal(softWav.length, 44 + 2 * soft.sr * 4);
assert.equal(soft.energy(.02, .2), 0);
assert.equal(soft.energy(.4, 1.3), 0);
assert.equal(soft.energy(1.6, 1.9), 0); audioChecks++;

const motorTakes = takes([0, 1, 0]);
motorTakes[1].frames = motorTakes[1].frames.map((frame, i) => ({ ...frame, sourceTime: i / 24, audioActivity: { kind: 'motor', level: .7 } }));
const motor = pcm(createSoundtrack({ ...softData, soundDesign: { ambience: 'activity' }, takes: motorTakes }));
assert.equal(motor.energy(.02, .2), 0); assert(motor.energy(.4, 1.3) > 1000); assert.equal(motor.energy(1.6, 1.9), 0); audioChecks++;

// A hot object is not evidence of audible boiling. Default thermal is quiet.
const thermal = pcm(createSoundtrack({ ...softData, experiment: 'thermal', takes: takes([1, 0, 1]) }));
assert.equal(thermal.energy(.05, .2), 0);
assert.equal(thermal.energy(.5, 1.3), 0);
assert.equal(thermal.energy(1.65, 1.9), 0); audioChecks++;

// Impact times have already been shifted to the absolute movie clock.
const impactTakes = takes([0, 0, 0]); impactTakes[2].impacts = [{ t: 1.6, strength: 1 }];
const impact = pcm(createSoundtrack({ ...softData, experiment: 'blank', takes: impactTakes }));
assert.equal(impact.energy(0, 1.59), 0);
assert(impact.energy(1.61, 1.85) > 1000); audioChecks++;

// If the local capture fixture exists, compare final physical poses byte for
// byte with its older equal-duration edit. Editing cannot alter an outcome.
try {
  const data = JSON.parse(await readFile(new URL('../.cache/qa/adaptive-check.json', import.meta.url), 'utf8'));
  const old = JSON.parse(await readFile(new URL('../.cache/review-blank-mvx43e8n.json', import.meta.url), 'utf8'));
  assert.equal(sum(data.takes.map(t => t.frames.length)), data.duration * data.fps);
  assert.equal(data.duration, 60);
  assert.equal(new Set(data.takes.map(t => t.observationTime)).size, 1);
  assert(data.takes[0].duration < data.takes[1].duration);
  let offset = 0;
  data.takes.forEach((take, n) => {
    near(take.start, offset); near(take.duration, take.frames.length / data.fps); offset += take.duration;
    assert.equal(take.frames.at(-1).poses, old.takes[n].frames.at(-1).poses);
    assert.equal(take.frames.at(-1).stats.movedObjects, old.takes[n].frames.at(-1).stats.movedObjects);
    let previous = -Infinity;
    for (const frame of take.frames) {
      assert(Number.isFinite(frame.sourceTime));
      if (!['hook', 'context'].includes(frame.beat)) { assert(frame.sourceTime >= previous - 1e-8); previous = frame.sourceTime; }
      for (const value of [...frame.camera.position, ...frame.camera.target, frame.camera.fov]) assert(Number.isFinite(value));
      cacheFrames++;
    }
    for (const event of take.impacts) assert(event.t >= take.start - 1e-8 && event.t <= take.start + take.duration + 1e-8);
  });
  near(offset, data.duration);
  assert(data.analysis.warnings.some(w => /Физическое время наблюдения одинаковое/.test(w)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

console.log(`Editing passed: ${allocations} integer-budget cases, ${plans} montage plans / ${sourceChecks} monotone source samples, ${audioChecks} unequal-take WAV fixtures, ${cacheFrames} cached frames with unchanged physical outcomes.`);
