import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SCENARIO_KITS, createScenarioKit } from '../src/scenario-kits.js';
import { validateProject } from '../src/validation.js';
import { initializePhysics, LabWorld } from '../src/physics.js';

// Actual Rapier runs, including a no-initiator control. No browser, renderer or
// per-kit physics. Fail if a scene works only because its targets fall by themselves.
await initializePhysics();
const started = performance.now(), reports = [];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const vector = p => ({ x: p.x, y: p.y, z: p.z });

function worldFor(project, control = false) {
  const omitted = new Set(control ? project.settings.scenarioKit.initiatorIds : []);
  const settings = structuredClone(project.settings);
  const lab = new LabWorld(settings, project.objects.filter(object => !omitted.has(object.id)));
  for (const [id, edit] of Object.entries(project.edits || {})) if (!omitted.has(id) && edit.launch) {
    lab.actions.push({ time: edit.launch.delay ?? .35, run: () => lab.launch(id, { ...settings, ...edit.launch }) });
  }
  return lab;
}

function radius(entity) {
  return entity.scale * Math.max(...entity.parts.map(part => Math.hypot(...(part.p || [0, 0, 0])) + Math.hypot(...part.d) * 1.2));
}

function initialIntersections(lab) {
  const entities = lab.entities, radii = new Map(entities.map(entity => [entity.id, radius(entity)])), penetrations = [];
  for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
    const a = entities[i], b = entities[j];
    if (a.fixed && b.fixed) continue;
    if (distance(a.body.translation(), b.body.translation()) > radii.get(a.id) + radii.get(b.id)) continue;
    let deepest = 0;
    for (const ac of a.colliders) for (const bc of b.colliders) {
      const contact = ac.contactCollider(bc, 0);
      if (contact) deepest = Math.min(deepest, contact.distance);
    }
    if (deepest < -.0015) penetrations.push({ a: a.id, b: b.id, depth: -deepest });
  }
  return penetrations;
}

function simulate(project, control = false) {
  const lab = worldFor(project, control), metadata = project.settings.scenarioKit;
  try {
    const origins = new Map(lab.entities.map(entity => [entity.id, vector(entity.body.translation())]));
    const maximum = new Map(), movedAt = new Map(), crossed = new Set(), toppled = new Set();
    const sampleCount = Math.round(project.settings.simulationDuration * 120);
    let maxSpeed = 0;
    for (let step = 0; step < sampleCount; step++) {
      lab.step(1 / 120);
      for (const entity of lab.entities) if (!entity.fixed) {
        const position = entity.body.translation(), speed = entity.body.linvel();
        assert.ok([position.x, position.y, position.z, speed.x, speed.y, speed.z].every(Number.isFinite), `${entity.id}: non-finite motion`);
        assert.ok(Math.abs(position.x) < 150 && position.y > -2 && position.y < 80 && Math.abs(position.z) < 150, `${entity.id}: escaped sensible scene bounds`);
        const displacement = distance(position, origins.get(entity.id));
        maximum.set(entity.id, Math.max(maximum.get(entity.id) || 0, displacement));
        const rotation = entity.body.rotation();
        if (1 - 2 * (rotation.x ** 2 + rotation.z ** 2) < .5) toppled.add(entity.id);
        if (displacement > .2 && !movedAt.has(entity.id)) movedAt.set(entity.id, lab.time);
        if (metadata.finishZ !== undefined && position.z < metadata.finishZ) crossed.add(entity.id);
        maxSpeed = Math.max(maxSpeed, Math.hypot(speed.x, speed.y, speed.z));
      }
    }
    const movedTargets = metadata.targetIds.filter(id => (maximum.get(id) || 0) > .2);
    const movedChain = (metadata.chainIds || []).filter(id => (maximum.get(id) || 0) > .2);
    return {
      movedTargets: movedTargets.length, targetCount: metadata.targetIds.length,
      toppledTargets: metadata.targetIds.filter(id => toppled.has(id)).length,
      targetsOverOneMetre: metadata.targetIds.filter(id => (maximum.get(id) || 0) > 1).length,
      targetIds: movedTargets, movedChain: movedChain.length, chainCount: metadata.chainIds?.length || 0,
      firstTargetTime: Math.min(...metadata.targetIds.map(id => movedAt.get(id) ?? Infinity)),
      maxSpeed: Number(maxSpeed.toFixed(3)), contacts: lab.impacts.length,
      crossedInitiators: metadata.initiatorIds.filter(id => crossed.has(id)).length,
      finalHero: vector(lab.find(project.settings.focusId)?.body.translation() || { x: 0, y: 0, z: 0 }),
    };
  } finally { lab.dispose(); }
}

const selected = process.argv[2] ? SCENARIO_KITS.filter(kit => kit.id === process.argv[2]) : SCENARIO_KITS;
assert.ok(selected.length, 'Unknown scenario kit');
for (const kit of selected) {
  const project = createScenarioKit(kit.id);
  assert.equal(validateProject(project), project);
  assert.equal(project.settings.experiment, 'blank');
  assert.ok(project.objects.length <= 150);
  assert.ok(project.settings.generators.length > 0, 'The saved layout recipes must remain editable');
  assert.ok(project.objects.some(object => object.id === project.settings.cameraHints.hero));
  assert.ok(project.settings.cameraHints.context.every(id => project.objects.some(object => object.id === id)));
  const second = createScenarioKit(kit.id), json = JSON.stringify(second);
  project.settings.story.title = 'Edited copy';
  assert.equal(JSON.stringify(second), json, 'Kit factories must not share mutable project data');
  const clean = JSON.parse(json), lab = worldFor(clean);
  let overlaps;
  try {
    overlaps = initialIntersections(lab);
    if (kit.id === 'banana-avalanche') assert.ok(lab.entities.filter(entity => entity.asset === 'banana').every(entity => entity.colliders.length >= 9), 'Bananas must retain their compound colliders');
  } finally { lab.dispose(); }
  assert.equal(overlaps.length, 0, `${kit.id}: initial intersections: ${JSON.stringify(overlaps.slice(0, 8))}`);
  const action = simulate(clean), control = simulate(clean, true);
  assert.equal(control.movedTargets, 0, `${kit.id}: targets collapse without an initiator`);
  assert.equal(control.toppledTargets, 0, `${kit.id}: targets topple without an initiator`);
  assert.ok(action.movedTargets >= (kit.id === 'duck-relay' ? 4 : kit.id === 'armchair-bowling' ? 7 : 3), `${kit.id}: weak target response: ${JSON.stringify(action)}`);
  assert.ok(action.toppledTargets >= (kit.id === 'armchair-bowling' ? 2 : kit.id === 'duck-relay' ? 4 : 5), `${kit.id}: targets merely slide without a visible change of pose`);
  assert.ok(action.targetsOverOneMetre >= (kit.id === 'armchair-bowling' ? 8 : kit.id === 'duck-relay' ? 4 : 5), `${kit.id}: the visible response is too small`);
  if (kit.id === 'banana-avalanche') assert.ok(action.crossedInitiators >= 5, `At least five bananas should breach the finishing line: ${JSON.stringify(action)}`);
  if (kit.id === 'duck-relay') {
    assert.ok(action.movedChain >= action.chainCount * .9, 'The relay must reach the distant branches');
    assert.ok(action.targetIds.some(id => id.startsWith('relay-tower-0')) && action.targetIds.some(id => id.startsWith('relay-tower-1')), 'Both finish towers must be reached');
  }
  const report = { id: kit.id, objects: clean.objects.length, initialIntersections: overlaps.length, action, control };
  reports.push(report);
  console.log(`✓ ${kit.title}: ${action.movedTargets}/${action.targetCount} targets, ${action.toppledTargets} toppled, ${action.targetsOverOneMetre} moved >1 m, ${action.movedChain}/${action.chainCount} chain links, control ${control.movedTargets}, ${clean.objects.length} editable objects`);
}
assert.throws(() => createScenarioKit('missing-kit'), /Неизвестный/);
console.log(JSON.stringify({ elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)), reports }, null, 2));
