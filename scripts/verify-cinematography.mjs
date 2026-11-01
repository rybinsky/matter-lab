import assert from 'node:assert/strict';
import { planCamera } from '../src/cinematography.js';

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => mul(a, 1 / Math.hypot(...a));
let frames = 0;
let continuityFrames = 0, largestAngleStep = 0;
const outward = camera => norm(sub(camera.position, camera.target));
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));
function continuous(before, after, limit = Math.PI / 180) {
  const step = angle(outward(before), outward(after));
  largestAngleStep = Math.max(largestAngleStep, step); continuityFrames++;
  assert(step <= limit, `Camera turned ${(step * 180 / Math.PI).toFixed(3)}° in one frame`);
}

function worldCorners(object) {
  const q = object.quaternion || [0, 0, 0, 1], u = q.slice(0, 3), out = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    const p = [x * object.bounds[0], y * object.bounds[1], z * object.bounds[2]], uv = cross(u, p);
    out.push(add(object.position, add(p, add(mul(uv, 2 * q[3]), mul(cross(u, uv), 2)))));
  }
  return out;
}

function check(camera, objects, aspect = 9 / 16, up = [0, 1, 0]) {
  frames++;
  assert(camera && ['position', 'target'].every(k => camera[k].length === 3 && camera[k].every(Number.isFinite)));
  assert(Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 90);
  assert.equal(typeof camera.reason, 'string');
  const outward = norm(sub(camera.position, camera.target));
  let right = cross(up, outward); if (Math.hypot(...right) < .001) right = cross(Math.abs(outward[0]) < .8 ? [1, 0, 0] : [0, 0, 1], outward);
  right = norm(right); const vertical = norm(cross(outward, right));
  const tan = Math.tan(camera.fov * Math.PI / 360);
  for (const object of objects) for (const p of worldCorners(object)) {
    const ray = sub(p, camera.position), depth = -dot(ray, outward);
    assert(depth > 0, `${object.id} behind camera`);
    const x = dot(ray, right) / (depth * tan * aspect), y = dot(ray, vertical) / (depth * tan);
    assert(x >= -.84001 && x <= .84001, `${object.id} outside horizontal safe frame: ${x}`);
    assert(y >= -.40001 && y <= .56001, `${object.id} outside vertical safe frame: ${y}`);
  }
}

function blocks(camera, point, obstacle) {
  const d = sub(point, camera), m = sub(camera, obstacle.position), a = dot(d, d), b = 2 * dot(m, d), c = dot(m, m) - obstacle.radius ** 2;
  const disc = b * b - 4 * a * c; if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > .000001 && t < .99999;
}

// Moving, rotating hero: all eight corners remain protected on every frame.
{
  let previous;
  for (let i = 0; i <= 160; i++) {
    const time = i / 60, angle = time * .6;
    const hero = { id: 'moving', position: [time * 9, 2 + time * 5 - 2 * time * time, Math.sin(time) * 2], bounds: [.8, .6, .7], velocity: [9, 5 - 4 * time, Math.cos(time) * 2], quaternion: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] };
    const camera = planCamera({ time, duration: 6, objects: [hero], previous });
    check(camera, [hero]); previous = { ...camera, time };
  }
}

// Impact pair: protect both colliding bodies rather than their midpoint alone.
{
  let previous;
  for (let i = 0; i <= 90; i++) {
    const time = i / 60;
    const a = { id: 'a', position: [-2 + Math.min(time, .5) * 3, 1, 0], bounds: [1, 1, 1], velocity: [time < .5 ? 3 : -2, 0, 0] };
    const b = { id: 'b', position: [1, 1, .2], bounds: [.7, 1.5, .7], velocity: [0, 0, 0] };
    const event = { type: 'impact', time: .5, position: [.4, 1, 0], strength: .8, participants: ['a', 'b'] };
    const camera = planCamera({ time, duration: 4, objects: [a, b], event, focusId: 'a', previous });
    check(camera, [a, b]); previous = { ...camera, time };
  }
}

// A ten-by-eight-metre environment, including a rotated long object.
{
  const objects = [
    { id: 'room', fixed: true, position: [0, -.1, 0], bounds: [10, .2, 8] },
    { id: 'table', position: [-3, 1, -2], bounds: [2.4, 1.8, 1.2] },
    { id: 'bar', position: [3, 2, 3], bounds: [4, .3, .3], quaternion: [0, 0, Math.sin(.4), Math.cos(.4)] },
  ];
  for (const aspect of [9 / 16, 1, 16 / 9]) {
    const camera = planCamera({ time: 1, duration: 15, aspect, objects, style: 'wide' });
    check(camera, objects, aspect);
  }
}

// No waiting reveal can pre-empt an imminent event; montage can set exact beats.
{
  const objects = [{ id: 'hero', position: [0, 1, 0], bounds: [1, 1, 1], velocity: [1, 0, 0] }];
  const event = { type: 'impact', time: .9, participants: ['hero'], position: [0, 1, 0] };
  const camera = planCamera({ time: .8, duration: 15, objects, event });
  assert.equal(camera.shot, 'impact'); check(camera, objects);
  for (const storyBeat of ['hook', 'context', 'anticipation', 'impact', 'follow', 'result']) {
    const c = planCamera({ time: 3, duration: 15, objects, event, storyBeat });
    assert.equal(c.shot, storyBeat); check(c, objects);
  }
}

// Spherical occluder: camera must leave the obstruction and find a visible side.
{
  const hero = { id: 'hero', position: [0, 0, 0], bounds: [.4, .6, .4] };
  const obstacle = { position: [0, 0, 2], radius: .8 };
  const camera = planCamera({ time: 3, duration: 8, objects: [hero], viewDirection: [0, .08, 1], obstacles: [obstacle], style: 'macro' });
  check(camera, [hero]);
  assert(Math.hypot(...sub(camera.position, obstacle.position)) > obstacle.radius);
  assert(!blocks(camera.position, hero.position, obstacle));
}

// A large spherical world: no experiment identifiers or hardcoded planet names.
{
  let previous;
  const obstacle = { id: 'sphere', position: [0, 0, 0], radius: 3.47 };
  for (let i = 0; i <= 90; i++) {
    const time = i / 12, angle = time * .65;
    const hero = { id: 'traveller', position: [3.8 * Math.cos(angle), 3.8 * Math.sin(angle), 0], bounds: [.20, .12, .12], velocity: [-2.47 * Math.sin(angle), 2.47 * Math.cos(angle), 0] };
    const camera = planCamera({ time, duration: 8, objects: [hero], viewDirection: [0, 0, 1], obstacles: [obstacle], previous });
    check(camera, [hero]);
    assert(Math.hypot(...sub(camera.position, obstacle.position)) > obstacle.radius);
    assert(!blocks(camera.position, hero.position, obstacle));
    previous = { ...camera, time };
  }
}

// Empty/malformed input stays finite; input data is never mutated.
{
  for (const input of [{}, { time: NaN, duration: Infinity, aspect: 0 }, { objects: [{ id: 'bad', position: [Infinity, NaN, 2], bounds: [NaN, -2, 0], quaternion: [0, 0, 0, 0] }] }]) {
    const camera = planCamera(input); check(camera, []);
  }
  const input = { time: 1.7, duration: 5, objects: [{ id: 'a', position: [1, 2, 3], bounds: [1, 2, 1], velocity: [1, 0, 0] }] };
  const saved = JSON.stringify(input), a = planCamera(input), b = planCamera(input);
  assert.equal(JSON.stringify(input), saved); assert.deepEqual(a, b); check(a, input.objects);
}

// Automatic context cannot shrink the hero to accommodate giant scenery.
{
  const hero = { id: 'hero', position: [0, 1, 0], bounds: [1, 1, 1] };
  const scenery = [
    { id: 'ground', fixed: true, position: [0, -.5, 0], bounds: [1000, 1, 1000] },
    { id: 'big-prop', fixed: true, position: [4, 2, 0], bounds: [20, 20, 20] },
  ];
  for (const storyBeat of ['hook', 'context', 'result']) {
    const base = planCamera({ objects: [hero], focusId: 'hero', storyBeat });
    const camera = planCamera({ objects: [hero, ...scenery], focusId: 'hero', storyBeat });
    check(camera, [hero]);
    assert(Math.hypot(...sub(camera.position, camera.target)) <= 1.201 * Math.hypot(...sub(base.position, base.target)));
  }
}

// Velocity reversals and a curved path cannot move the camera to the opposite
// side. Shot changes and a transfer to another hero preserve the same take axis.
{
  let previous, firstAxis;
  for (let i = 0; i <= 300; i++) {
    const time = i / 60, leg = Math.floor(time), local = time - leg;
    const x = leg % 2 ? 2 - 4 * local : -2 + 4 * local;
    const a = { id: 'bouncing', position: [x, 1, Math.sin(time) * .3], bounds: [.8, .6, .7], velocity: [leg % 2 ? -4 : 4, 0, Math.cos(time) * .3] };
    const b = { id: 'receiving', position: [x + .2, 1.1, Math.sin(time) * .3], bounds: [.7, .5, .6], velocity: a.velocity };
    const storyBeat = time < .5 ? 'hook' : time < 1 ? 'anticipation' : time < 1.3 ? 'impact' : time < 3.5 ? 'follow' : 'result';
    const focusId = time < 3 ? a.id : b.id;
    const camera = planCamera({ time, duration: 6, objects: [a, b], focusId, storyBeat, previous });
    check(camera, [focusId === a.id ? a : b]);
    firstAxis ||= camera.directing.axis;
    assert(angle(firstAxis, camera.directing.axis) < 1e-7);
    if (previous) continuous(previous, camera);
    previous = camera;
  }
  // Editorial cuts reset composition but retain the direction of the take.
  const hero = { id: 'cut-hero', position: [0, 1, 0], bounds: [1, 1, 1], velocity: [-100, 0, 100] };
  const cut = planCamera({ time: 6, objects: [hero], directing: previous.directing, storyBeat: 'context' });
  check(cut, [hero]); assert(angle(firstAxis, outward(cut)) < 1e-7);
}

// Explicit angles override motion and orbit style. Every beat respects the
// requested side, including a hard velocity reversal at the shot boundary.
{
  let previous;
  const direction = norm([-.6, .25, 1]);
  for (let i = 0; i < 180; i++) {
    const hero = { id: 'explicit', position: [Math.sin(i / 30), 1, 0], bounds: [.6, .8, .5], velocity: [i < 90 ? 10 : -10, 0, 0] };
    const storyBeat = ['impact', 'follow', 'result'][Math.floor(i / 60)];
    const camera = planCamera({ time: i / 60, duration: 4, objects: [hero], viewDirection: direction, style: 'orbit', storyBeat, previous });
    check(camera, [hero]); assert(angle(direction, outward(camera)) < 1e-7);
    if (previous) continuous(previous, camera);
    previous = camera;
  }
}

// The result opens up gradually; a new shot must not instantly change lens
// distance or attention on a static scene. Bounds remain protected throughout.
{
  let previous, impactDistance;
  const hero = { id: 'dolly', position: [0, 1, 0], bounds: [1, .25, .25] };
  for (let i = 0; i <= 300; i++) {
    const storyBeat = i < 120 ? 'impact' : 'result';
    const camera = planCamera({ time: i / 60, duration: 6, objects: [hero], viewDirection: [0, .12, 1], storyBeat, previous });
    check(camera, [hero]);
    const distance = Math.hypot(...sub(camera.position, camera.target));
    if (i === 119) impactDistance = distance;
    if (previous) {
      continuous(previous, camera);
      const before = Math.hypot(...sub(previous.position, previous.target));
      assert(Math.abs(distance / before - 1) < .025, 'Shot change caused an abrupt dolly');
    }
    previous = camera;
  }
  assert(Math.hypot(...sub(previous.position, previous.target)) > impactDistance * 1.12, 'Result should reveal more context through a gradual dolly');
}

// Slowly moving occlusion cannot alternate between opposite sides. The actual
// hero stays visible and the camera never enters the obstacle on the detour.
{
  let previous;
  const hero = { id: 'detour', position: [0, 0, 0], bounds: [.4, .6, .4] };
  for (let i = 0; i < 240; i++) {
    const obstacle = { id: 'occluder', position: [.15 * Math.sin(i / 100), 0, 2], radius: .8 };
    const camera = planCamera({ time: i / 60, duration: 5, objects: [hero], viewDirection: [0, .08, 1], obstacles: [obstacle], storyBeat: i < 120 ? 'impact' : 'follow', previous });
    check(camera, [hero]);
    assert(!blocks(camera.position, hero.position, obstacle));
    assert(Math.hypot(...sub(camera.position, obstacle.position)) > obstacle.radius);
    assert(dot(outward(camera), norm([0, .08, 1])) > .12);
    if (previous) continuous(previous, camera, 8 * Math.PI / 180);
    previous = camera;
  }
}

console.log(`Cinematography: ${frames} safe-frame states; ${continuityFrames} continuous transitions, largest angle step ${(largestAngleStep * 180 / Math.PI).toFixed(3)}°; reversals, hero/shot changes, fixed directions, dolly, occlusion and deterministic output passed.`);
