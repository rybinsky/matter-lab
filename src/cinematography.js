/**
 * Event-first, scene-independent perspective-camera planner.
 *
 * Positions, bounds and velocities must use the SAME world units. `time`,
 * `duration` and `event.time` are on the edited movie clock, not a physics clock.
 * Camera planning never pauses, advances or otherwise changes the simulation.
 *
 * Input:
 * { time, duration, aspect, objects:[{id,position,bounds,quaternion?,velocity?,fixed?}],
 *   event?:{type,position?,time?,strength?,participants?:[id]}, focusId?,
 *   style?:'auto'|'follow'|'orbit'|'wide'|'macro', previous?,
 *   storyBeat?:'hook'|'context'|'anticipation'|'impact'|'follow'|'result',
 *   viewDirection?, actionAxis?, directing?, up?,
 *   obstacles?:[{id?,position|center,radius}], deltaTime?,
 *   safeFrame?:{top,bottom,left,right}, heroWidth?:.60, fov? }
 * `scene:[...]` and `scene:{objects:[...]}` are also accepted.
 *
 * Pass `previous:{...lastCamera,time:lastMovieTime}` for time-based smoothing.
 * Omit previous on an editorial cut; retain its `directing` separately to keep
 * the same action axis across cuts, or supply the same explicit viewDirection.
 * An explicit storyBeat overrides automatic
 * shot selection and works with hook -> setup -> action -> result montage.
 *
 * Output: {position:[x,y,z],target:[x,y,z],fov,hero,shot,reason,time,directing}.
 * The default frame reserves the upper 22% and lower 30% for text. Entire
 * rotated hero/participant bounding boxes, not just their centres, are protected.
 * Hero width targets 60% of the image. Optional nearby context may widen this
 * by at most 20%; large scenery never pulls an automatic hero shot far back.
 */

const EPS = 1e-9;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0, limit = 1e12) => Number.isFinite(x) ? clamp(x, -limit, limit) : fallback;
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (a, s) => a.map(x => x * s);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const distance = (a, b) => length(sub(a, b));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const normalized = (a, fallback = [0, 0, 1]) => length(a) > EPS ? mul(a, 1 / length(a)) : fallback.slice();
const vec = (value, fallback = [0, 0, 0]) => {
  const values = Array.isArray(value) || ArrayBuffer.isView(value) ? value : value && [value.x, value.y, value.z];
  return [0, 1, 2].map(i => finite(values?.[i], fallback[i]));
};
const validVec = value => {
  const a = Array.isArray(value) || ArrayBuffer.isView(value) ? value : value && [value.x, value.y, value.z];
  return !!a && a.length >= 3 && [a[0], a[1], a[2]].every(Number.isFinite);
};

function rotateAround(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
}

function angleBetween(a, b) { return Math.acos(clamp(dot(normalized(a), normalized(b)), -1, 1)); }
function approachDirection(from, to, radians) {
  const angle = angleBetween(from, to);
  if (angle <= radians || angle < 1e-7) return to.slice();
  // A deterministic great-circle interpolation also handles opposite vectors.
  let axis = cross(from, to);
  if (length(axis) < EPS) axis = cross(from, Math.abs(from[1]) < .8 ? [0, 1, 0] : [1, 0, 0]);
  return normalized(rotateAround(from, normalized(axis), radians));
}

function establishAxis(input, hero, participants, up) {
  if (validVec(input.viewDirection) && length(vec(input.viewDirection)) > EPS) return normalized(vec(input.viewDirection));
  const stored = input.directing?.axis || input.previous?.directing?.axis;
  if (validVec(stored) && length(vec(stored)) > EPS) return normalized(vec(stored));
  if (validVec(input.previous?.position) && validVec(input.previous?.target)) return normalized(sub(vec(input.previous.position), vec(input.previous.target)));
  const canonical = normalized([1, .45, 1.6]);
  let action = validVec(input.actionAxis) ? vec(input.actionAxis) : hero.velocity;
  action = sub(action, mul(up, dot(action, up)));
  if (length(action) < hero.diagonal * .1) {
    const other = participants.find(o => o.id !== hero.id);
    if (other) { action = sub(other.position, hero.position); action = sub(action, mul(up, dot(action, up))); }
  }
  if (length(action) < EPS) return canonical;
  action = normalized(action);
  // The action is an unsigned line: reversing a velocity cannot choose the
  // opposite side of that line. A take keeps this composition from now on.
  if (dot(action, canonical) < 0) action = mul(action, -1);
  let side = normalized(cross(up, action));
  if (dot(side, canonical) < 0) side = mul(side, -1);
  return normalized(add(add(mul(side, .86), mul(action, .32)), mul(up, .38)));
}

function quaternion(value) {
  const a = Array.isArray(value) || ArrayBuffer.isView(value) ? value : value && [value.x, value.y, value.z, value.w];
  if (!a || a.length < 4 || ![a[0], a[1], a[2], a[3]].every(Number.isFinite)) return [0, 0, 0, 1];
  const n = Math.hypot(a[0], a[1], a[2], a[3]);
  return n > EPS ? [a[0] / n, a[1] / n, a[2] / n, a[3] / n] : [0, 0, 0, 1];
}

function rotateQuaternion(v, q) {
  const u = q.slice(0, 3), uv = cross(u, v);
  return add(v, add(mul(uv, 2 * q[3]), mul(cross(u, uv), 2)));
}

function normalizeObject(raw, i) {
  const position = vec(raw.position);
  const b = vec(raw.bounds, [1, 1, 1]).map(x => clamp(Math.abs(x), .001, 1e9));
  return {
    id: raw.id == null ? `object-${i}` : String(raw.id),
    position, bounds: b, velocity: vec(raw.velocity), quaternion: quaternion(raw.quaternion),
    fixed: !!raw.fixed, diagonal: Math.hypot(...b),
  };
}

function corners(object, offset = [0, 0, 0]) {
  const result = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    result.push(add(add(object.position, offset), rotateQuaternion([x * object.bounds[0], y * object.bounds[1], z * object.bounds[2]], object.quaternion)));
  }
  return result;
}

function frameBasis(direction, up) {
  const forward = normalized(direction);
  let right = cross(up, forward);
  if (length(right) < .001) right = cross(Math.abs(forward[0]) < .8 ? [1, 0, 0] : [0, 0, 1], forward);
  right = normalized(right);
  return { direction: forward, right, up: normalized(cross(forward, right)) };
}

function frameLimits(raw = {}) {
  const top = clamp(finite(raw.top, .22), 0, .40);
  const bottom = clamp(finite(raw.bottom, .30), 0, .40);
  return {
    left: 1 - 2 * clamp(finite(raw.left, .08), 0, .40),
    right: 1 - 2 * clamp(finite(raw.right, .08), 0, .40),
    top: 1 - 2 * top,
    bottom: 1 - 2 * bottom,
  };
}

// Exact perspective inequalities for every world-space bounding-box corner.
function fitDistance(points, target, basis, tangent, aspect, safe, floor) {
  let result = Math.max(.02, floor);
  for (const point of points) {
    const delta = sub(point, target), x = dot(delta, basis.right), y = dot(delta, basis.up), z = dot(delta, basis.direction);
    result = Math.max(result, z + .015,
      z + Math.abs(x) / (tangent * aspect * (x < 0 ? safe.left : safe.right)),
      z + Math.abs(y) / (tangent * (y < 0 ? safe.bottom : safe.top)));
  }
  return result * 1.025;
}

function lineBlocked(camera, endpoint, obstacle) {
  const d = sub(endpoint, camera), m = sub(camera, obstacle.position), a = dot(d, d);
  if (a < EPS) return false;
  const b = 2 * dot(m, d), c = dot(m, m) - obstacle.radius ** 2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return false;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t > 1e-6 && t < 1 - 1e-5;
}

function obstructionCount(camera, endpoints, obstacles) {
  let count = 0;
  for (const obstacle of obstacles) {
    if (distance(camera, obstacle.position) < obstacle.radius * 1.015) count += 10;
    for (const endpoint of endpoints) {
      if (obstacle.id && endpoint.id === obstacle.id) continue;
      if (lineBlocked(camera, endpoint.position, obstacle)) count++;
    }
  }
  return count;
}

function avoidObstacles(target, preferredDirection, preferredDistance, points, endpoints, obstacles, up, tangent, aspect, safe, previousDirection, actionSide) {
  const preferredBasis = frameBasis(preferredDirection, up);
  const preferredPosition = add(target, mul(preferredBasis.direction, preferredDistance));
  if (!obstacles.length || !obstructionCount(preferredPosition, endpoints, obstacles)) {
    return { position: preferredPosition, direction: preferredBasis.direction, distance: preferredDistance, occluded: false, adjusted: false };
  }
  let best = null;
  // Stay on the established side of the action. Fine candidates and a cost for
  // changing the previous angle prevent alternating left/right detours.
  const angles = [0, .03, -.03, .06, -.06, .12, -.12, .2, -.2, .35, -.35, .6, -.6, .95, -.95, 1.31, -1.31];
  const directions = [previousDirection, ...angles.map(a => rotateAround(preferredBasis.direction, up, a))].filter(Boolean);
  for (const candidate of directions) {
    const direction = normalized(candidate);
    if (dot(direction, preferredBasis.direction) < .2 || dot(direction, actionSide) < .12) continue;
    const basis = frameBasis(direction, up);
    const fitted = fitDistance(points, target, basis, tangent, aspect, safe, preferredDistance);
    for (const factor of [1, 1.4, 2, 3.2, 5.5, 10, 20]) {
      const d = fitted * factor, position = add(target, mul(direction, d));
      const blocked = obstructionCount(position, endpoints, obstacles);
      const cost = blocked * 1000 + angleBetween(direction, preferredBasis.direction) * .5 +
        (previousDirection ? angleBetween(direction, previousDirection) * 3 : 0) + Math.log(Math.max(1, d / preferredDistance)) * .45;
      if (!best || cost < best.cost) best = { position, direction, distance: d, cost, occluded: blocked > 0, adjusted: true };
      if (!blocked) break;
    }
  }
  return best;
}

function chooseShot(input, time, duration, event, moving) {
  const requested = input.storyBeat;
  if (['hook', 'context', 'anticipation', 'impact', 'follow', 'result'].includes(requested)) return requested;
  if (input.style === 'wide') return 'wide';
  if (input.style === 'macro') return 'macro';
  if (input.style === 'follow') return 'follow';
  if (input.style === 'orbit') return 'orbit';
  const relative = event ? time - finite(event.time, time) : Infinity;
  if (event && relative >= -.18 && relative <= .6) return 'impact';
  if (event && relative >= -1.15 && relative < -.18) return 'anticipation';
  if (time >= duration - Math.min(1.8, duration * .15)) return 'result';
  if (time < .75) return 'hook';
  if (time < 1.5 && (!event || Math.abs(relative) > 1.2)) return 'context';
  return moving || event ? 'follow' : 'context';
}

export function planCamera(input = {}) {
  const time = Math.max(0, finite(input.time));
  const duration = Math.max(.25, finite(input.duration, 15));
  const aspect = clamp(Math.abs(finite(input.aspect, 9 / 16)), .15, 8);
  const fov = clamp(finite(input.fov, 40), 20, 75), tangent = Math.tan(fov * Math.PI / 360);
  const up = normalized(vec(input.up, [0, 1, 0]), [0, 1, 0]);
  const source = Array.isArray(input.objects) ? input.objects : Array.isArray(input.scene) ? input.scene : input.scene?.objects || [];
  const objects = source.filter(x => x && typeof x === 'object').slice(0, 2000).map(normalizeObject);
  const byId = new Map(objects.map(o => [o.id, o]));
  const event = input.event && typeof input.event === 'object' ? input.event : null;
  const participantIds = [...new Set((Array.isArray(event?.participants) ? event.participants : []).map(p => String(typeof p === 'object' ? p.id : p)))];
  const participants = participantIds.map(id => byId.get(id)).filter(Boolean);
  let hero = byId.get(String(input.focusId)) || byId.get(String(input.previous?.hero));
  if (!hero) hero = participants.find(o => !o.fixed) || objects.filter(o => !o.fixed).sort((a, b) => length(b.velocity) - length(a.velocity) || b.diagonal - a.diagonal)[0] || objects[0];
  if (!hero) return { position: [6, 4, 8], target: [0, 0, 0], fov, hero: null, shot: 'wide', reason: 'Пустая сцена: общий установочный ракурс.' };
  const moving = length(hero.velocity) > hero.diagonal * .15;
  const shot = chooseShot(input, time, duration, event, moving);
  const previous = input.previous;
  const canSmooth = previous && validVec(previous.position) && validVec(previous.target) && (!Number.isFinite(previous.time) || previous.time <= time);
  const dt = canSmooth ? clamp(finite(input.deltaTime, Number.isFinite(previous.time) ? time - previous.time : 1 / 60), 0, .25) : 1 / 60;
  const ease = seconds => 1 - Math.exp(-dt / seconds);
  const axis = establishAxis(input, hero, participants, up);
  const required = [...new Map([hero, ...participants].map(o => [o.id, o])).values()];
  const eventPoint = validVec(event?.position) ? vec(event.position) : null;
  const localRadius = Math.max(hero.diagonal * 8, ...required.map(o => distance(o.position, hero.position) + o.diagonal));
  const nearby = objects.filter(o => distance(o.position, hero.position) <= localRadius && o.diagonal <= Math.max(hero.diagonal * 14, localRadius * 2))
    .sort((a, b) => distance(a.position, hero.position) - distance(b.position, hero.position)).slice(0, 16);
  const contextual = ['context', 'wide', 'orbit', 'result'].includes(shot);
  const framed = shot === 'wide' ? objects : required;
  let target = hero.position.slice();
  if (eventPoint && ['hook', 'anticipation', 'impact'].includes(shot)) target = mix(target, eventPoint, shot === 'impact' ? .55 : .32);
  else if (required.length > 1) target = mix(target, required.reduce((v, o) => add(v, mul(o.position, 1 / required.length)), [0, 0, 0]), .45);
  if (contextual) {
    const allCorners = framed.flatMap(o => corners(o));
    const lo = [0, 1, 2].map(i => Math.min(...allCorners.map(p => p[i]))), hi = [0, 1, 2].map(i => Math.max(...allCorners.map(p => p[i])));
    target = mix(target, lo.map((v, i) => (v + hi[i]) / 2), shot === 'wide' ? 1 : .58);
  }
  const speed = length(hero.velocity), lookSeconds = shot === 'anticipation' ? .20 : .16;
  const leadDistance = Math.min(speed * lookSeconds, hero.diagonal * .7);
  const desiredLead = speed > EPS ? mul(hero.velocity, leadDistance / speed) : [0, 0, 0];
  const lead = canSmooth && validVec(previous.directing?.lead) ? mix(vec(previous.directing.lead), desiredLead, ease(.28)) : desiredLead;
  target = add(target, mul(lead, contextual ? .09 : .3));
  let direction = axis.slice();
  if (shot === 'orbit' && !validVec(input.viewDirection)) {
    const p = clamp(time / duration, 0, 1), arc = p * p * (3 - 2 * p) * .28;
    direction = rotateAround(axis, up, arc);
  }
  const points = framed.flatMap(o => corners(o));
  // Forecasting opens room for motion without shifting the actual simulation.
  if (!contextual && length(lead) > EPS) points.push(...corners(hero, lead));
  if (eventPoint && ['hook', 'anticipation', 'impact'].includes(shot)) points.push(eventPoint);
  const safe = frameLimits(input.safeFrame || input.safeArea);
  const heroWidth = clamp(finite(input.heroWidth, .60), .25, .84);
  const widths = { hook: 1.05, context: .85, anticipation: .95, impact: 1.05, follow: 1, result: .85, wide: .8, macro: 1.15, orbit: .95 };
  const desiredWidth = clamp(heroWidth * widths[shot], .25, .84);
  const framing = clamp(canSmooth && Number.isFinite(previous.directing?.framing) ? finite(previous.directing.framing) + (desiredWidth - previous.directing.framing) * ease(.65) : desiredWidth, .25, .84);
  const heroSafe = { ...safe, left: Math.min(safe.left, framing), right: Math.min(safe.right, framing) };
  let previousDistance = null;
  let previousDirection;
  if (canSmooth) {
    target = mix(vec(previous.target), target, ease(.24));
    previousDirection = normalized(sub(vec(previous.position), vec(previous.target)));
    // Obstacle detours return to the take's axis gradually. A new explicit
    // direction is an intentional instruction and takes effect immediately.
    const sameDirective = !validVec(input.viewDirection) || !validVec(previous.directing?.axis) || angleBetween(axis, vec(previous.directing.axis)) < 1e-6;
    if (sameDirective) direction = approachDirection(previousDirection, direction, .38 * dt);
    previousDistance = distance(vec(previous.position), vec(previous.target));
  }
  const basis = frameBasis(direction, up);
  const floor = Math.max(.05, hero.diagonal * .3);
  const hardFit = fitDistance(points, target, basis, tangent, aspect, safe, floor);
  const heroFit = fitDistance(corners(hero), target, basis, tangent, aspect, heroSafe, floor);
  let fitted = Math.max(heroFit, hardFit);
  // Scenery is already visible in the render. Only protect extra context when
  // that can be done without sacrificing the scale of the action's subjects.
  if (contextual && shot !== 'wide') {
    const limit = fitted * 1.2;
    for (const object of nearby) {
      if (framed.some(o => o.id === object.id)) continue;
      const extra = corners(object);
      const withContext = fitDistance([...points, ...extra], target, basis, tangent, aspect, safe, floor);
      if (withContext <= limit) fitted = Math.max(fitted, withContext);
    }
  }
  // Zoom-out takes priority over smoothing whenever a corner would leave frame.
  const dolly = previousDistance == null ? fitted : Math.exp(Math.log(Math.max(.01, previousDistance)) + (Math.log(fitted) - Math.log(Math.max(.01, previousDistance))) * ease(.48));
  const desiredDistance = Math.max(hardFit, dolly);
  const obstacles = (Array.isArray(input.obstacles) ? input.obstacles : []).filter(o => o && Number.isFinite(o.radius) && o.radius > 0)
    .map(o => ({ position: vec(o.position || o.center), radius: clamp(o.radius, .001, 1e10), id: o.id == null ? null : String(o.id) }))
    .filter(o => o.id !== hero.id);
  const endpoints = required.flatMap(o => [o.position, ...corners(o)].map(position => ({ id: o.id, position })));
  const result = avoidObstacles(target, basis.direction, desiredDistance, points, endpoints, obstacles, up, tangent, aspect, safe, previousDirection, axis);
  const reasons = {
    hook: 'Событие или его участники сразу в фокусе; ожидание не добавляется.',
    context: 'Короткое раскрытие ближайшего окружения.',
    anticipation: 'Показаны участники и пространство предстоящего взаимодействия.',
    impact: 'Крупный событийный план с защищёнными участниками.',
    follow: 'Сопровождение героя с запасом кадра по направлению движения.',
    result: 'Итоговый план связывает героя с окружением и участниками опыта.',
    wide: 'Общий план всей переданной сцены.',
    macro: 'Крупный план полного объёма героя.',
    orbit: 'Небольшое предсказуемое раскрытие формы вокруг героя.',
  };
  const reason = 'Сохранена сторона действия. ' + reasons[shot] + (result.adjusted ? result.occluded ? ' Полностью открыть героя мешает перекрывающая геометрия.' : ' Ракурс скорректирован, чтобы геометрия не закрывала героя.' : '');
  return { position: result.position.map(x => finite(x)), target: target.map(x => finite(x)), fov, hero: hero.id, shot, reason, time, directing: { axis, framing, lead } };
}
