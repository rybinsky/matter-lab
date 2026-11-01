/**
 * Bounded, one-dimensional laboratory impact/contact-melting model (SI units).
 *
 * This is a phenomenological sandbox model, not calibrated ice-impact data.
 * A rigid, flat-ended cylinder first does mechanical work against a Poncelet
 * resistance. Its finite heat subsequently melts an enthalpy-priced channel.
 * Gravity can move the body only into that channel. No film time is hidden here:
 * step(dt) always advances dt physical seconds. See work/reels-v12/penetration.
 */

export const DEFAULT_PENETRATION_PARAMETERS = Object.freeze({
  projectile: Object.freeze({ mass: 1, radius: .02, length: .1, specificHeat: 500, temperature: 1000 }),
  target: Object.freeze({
    thickness: 1, density: 917, temperature: -10, meltTemperature: 0,
    latentHeat: 334000, specificHeat: 2100,
    // These three effective coefficients are assumptions, not measurements.
    strength: 3e6, drag: 1, heatTransfer: 300, sideHeatTransfer: 20,
    liquidConductivity: .6,
  }),
  initialSpeed: 20,
  gravity: 9.81,
  integration: Object.freeze({ maxThermalStep: .25 }),
});

function number(value, name, { positive = false, nonnegative = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0) || (nonnegative && value < 0)) {
    throw new RangeError(`${name} must be a finite ${positive ? 'positive ' : nonnegative ? 'nonnegative ' : ''}number`);
  }
  return value;
}

function parameters(input = {}) {
  const p = { ...DEFAULT_PENETRATION_PARAMETERS.projectile, ...input.projectile };
  const t = { ...DEFAULT_PENETRATION_PARAMETERS.target, ...input.target };
  const integration = { ...DEFAULT_PENETRATION_PARAMETERS.integration, ...input.integration };
  for (const key of ['mass', 'radius', 'length', 'specificHeat']) number(p[key], `projectile.${key}`, { positive: true });
  number(p.temperature, 'projectile.temperature');
  for (const key of ['thickness', 'density', 'latentHeat', 'specificHeat', 'liquidConductivity']) number(t[key], `target.${key}`, { positive: true });
  for (const key of ['strength', 'drag', 'heatTransfer', 'sideHeatTransfer']) number(t[key], `target.${key}`, { nonnegative: true });
  number(t.temperature, 'target.temperature'); number(t.meltTemperature, 'target.meltTemperature');
  if (t.temperature > t.meltTemperature) throw new RangeError('The target must initially be solid at or below its melt temperature');
  const initialSpeed = number(input.initialSpeed ?? DEFAULT_PENETRATION_PARAMETERS.initialSpeed, 'initialSpeed', { nonnegative: true });
  const gravity = number(input.gravity ?? DEFAULT_PENETRATION_PARAMETERS.gravity, 'gravity');
  number(integration.maxThermalStep, 'integration.maxThermalStep', { positive: true });
  const area = Math.PI * p.radius ** 2, capacity = p.mass * p.specificHeat;
  const enthalpy = t.specificHeat * (t.meltTemperature - t.temperature) + t.latentHeat;
  for (const [name, value] of Object.entries({ area, capacity, enthalpy, yieldForce: area * t.strength, inertialDrag: .5 * area * t.drag * t.density })) {
    number(value, name, name === 'yieldForce' || name === 'inertialDrag' ? { nonnegative: true } : { positive: true });
  }
  for (const [name, value] of Object.entries({ initialKinetic: .5 * p.mass * initialSpeed ** 2, initialThermal: capacity * Math.max(0, p.temperature - t.meltTemperature), heatPerDepth: t.density * area * enthalpy })) {
    number(value, name, { nonnegative: true });
  }
  return Object.freeze({ projectile: Object.freeze(p), target: Object.freeze(t), integration: Object.freeze(integration), initialSpeed, gravity, area, capacity, enthalpy });
}

// Exact solution of dv/dt = a - b v² up to the first zero of v; v never reverses.
function stoppingTime(v, a, b) {
  if (v === 0 && a <= 0) return 0;
  if (a >= 0) return Infinity;
  return b === 0 ? v / -a : Math.atan(v * Math.sqrt(b / -a)) / Math.sqrt(-a * b);
}

function mechanicalMotion(v, a, b, dt) {
  if (dt === 0) return { distance: 0, velocity: v };
  const stop = stoppingTime(v, a, b), h = Math.min(dt, stop);
  if (b === 0) return { distance: Math.max(0, v * h + .5 * a * h * h), velocity: h >= stop ? 0 : Math.max(0, v + a * h) };
  if (a < 0) {
    const c = -a, u = Math.sqrt(c / b), w = Math.sqrt(c * b), angle = w * h;
    const logRatio = Math.log1p(-2 * Math.sin(angle / 2) ** 2 + (v / u) * Math.sin(angle));
    return { distance: Math.max(0, logRatio / b), velocity: h >= stop ? 0 : Math.max(0, u * Math.tan(Math.atan(v / u) - angle)) };
  }
  if (a === 0) return { distance: Math.log1p(b * v * h) / b, velocity: v / (1 + b * v * h) };
  const u = Math.sqrt(a / b), z = Math.sqrt(a * b) * h, tanh = Math.tanh(z);
  const logCosh = z < 20 ? Math.log1p(2 * Math.sinh(z / 2) ** 2) : z + Math.log1p(Math.exp(-2 * z)) - Math.LN2;
  return { distance: Math.max(0, (logCosh + Math.log1p((v / u) * tanh)) / b), velocity: u * (v + u * tanh) / (u + v * tanh) };
}

function mechanicalBounds(p) {
  const { projectile: body, target, area, gravity, initialSpeed } = p;
  const netResistance = area * target.strength - body.mass * gravity;
  const k = .5 * target.drag * target.density * area;
  let stoppingDepth = null, stopTime = null;
  if (initialSpeed === 0 && netResistance >= 0) { stoppingDepth = 0; stopTime = 0; }
  else if (netResistance > 0) {
    stoppingDepth = k === 0 ? body.mass * initialSpeed ** 2 / (2 * netResistance)
      : body.mass / (2 * k) * Math.log1p(k * initialSpeed ** 2 / netResistance);
    stopTime = stoppingTime(initialSpeed, -netResistance / body.mass, k / body.mass);
  }
  const initialThermal = p.capacity * Math.max(0, body.temperature - target.meltTemperature);
  const thermalDepth = initialThermal / (target.density * area * p.enthalpy);
  return {
    mechanicalStoppingDepth: stoppingDepth,
    mechanicalStoppingTime: stopTime,
    mechanicalDepthWithoutDrag: netResistance > 0 ? body.mass * initialSpeed ** 2 / (2 * netResistance) : stoppingDepth === 0 ? 0 : null,
    thermalDepth, maximumMeltedMass: initialThermal / p.enthalpy,
    totalDepth: Math.min(target.thickness, stoppingDepth === null ? target.thickness : stoppingDepth + thermalDepth),
  };
}

/** Null mechanical bounds mean that this force law has no finite stopping point. */
export function penetrationEnergyBounds(input = {}) { return mechanicalBounds(parameters(input)); }

// Exact finite-capacity cooling with frozen conductances. All heat goes to ice;
// a front cap prevents spending more heat than the available swept/front volume.
function cool(energy, capacity, frontConductance, sideConductance, dt, frontCap = Infinity) {
  const total = frontConductance + sideConductance;
  if (energy <= 0 || total <= 0 || dt <= 0) return { front: 0, side: 0 };
  const released = energy * -Math.expm1(-total * dt / capacity);
  const front = released * frontConductance / total;
  if (front <= frontCap) return { front, side: released - front };
  const fraction = Math.min(1, frontCap * total / (frontConductance * energy));
  const hit = -capacity / total * Math.log1p(-fraction);
  const untilHit = frontConductance > 0 ? frontCap * total / frontConductance : 0;
  const remainingEnergy = Math.max(0, energy - untilHit);
  const sideAfter = remainingEnergy * -Math.expm1(-sideConductance * Math.max(0, dt - hit) / capacity);
  return { front: frontCap, side: Math.max(0, untilHit - frontCap + sideAfter) };
}

// A moving unilateral support cannot pull the body downward. If it melts away
// faster than free fall, a gap opens; the body must subsequently fall across it.
function gravityMotion(depth, velocity, front0, front1, gravity, dt, supported = true) {
  if (dt <= 0 || gravity <= 0) return { depth, velocity: 0 };
  const freeDepth = depth + velocity * dt + .5 * gravity * dt * dt;
  if (!supported || freeDepth <= front1) return { depth: freeDepth, velocity: velocity + gravity * dt };
  return { depth: front1, velocity: Math.max(0, (front1 - front0) / dt) };
}

export class MaterialPenetration {
  constructor(input = {}) {
    this.parameters = parameters(input);
    const { projectile, target, gravity, area, capacity, initialSpeed } = this.parameters;
    this.elapsed = 0; this.depth = 0; this.velocity = initialSpeed; this.temperature = projectile.temperature;
    this.mechanicalDepth = 0; this.frontDepth = 0; this.passed = false; this.passedAt = null;
    this.mechanicalStoppedAt = null;
    this._a = gravity - area * target.strength / projectile.mass;
    this._b = .5 * target.drag * target.density * area / projectile.mass;
    this._mechanical = initialSpeed > 0 || this._a > 0;
    if (!this._mechanical) this.mechanicalStoppedAt = 0;
    this._heat = capacity * Math.max(0, projectile.temperature - target.meltTemperature);
    this._initialHeat = this._heat;
    this._initialKinetic = .5 * projectile.mass * initialSpeed ** 2;
    this._gravityWork = 0; this._resistanceWork = 0; this._yieldWork = 0; this._dragWork = 0;
    this._thermalMotionDissipation = 0;
    this._frontHeat = 0; this._sideHeat = 0; this._impactHeat = 0; this._advancingHeat = 0;
    this.bounds = mechanicalBounds(this.parameters);
  }

  _conductance(depth, frontDepth, frontPresent = frontDepth < this.parameters.target.thickness) {
    const { projectile: p, target: t, area } = this.parameters;
    const gap = Math.max(0, frontDepth - depth);
    const front = frontPresent && t.heatTransfer > 0 ? area / (1 / t.heatTransfer + gap / t.liquidConductivity) : 0;
    const side = 2 * Math.PI * p.radius * Math.min(p.length, Math.max(0, depth)) * t.sideHeatTransfer;
    return { front, side };
  }

  _applyHeat(heat, impact = false) {
    const { capacity, target } = this.parameters;
    const spent = heat.front + heat.side;
    this._heat = Math.max(0, this._heat - spent);
    this._frontHeat += heat.front; this._sideHeat += heat.side;
    if (impact) this._impactHeat += heat.front; else this._advancingHeat += heat.front;
    if (this._initialHeat > 0) this.temperature = target.meltTemperature + this._heat / capacity;
  }

  _mechanicalStep(dt) {
    const p = this.parameters, { projectile: body, target: t, area, gravity } = p;
    const stop = stoppingTime(this.velocity, this._a, this._b);
    let h = Math.min(dt, stop), motion = mechanicalMotion(this.velocity, this._a, this._b, h);
    const remaining = t.thickness - this.depth;
    if (motion.distance >= remaining) {
      let low = 0, high = h;
      for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (mechanicalMotion(this.velocity, this._a, this._b, mid).distance >= remaining) high = mid; else low = mid; }
      h = high; motion = mechanicalMotion(this.velocity, this._a, this._b, h); motion.distance = remaining;
      this.passed = true; this.passedAt = this.elapsed + h;
    }
    const oldK = .5 * body.mass * this.velocity ** 2, nextK = .5 * body.mass * motion.velocity ** 2;
    const work = oldK + body.mass * gravity * motion.distance - nextK;
    const yieldWork = area * t.strength * motion.distance;
    this._gravityWork += body.mass * gravity * motion.distance;
    this._resistanceWork += Math.max(0, work);
    this._yieldWork += yieldWork; this._dragWork += Math.max(0, work - yieldWork);
    // During impact, heat melts displaced fragments, not a second depth gain.
    const conductance = this._conductance(this.depth + motion.distance / 2, this.depth + motion.distance / 2, true);
    const heat = cool(this._heat, p.capacity, conductance.front, conductance.side, h, t.density * area * motion.distance * p.enthalpy);
    this._applyHeat(heat, true);
    this.depth += motion.distance; this.mechanicalDepth += motion.distance; this.frontDepth = this.depth;
    this.velocity = motion.velocity;
    if (!this.passed && h >= stop) { this._mechanical = false; this.velocity = 0; this.mechanicalStoppedAt = this.elapsed + h; }
    return h;
  }

  _thermalTrial(dt) {
    const p = this.parameters, { target: t, gravity, area, capacity } = p;
    const cap = Math.max(0, t.thickness - this.frontDepth) * t.density * area * p.enthalpy;
    const supported = this.frontDepth < t.thickness;
    const first = this._conductance(this.depth, this.frontDepth, supported);
    const halfHeat = cool(this._heat, capacity, first.front, first.side, dt / 2, cap);
    const halfFront = Math.min(t.thickness, this.frontDepth + halfHeat.front / (t.density * area * p.enthalpy));
    const halfMotion = gravityMotion(this.depth, this.velocity, this.frontDepth, halfFront, gravity, dt / 2, supported);
    const mid = this._conductance(halfMotion.depth, halfFront, supported);
    const heat = cool(this._heat, capacity, mid.front, mid.side, dt, cap);
    const frontDepth = Math.min(t.thickness, this.frontDepth + heat.front / (t.density * area * p.enthalpy));
    const motion = gravityMotion(this.depth, this.velocity, this.frontDepth, frontDepth, gravity, dt, supported);
    return { ...motion, frontDepth, heat };
  }

  _thermalStep(dt) {
    const { target: t, projectile: body, gravity } = this.parameters;
    let h = dt, trial = this._thermalTrial(h);
    const frontEvent = this.frontDepth < t.thickness && trial.frontDepth >= t.thickness;
    const exitEvent = trial.depth >= t.thickness;
    if (frontEvent || exitEvent) {
      let low = 0, high = h;
      for (let i = 0; i < 52; i++) {
        const mid = (low + high) / 2, sample = this._thermalTrial(mid);
        if ((frontEvent && sample.frontDepth >= t.thickness) || sample.depth >= t.thickness) high = mid; else low = mid;
      }
      h = high; trial = this._thermalTrial(h);
    }
    const nextDepth = Math.min(t.thickness, trial.depth), dx = Math.max(0, nextDepth - this.depth);
    const oldK = .5 * body.mass * this.velocity ** 2, nextK = .5 * body.mass * trial.velocity ** 2;
    const gravityWork = body.mass * gravity * dx;
    this._gravityWork += gravityWork;
    this._thermalMotionDissipation += Math.max(0, oldK + gravityWork - nextK);
    this._applyHeat(trial.heat);
    this.frontDepth = trial.frontDepth; this.depth = nextDepth; this.velocity = trial.velocity;
    if (this.depth >= t.thickness) { this.passed = true; this.passedAt = this.elapsed + h; }
    return h;
  }

  /** Advance physical seconds. Rendering speed belongs to the caller. */
  step(dtSeconds) {
    number(dtSeconds, 'dtSeconds', { nonnegative: true });
    if (!Number.isFinite(this.elapsed + dtSeconds)) throw new RangeError('Elapsed time must remain finite');
    const end = this.elapsed + dtSeconds;
    while (this.elapsed < end && !this.passed) {
      const remaining = end - this.elapsed;
      const contact = this._conductance(this.depth, this.frontDepth);
      const thermalActive = this._heat > 0 && (contact.front > 0 || contact.side > 0
        || (this._mechanical && this.parameters.target.sideHeatTransfer > 0));
      if (!this._mechanical && !thermalActive && this.frontDepth <= this.depth && this.velocity === 0) break;
      const dt = thermalActive ? Math.min(remaining, this.parameters.integration.maxThermalStep) : remaining;
      const wasMechanical = this._mechanical, hadFront = this.frontDepth < this.parameters.target.thickness;
      const used = this._mechanical ? this._mechanicalStep(dt) : this._thermalStep(dt);
      if (!(used > 0) || this.elapsed + used === this.elapsed) {
        // An exact event can fall below one ULP of an already accumulated clock.
        // Resolve that event without inventing a finite low-speed stopping rule.
        if ((wasMechanical && !this._mechanical) || this.passed || (hadFront && this.frontDepth >= this.parameters.target.thickness)) continue;
        throw new Error('Penetration integration did not advance physical time');
      }
      this.elapsed = Math.min(end, this.elapsed + used);
    }
    this.elapsed = end;
    return this.snapshot();
  }

  snapshot() {
    const p = this.parameters, { projectile: body, target: t, enthalpy } = p;
    const targetHeat = this._frontHeat + this._sideHeat;
    const kinetic = .5 * body.mass * this.velocity ** 2;
    const sensibleFraction = t.specificHeat * (t.meltTemperature - t.temperature) / enthalpy;
    const conducting = this._conductance(this.depth, this.frontDepth);
    const phase = this.passed ? 'passed' : this._mechanical ? 'impact'
      : this._heat > 0 && (conducting.front > 0 || conducting.side > 0) ? 'melting'
        : this.frontDepth > this.depth && p.gravity > 0 ? 'sinking' : 'stopped';
    return {
      elapsed: this.elapsed, depth: this.depth, velocity: this.velocity, temperature: this.temperature,
      mechanicalDepth: this.mechanicalDepth, meltDepth: Math.max(0, this.depth - this.mechanicalDepth),
      frontDepth: this.frontDepth, meltFrontDepth: Math.max(0, this.frontDepth - this.mechanicalDepth),
      meltedMass: targetHeat / enthalpy,
      advancingMeltedMass: this._advancingHeat / enthalpy,
      impactMeltedMass: this._impactHeat / enthalpy,
      sideMeltedMass: this._sideHeat / enthalpy,
      passed: this.passed, passedAt: this.passedAt, mechanicalStoppedAt: this.mechanicalStoppedAt, phase,
      energies: {
        initialKinetic: this._initialKinetic, kinetic, gravityWork: this._gravityWork,
        resistanceWork: this._resistanceWork, yieldWork: this._yieldWork, dragWork: this._dragWork,
        thermalMotionDissipation: this._thermalMotionDissipation,
        initialProjectileThermal: this._initialHeat, projectileThermal: this._heat,
        frontHeat: this._frontHeat, sideHeat: this._sideHeat,
        impactHeat: this._impactHeat, advancingHeat: this._advancingHeat,
        sensibleHeat: targetHeat * sensibleFraction, latentHeat: targetHeat * (1 - sensibleFraction), targetHeat,
        mechanicalResidual: this._initialKinetic + this._gravityWork - this._resistanceWork - this._thermalMotionDissipation - kinetic,
        thermalResidual: this._initialHeat - this._heat - targetHeat,
      },
      bounds: { ...this.bounds },
    };
  }
}
