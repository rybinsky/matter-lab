import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MaterialPenetration, DEFAULT_PENETRATION_PARAMETERS, penetrationEnergyBounds } from '../src/penetration.js';

const began = performance.now(), failures = [], results = [];
const near = (actual, expected, tolerance = 1e-8) => assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
const merge = (base, changes = {}) => ({ ...base, ...changes, projectile: { ...base.projectile, ...changes.projectile }, target: { ...base.target, ...changes.target }, integration: { ...base.integration, ...changes.integration } });
const cold = merge(DEFAULT_PENETRATION_PARAMETERS, { projectile: { temperature: 0 }, target: { thickness: 100, heatTransfer: 0, sideHeatTransfer: 0 }, gravity: 0 });
function check(name, run) {
  try { const evidence = run(); results.push({ name, passed: true, ...(evidence ? { evidence } : {}) }); console.log(`✓ ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); results.push({ name, passed: false, error: error.message }); console.log(`✗ ${name}: ${error.message}`); }
}
function bounded(state, config, tolerance = 1e-6) {
  for (const key of ['elapsed', 'depth', 'frontDepth', 'velocity', 'temperature', 'mechanicalDepth', 'meltDepth', 'meltedMass']) assert(Number.isFinite(state[key]), `${key} must be finite`);
  assert(state.depth >= 0 && state.depth <= config.target.thickness);
  assert(state.frontDepth + 1e-12 >= state.depth && state.frontDepth <= config.target.thickness);
  assert(state.velocity >= 0); assert(state.meltedMass >= 0);
  for (const key of ['kinetic', 'resistanceWork', 'yieldWork', 'dragWork', 'thermalMotionDissipation', 'projectileThermal', 'frontHeat', 'sideHeat', 'sensibleHeat', 'latentHeat', 'targetHeat']) assert(state.energies[key] >= -tolerance, `${key} may not be negative`);
  near(state.energies.mechanicalResidual, 0, tolerance);
  near(state.energies.thermalResidual, 0, tolerance);
  near(state.energies.sensibleHeat + state.energies.latentHeat, state.energies.targetHeat, tolerance);
  near(state.energies.resistanceWork, state.energies.yieldWork + state.energies.dragWork, tolerance);
  assert(state.meltedMass <= state.bounds.maximumMeltedMass + tolerance);
  assert(state.depth <= state.bounds.totalDepth + tolerance);
}

check('Constant resistance stops at the analytic work/energy depth and physical time', () => {
  const input = merge(cold, { target: { drag: 0 } }), body = input.projectile;
  const force = Math.PI * body.radius ** 2 * input.target.strength;
  const expectedDepth = .5 * body.mass * input.initialSpeed ** 2 / force;
  const model = new MaterialPenetration(input), state = model.step(100);
  near(state.depth, expectedDepth, 1e-12); near(state.mechanicalStoppedAt, body.mass * input.initialSpeed / force, 1e-12);
  near(state.velocity, 0); near(state.elapsed, 100); near(state.energies.resistanceWork, state.energies.initialKinetic, 1e-10);
  bounded(state, input); return { depth: state.depth, impactSeconds: state.mechanicalStoppedAt };
});

check('Poncelet strength plus quadratic drag matches its independent analytic stop integral', () => {
  const input = merge(cold, { gravity: 9.81 }), p = input.projectile, t = input.target;
  const area = Math.PI * p.radius ** 2, k = .5 * t.drag * t.density * area, force = area * t.strength - p.mass * input.gravity;
  const expected = p.mass / (2 * k) * Math.log(1 + k * input.initialSpeed ** 2 / force);
  const state = new MaterialPenetration(input).step(1);
  near(state.depth, expected, 1e-12); bounded(state, input);
  assert(state.depth < .5 * p.mass * input.initialSpeed ** 2 / force);
  return { depth: state.depth, impactSeconds: state.mechanicalStoppedAt };
});

check('Pure quadratic drag has no invented finite stopping threshold', () => {
  const input = merge(cold, { target: { strength: 0 } }), model = new MaterialPenetration(input), dt = .7;
  const b = .5 * input.target.drag * input.target.density * Math.PI * input.projectile.radius ** 2 / input.projectile.mass;
  const state = model.step(dt);
  near(state.velocity, input.initialSpeed / (1 + b * input.initialSpeed * dt), 1e-12);
  near(state.depth, Math.log(1 + b * input.initialSpeed * dt) / b, 1e-12);
  assert.equal(state.bounds.mechanicalStoppingDepth, null); assert.equal(state.mechanicalStoppedAt, null);
  bounded(state, input);
});

check('A resistance-free target preserves inertial motion and gravitational energy', () => {
  const input = merge(cold, { target: { strength: 0, drag: 0 }, gravity: 9.81 }), dt = .2;
  const state = new MaterialPenetration(input).step(dt);
  near(state.depth, input.initialSpeed * dt + .5 * input.gravity * dt ** 2, 1e-12);
  near(state.velocity, input.initialSpeed + input.gravity * dt, 1e-12);
  near(state.energies.resistanceWork, 0, 1e-10); bounded(state, input);
});

check('Own weight can overcome a weak target; terminal-speed branch remains analytic', () => {
  const input = merge(cold, { initialSpeed: 0, gravity: 9.81, target: { strength: 0 } }), dt = .3;
  const b = .5 * input.target.drag * input.target.density * Math.PI * input.projectile.radius ** 2 / input.projectile.mass;
  const terminal = Math.sqrt(input.gravity / b), omega = Math.sqrt(input.gravity * b);
  const state = new MaterialPenetration(input).step(dt);
  near(state.velocity, terminal * Math.tanh(omega * dt), 1e-12);
  near(state.depth, Math.log(Math.cosh(omega * dt)) / b, 1e-12); bounded(state, input);
});

check('Cold and subzero controls cannot create heat, melt or a later downward trajectory', () => {
  for (const temperature of [0, -30]) {
    const input = merge(DEFAULT_PENETRATION_PARAMETERS, { projectile: { temperature } }), model = new MaterialPenetration(input);
    const impact = model.step(.1), late = model.step(10000);
    near(late.depth, impact.depth, 1e-12); near(late.temperature, temperature); near(late.meltedMass, 0);
    near(late.energies.targetHeat, 0); assert.equal(late.phase, 'stopped'); bounded(late, input);
  }
});

check('A hot body with zero contact conductance cannot melt or continue penetrating', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS, { target: { heatTransfer: 0, sideHeatTransfer: 0 } });
  const model = new MaterialPenetration(input), first = model.step(1), state = model.step(3600);
  near(state.depth, first.depth, 1e-12); near(state.temperature, 1000); near(state.meltedMass, 0);
  bounded(state, input);
});

check('Finite-capacity Newton cooling and enthalpy-priced front melting match analytic limits', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS, { initialSpeed: 0, target: { sideHeatTransfer: 0 } });
  const model = new MaterialPenetration(input), seconds = 300, state = model.step(seconds);
  const p = input.projectile, t = input.target, area = Math.PI * p.radius ** 2, capacity = p.mass * p.specificHeat;
  const expectedT = t.meltTemperature + (p.temperature - t.meltTemperature) * Math.exp(-t.heatTransfer * area * seconds / capacity);
  const heat = capacity * (p.temperature - expectedT), enthalpy = t.latentHeat + t.specificHeat * (t.meltTemperature - t.temperature);
  near(state.temperature, expectedT, .002); near(state.frontDepth, heat / (t.density * area * enthalpy), 3e-6);
  near(state.energies.sensibleHeat / state.energies.latentHeat, t.specificHeat * (t.meltTemperature - t.temperature) / t.latentHeat, 1e-12);
  bounded(state, input); return { temperature: state.temperature, depth: state.depth, expectedT };
});

check('The g=0 and upward-axis controls may melt but cannot sink after the impact', () => {
  for (const gravity of [0, -9.81]) {
    const input = merge(DEFAULT_PENETRATION_PARAMETERS, { initialSpeed: 0, gravity }), state = new MaterialPenetration(input).step(600);
    near(state.depth, 0); near(state.velocity, 0); near(state.mechanicalDepth, 0);
    assert(state.frontDepth > 0 && state.meltedMass > 0); bounded(state, input);
  }
});

check('A rapidly melting front cannot pull a body faster or farther than free fall', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS, { initialSpeed: 0, target: { heatTransfer: 1e10, sideHeatTransfer: 0, liquidConductivity: 1e10 }, integration: { maxThermalStep: 1e-5 } });
  const seconds = .001, state = new MaterialPenetration(input).step(seconds);
  assert(state.frontDepth > state.depth * 100);
  near(state.depth, .5 * input.gravity * seconds ** 2, 1e-10); near(state.velocity, input.gravity * seconds, 1e-10);
  bounded(state, input);
});

check('Side heat costs real energy and cannot be reused as forward penetration', () => {
  const common = merge(DEFAULT_PENETRATION_PARAMETERS, { target: { thickness: 10 } });
  const noSide = new MaterialPenetration(merge(common, { target: { sideHeatTransfer: 0 } })).step(600);
  const side = new MaterialPenetration(merge(common, { target: { sideHeatTransfer: 200 } })).step(600);
  assert(side.sideMeltedMass > 0); assert(side.depth < noSide.depth); assert(side.temperature < noSide.temperature);
  near(side.frontDepth - side.mechanicalDepth, side.advancingMeltedMass / (common.target.density * Math.PI * common.projectile.radius ** 2), 1e-10);
  bounded(side, common);
});

check('Impact heat is bounded by displaced ice and never adds a second mechanical depth', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS, { target: { heatTransfer: 1e8, sideHeatTransfer: 0 } });
  const model = new MaterialPenetration(input), state = model.step(model.bounds.mechanicalStoppingTime);
  near(state.depth, state.bounds.mechanicalStoppingDepth, 1e-12); near(state.meltDepth, 0, 1e-12);
  assert(state.impactMeltedMass <= state.mechanicalDepth * input.target.density * Math.PI * input.projectile.radius ** 2 + 1e-10);
  bounded(state, input);
});

check('Mechanical exit is located inside a large step without spending work beyond the slab', () => {
  const input = merge(cold, { target: { thickness: .01 } }), state = new MaterialPenetration(input).step(1);
  near(state.depth, .01, 1e-12); assert(state.passed && state.passedAt > 0 && state.passedAt < .001); assert(state.velocity > 0);
  near(state.elapsed, 1); bounded(state, input);
});

check('Thermal breakthrough consumes the full channel enthalpy and respects both boundaries', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS, { initialSpeed: 0, target: { thickness: .05, sideHeatTransfer: 0 } });
  const state = new MaterialPenetration(input).step(1000), t = input.target, p = input.projectile;
  const required = t.thickness * t.density * Math.PI * p.radius ** 2 * (t.latentHeat + t.specificHeat * (t.meltTemperature - t.temperature));
  assert(state.passed); near(state.depth, t.thickness, 1e-12); near(state.frontDepth, t.thickness, 1e-12);
  near(state.energies.advancingHeat, required, 1e-5); assert(state.passedAt > 1 && state.passedAt < 1000);
  bounded(state, input); return { passedAt: state.passedAt, requiredJoules: required };
});

check('Finite heat cannot melt an arbitrarily long channel even after a long physical horizon', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS, { initialSpeed: 0, target: { thickness: 10, sideHeatTransfer: 0 }, integration: { maxThermalStep: 1 } });
  const state = new MaterialPenetration(input).step(30000);
  assert(!state.passed); assert(state.temperature >= 0 && state.temperature < 1e-5);
  assert(state.depth <= state.bounds.thermalDepth + 1e-8); near(state.frontDepth, state.bounds.thermalDepth, 1e-6);
  bounded(state, input, 1e-5); return { depth: state.depth, thermalBound: state.bounds.thermalDepth };
});

check('Physical clocks span milliseconds of impact and minutes of melting without a hidden scale', () => {
  const input = merge(DEFAULT_PENETRATION_PARAMETERS), model = new MaterialPenetration(input);
  const first = model.step(.001); assert.equal(first.phase, 'impact'); assert(first.mechanicalStoppedAt === null);
  const afterImpact = model.step(.009); assert(afterImpact.mechanicalStoppedAt < .01 && afterImpact.mechanicalStoppedAt > .001);
  const minutes = model.step(599.99); near(minutes.elapsed, 600, 1e-12);
  assert(minutes.mechanicalDepth < .06 && minutes.depth > .4 && minutes.depth < .5);
  bounded(minutes, input); return { impactSeconds: minutes.mechanicalStoppedAt, depthAfter600Seconds: minutes.depth };
});

check('Refining thermal steps converges; mechanical stopping is independent of caller subdivision', () => {
  const run = (maxThermalStep, split) => {
    const model = new MaterialPenetration(merge(DEFAULT_PENETRATION_PARAMETERS, { integration: { maxThermalStep } }));
    if (split) { for (let i = 0; i < 600; i++) model.step(1); } else model.step(600);
    return model.snapshot();
  };
  const coarse = run(1, false), medium = run(.5, false), fine = run(.25, false), reference = run(.0625, false), split = run(.25, true);
  const e0 = Math.abs(coarse.depth - reference.depth), e1 = Math.abs(medium.depth - reference.depth), e2 = Math.abs(fine.depth - reference.depth);
  assert(e1 < e0 && e2 < e1, `Expected convergent depths: ${[e0, e1, e2]}`);
  assert(e2 < 3e-6); near(split.depth, fine.depth, 1e-7); near(split.temperature, fine.temperature, 1e-4);
  for (const state of [coarse, medium, fine, reference, split]) { near(state.mechanicalDepth, reference.mechanicalDepth, 1e-12); bounded(state, DEFAULT_PENETRATION_PARAMETERS, 1e-5); }
  return { depthErrorsMetres: [e0, e1, e2], referenceDepth: reference.depth };
});

check('Analytic bounds survive serialization, parameter edits and zero-speed cases', () => {
  const input = structuredClone(DEFAULT_PENETRATION_PARAMETERS), copy = structuredClone(input), model = new MaterialPenetration(input);
  input.projectile.temperature = 0; input.target.strength = 0;
  near(model.snapshot().temperature, 1000); assert.deepEqual(model.bounds, penetrationEnergyBounds(copy));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(model.snapshot())));
  const still = new MaterialPenetration(merge(cold, { initialSpeed: 0 })).step(10);
  near(still.depth, 0); near(still.bounds.mechanicalStoppingDepth, 0); bounded(still, merge(cold, { initialSpeed: 0 }));
  const before = model.snapshot(); assert.deepEqual(model.step(0), before);
});

check('Invalid states and negative or non-finite physical time are rejected', () => {
  for (const changes of [{ initialSpeed: -1 }, { gravity: NaN }, { projectile: { mass: 0 } }, { target: { latentHeat: 0 } }, { target: { temperature: 1 } }, { integration: { maxThermalStep: 0 } }, { projectile: { temperature: Infinity } }]) assert.throws(() => new MaterialPenetration(changes));
  const model = new MaterialPenetration(); for (const dt of [-1, NaN, Infinity]) assert.throws(() => model.step(dt));
});

check('Dense caller samples at the exact finite stop resolve sub-ULP event remnants', () => {
  const model = new MaterialPenetration(), stop = model.bounds.mechanicalStoppingTime;
  for (const time of [.0001, .0005, .001, .002, .003, .004, .005, stop, .01, .1, 1]) model.step(time - model.elapsed);
  const state = model.snapshot(); near(state.elapsed, 1); near(state.mechanicalStoppedAt, stop, 1e-12);
  near(state.mechanicalDepth, state.bounds.mechanicalStoppingDepth, 1e-12); bounded(state, DEFAULT_PENETRATION_PARAMETERS);
});

console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, failed: failures.length, elapsedMs: performance.now() - began, results }, null, 2));
if (failures.length) process.exitCode = 1;
