import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { CATALOG, CATEGORIES, MATERIALS, assetParts, settingsFor } from '../src/catalog.js';
import { HOUSEHOLD_CATALOG, HOUSEHOLD_CATEGORIES, HOUSEHOLD_FAMILIES, householdParts } from '../src/household-assets.js';
import { initializePhysics, LabWorld } from '../src/physics.js';

const began = performance.now(), ids = new Set(), fingerprints = new Map(), counts = {}, summaries = [];
const arity = { box: 3, sphere: 1, ellipsoid: 3, cylinder: 2, cone: 2, torus: 2 };
let totalParts = 0, colliders = 0;
assert(CATALOG.length >= 300); assert(HOUSEHOLD_CATALOG.length >= 210);
assert.equal(new Set(CATALOG.map(asset => asset.id)).size, CATALOG.length);
for (const category of HOUSEHOLD_CATEGORIES) assert(CATEGORIES.includes(category));

// Measure the actual transformed render mesh, independently of the catalogue's
// analytic support formula. Dense primitive meshes keep tessellation error low.
function meshBounds(parts) {
  const bounds = new THREE.Box3();
  for (const part of parts) {
    let geometry;
    const d = part.d;
    if (part.shape === 'box') geometry = new THREE.BoxGeometry(...d);
    else if (part.shape === 'sphere') geometry = new THREE.SphereGeometry(d[0], 96, 64);
    else if (part.shape === 'ellipsoid') { geometry = new THREE.SphereGeometry(1, 96, 64); geometry.scale(...d); }
    else if (part.shape === 'cylinder') geometry = new THREE.CylinderGeometry(d[0], d[0], d[1], 128);
    else if (part.shape === 'cone') geometry = new THREE.ConeGeometry(d[0], d[1], 128);
    else { geometry = new THREE.TorusGeometry(d[0], d[1], 48, 128); geometry.rotateX(Math.PI / 2); }
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r || [0, 0, 0]), 'XYZ'));
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...part.p), rotation, new THREE.Vector3(1, 1, 1)));
    geometry.computeBoundingBox(); bounds.union(geometry.boundingBox); geometry.dispose();
  }
  return { size: bounds.getSize(new THREE.Vector3()).toArray(), center: bounds.getCenter(new THREE.Vector3()).toArray() };
}

for (const asset of HOUSEHOLD_CATALOG) {
  assert(!ids.has(asset.id)); ids.add(asset.id);
  assert.equal(asset.model, 'rigid'); assert.equal(asset.behavior, 'rigid');
  assert(Number.isFinite(asset.mass) && asset.mass > 0, `${asset.id}: missing initial mass`);
  assert.equal(asset.massEstimated, true, `${asset.id}: the initial mass must be labelled as an estimate`);
  assert(typeof asset.material === 'string' && asset.material.length < 40);
  assert(MATERIALS[asset.mat] && !MATERIALS[asset.mat].young);
  assert(HOUSEHOLD_CATEGORIES.includes(asset.category)); counts[asset.category] = (counts[asset.category] || 0) + 1;
  const parts = householdParts(asset.id); assert.deepEqual(assetParts(asset.id), parts);
  assert(parts.length >= 2 && parts.length <= 35, `${asset.id}: ${parts.length} parts`); totalParts += parts.length;
  assert(asset.size.length === 3 && asset.size.every(value => Number.isFinite(value) && value > 0));
  for (const part of parts) {
    assert.equal(part.d.length, arity[part.shape], asset.id);
    assert(part.d.every(value => Number.isFinite(value) && value > 0), asset.id);
    assert(part.p.length === 3 && part.p.every(Number.isFinite), asset.id);
    if (part.r) assert(part.r.length === 3 && part.r.every(Number.isFinite), asset.id);
  }
  const bounds = meshBounds(parts), tolerance = Math.max(...asset.size) * .0015 + 1e-6;
  bounds.size.forEach((value, axis) => assert(Math.abs(value - asset.size[axis]) <= tolerance, `${asset.id}: render bounds ${bounds.size} differ from ${asset.size}`));
  assert(bounds.center.every(value => Math.abs(value) <= tolerance / 2), `${asset.id}: origin is not at the mesh centre`);
  const scale = Math.max(...asset.size), rounded = value => Number((value / scale).toFixed(5));
  const fingerprint = JSON.stringify(parts.map(part => ({ shape: part.shape, d: part.d.map(rounded), p: part.p.map(rounded), r: (part.r || [0, 0, 0]).map(value => Number(value.toFixed(5))) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert(!fingerprints.has(fingerprint), `${asset.id} is only a global size/colour variant of ${fingerprints.get(fingerprint)}`); fingerprints.set(fingerprint, asset.id);
  const original = JSON.stringify(parts); parts[0].p[0] = 999; parts[0].d[0] = 999;
  assert.equal(JSON.stringify(householdParts(asset.id)), original, `${asset.id}: mutable shared geometry`);
  summaries.push({ id: asset.id, name: asset.name, family: asset.family, category: asset.category, parts: parts.length, size: asset.size, mass: asset.mass, massEstimated: asset.massEstimated });
}
console.log(`✓ ${HOUSEHOLD_CATALOG.length} distinct models; positive finite geometry, independent mesh bounds and origin, no global size/colour duplicates.`);

await initializePhysics();
const objects = HOUSEHOLD_CATALOG.map((asset, index) => ({ id: asset.id, asset: asset.id, material: asset.mat, mass: asset.mass, position: [(index % 18 - 8.5) * 8, asset.size[1] / 2 + .25, (Math.floor(index / 18) - 5.5) * 8] }));
const lab = new LabWorld({ ...settingsFor('blank'), experiment: 'blank', gravity: 9.81 }, objects);
try {
  for (const asset of HOUSEHOLD_CATALOG) {
    const entity = lab.find(asset.id); assert(entity && entity.colliders.length >= householdParts(asset.id).length, `${asset.id}: empty collider`);
    assert(Number.isFinite(entity.body.mass()) && entity.body.mass() > 0, `${asset.id}: bad mass`);
    assert(Math.abs(entity.body.mass() - asset.mass) / asset.mass < .0001, `${asset.id}: initial mass preset did not reach the rigid body`);
    for (const collider of entity.colliders) { assert(collider.isEnabled()); const p = collider.translation(), q = collider.rotation(); assert([p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite), asset.id); }
    colliders += entity.colliders.length;
  }
  for (let step = 0; step < 12; step++) lab.step();
  for (const asset of HOUSEHOLD_CATALOG) {
    const entity = lab.find(asset.id), p = entity.body.translation(), q = entity.body.rotation(), v = entity.body.linvel(), w = entity.body.angvel();
    assert([p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite), `${asset.id}: non-finite simulation`);
    assert(Math.hypot(v.x, v.y, v.z) < 2, `${asset.id}: unexplained initial impulse`);
  }
} finally { lab.dispose(); }
console.log(`✓ All ${HOUSEHOLD_CATALOG.length} models instantiated in Rapier: ${colliders} nonempty colliders; finite poses, mass and velocities after 12 physics steps.`);
const report = { totalCatalog: CATALOG.length, newObjects: HOUSEHOLD_CATALOG.length, families: HOUSEHOLD_FAMILIES.length, categories: counts, totalParts, colliders, uniqueNormalizedGeometry: fingerprints.size, meshesAndOriginsVerified: true, rapierInstantiationVerified: true, wallMilliseconds: Math.round(performance.now() - began), assets: summaries };
const reportAt = process.argv.indexOf('--report'); if (reportAt >= 0) await writeFile(process.argv[reportAt + 1], JSON.stringify(report, null, 2));
console.log(`Household QA passed: ${report.newObjects} new props / ${report.families} structural groups / 9 categories; ${report.totalCatalog} total assets. ${report.wallMilliseconds} ms.`);
