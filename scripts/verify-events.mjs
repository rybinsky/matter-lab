import assert from 'node:assert/strict';
import { salientEvent, chooseHero } from '../src/scene-analysis.js';
import { createScenarioKit } from '../src/scenario-kits.js';
import { initializePhysics, LabWorld } from '../src/physics.js';

const event = (t, participants, strength = .1) => ({ t, type: 'impact', participants, strength, position: [0, .5, 0] });
const object = (id, distance = 0, speed = 0, fixed = false) => ({ id, distance, position: [distance, .5, 0], velocity: [speed, 0, 0], fixed });
const frame = (time, movedObjects = 0, objects = []) => ({ stats: { time, movedObjects, movementThreshold: .2, metric: { value: movedObjects } }, objects, hero: objects.find(o => o.id === 'source') });
let passed = 0;
function check(name, run) { run(); console.log(`✓ ${name}`); passed++; }

check('A weak live target contact beats floor and fixed-scenery force peaks', () => {
  const frames = [frame(0, 0, [object('source', 0, 2), object('target'), object('decor', 0, 0, true)]), frame(.6, 0, [object('source', 1, 1), object('target', .08, 1)]), frame(.7, 1, [object('target', .3, 1)])];
  const events = [event(.5, ['source', 'decor'], 1), event(.65, ['source', 'ground'], 9999), event(.6, ['source', 'target'], .01), event(.9, ['target', 'ground'], 1)];
  const before = JSON.stringify({ events, frames });
  const selected = salientEvent(events, 'source', frames, { targetIds: ['target'], initiatorIds: ['source'] });
  assert.deepEqual(selected.participants, ['source', 'target']);
  assert.equal(selected.time, .6); assert.equal(selected.reason, 'target-contact');
  assert.equal(JSON.stringify({ events, frames }), before, 'Selection mutated source data');
});

check('Early static contacts do not replace the later onset of the real reaction', () => {
  const frames = [frame(0, 0, [object('source'), object('target')]), frame(.25, 0, [object('source'), object('target')]), frame(.5, 0, [object('source'), object('target')]), frame(2, 0, [object('source', .1, 1), object('target', .1, 1)]), frame(2.1, 1, [object('target', .3, 1)])];
  const selected = salientEvent([event(.25, ['source', 'target'], 1), event(2, ['source', 'target'], .02)], 'source', frames, { targetIds: ['target'] });
  assert.equal(selected.time, 2);
});

check('An indirect chain contact at the chosen finish beats its strong initiating hit', () => {
  const frames = [frame(0, 0, [object('source', 0, 3), object('finish')]), frame(1, 0, [object('source', 1, 0), object('finish')]), frame(7, 0, [object('relay', .3, 1), object('finish', .1, .6)]), frame(7.1, 1, [object('finish', .3, .7)])];
  const selected = salientEvent([event(.7, ['source', 'first-link'], 1), event(7, ['last-link', 'finish'], .01)], 'source', frames, { targetIds: ['finish'], initiatorIds: ['source'] });
  assert.equal(selected.time, 7); assert.equal(selected.reason, 'target-contact');
});

check('Sparse observations fall back to the first movedObjects increase, not its largest jump', () => {
  const frames = [{ stats: { time: 0, movedObjects: 0 } }, { stats: { time: 1, movedObjects: 0 } }, { stats: { time: 1.2, movedObjects: 1 } }, { stats: { time: 2.5, movedObjects: 9 } }];
  const selected = salientEvent([event(.8, ['source', 'ground'], 1)], 'source', frames, { targetIds: ['target'] });
  assert.equal(selected.time, 1.2); assert.equal(selected.reason, 'observed-target-reaction');
});

check('Visible stationary targets are not credited for an unrelated global counter change', () => {
  const frames = [frame(0, 0, [object('target')]), frame(.5, 10, [object('target')])];
  const selected = salientEvent([event(.5, ['source', 'ground'], 1)], 'source', frames, { targetIds: ['target'] });
  assert.equal(selected.type, 'launch');
});

check('An explicitly selected fixed target remains a valid collision target', () => {
  const frames = [frame(0, 0, [object('source', 0, 2), object('ground', 0, 0, true)]), frame(.5, 0, [object('source', .1, 2), object('ground', 0, 0, true)])];
  const selected = salientEvent([event(.5, ['source', 'ground'], .5)], 'source', frames, { targetIds: ['ground'] });
  assert.equal(selected.reason, 'target-contact'); assert.equal(selected.time, .5);
});

check('Existing three-argument calls and empty options remain equivalent', () => {
  const events = [event(.5, ['other', 'other-two'], .6), event(.6, ['source', 'other'], .3)], frames = [frame(0)];
  const selected = salientEvent(events, 'source', frames);
  assert.deepEqual(selected, salientEvent(events, 'source', frames, {}));
  assert.equal(selected.time, .6);
  const metricFrames = [frame(0), frame(1, 1), frame(2, 6)];
  assert.equal(salientEvent([], 'source', metricFrames).time, 2, 'Unscoped continuous-phenomenon fallback changed');
  assert.equal(salientEvent([], '', []).type, 'launch');
});

await initializePhysics();
function capturePhysicalSamples(project) {
  const lab = new LabWorld(project.settings, project.objects);
  try {
    for (const [id, edit] of Object.entries(project.edits)) if (edit.launch) lab.actions.push({ time: edit.launch.delay, run: () => lab.launch(id, edit.launch) });
    const origins = new Map(lab.entities.map(entity => { const p = entity.body.translation(); return [entity.id, [p.x, p.y, p.z]]; }));
    const frames = [];
    for (let index = 0; index <= Math.round(project.settings.simulationDuration * 60); index++) {
      while (lab.time + 1e-7 < index / 60) lab.step();
      const objects = lab.entities.filter(entity => entity.id !== 'ground').map(entity => {
        const p = entity.body.translation(), v = entity.body.linvel(), origin = origins.get(entity.id);
        return { id: entity.id, position: [p.x, p.y, p.z], initialPosition: origin, distance: Math.hypot(p.x - origin[0], p.y - origin[1], p.z - origin[2]), velocity: [v.x, v.y, v.z], fixed: entity.fixed, mass: entity.body.mass() };
      });
      const stats = lab.stats(); stats.movementThreshold = .2; stats.metric = { value: stats.movedObjects };
      frames.push({ stats, objects, measuredChanges: lab.measuredChanges(), hero: chooseHero(objects, project.settings.focusId) });
    }
    return { frames, events: structuredClone(lab.impacts) };
  } finally { lab.dispose(); }
}

for (const id of ['banana-avalanche', 'duck-relay']) {
  const project = createScenarioKit(id), { frames, events } = capturePhysicalSamples(project);
  const { targetIds, initiatorIds } = project.settings.scenarioKit, targets = new Set(targetIds);
  const options = { targetIds, initiatorIds };
  const firstReaction = frames.find(sample => sample.stats.movedObjects > 0)?.stats.time;
  assert.ok(Number.isFinite(firstReaction), `${id}: no physical target reaction`);
  check(`${id}: actual target onset beats an injected floor-force spike`, () => {
    const noisy = [...events, event(firstReaction + .15, ['ground', initiatorIds[0]], 10000)];
    const selected = salientEvent(noisy, project.settings.focusId, frames, options);
    assert.ok(['target-contact', 'observed-target-reaction'].includes(selected.reason), JSON.stringify(selected));
    assert.ok(Math.abs(selected.time - firstReaction) < .5, `${id}: event is far from the observed onset: ${JSON.stringify(selected)}`);
    assert.ok(!selected.participants.includes('ground'), JSON.stringify(selected));
    console.log(`  event ${selected.time.toFixed(3)} s · observed reaction ${firstReaction.toFixed(3)} s · ${selected.reason}`);
  });
  check(`${id}: missing engine target events use the first observed response`, () => {
    const filtered = events.filter(impact => !impact.participants.some(participant => targets.has(participant)));
    const selected = salientEvent(filtered, project.settings.focusId, frames, options);
    assert.equal(selected.reason, 'observed-target-reaction');
    assert.ok(Math.abs(selected.time - firstReaction) <= 1 / 60 + 1e-7, JSON.stringify(selected));
    const sparse = frames.map(sample => ({ stats: sample.stats, hero: sample.hero }));
    assert.ok(Math.abs(salientEvent(filtered, project.settings.focusId, sparse, options).time - firstReaction) <= 1 / 60 + 1e-7);
  });
}
console.log(`${passed} event-selection checks passed.`);
