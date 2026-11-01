import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateProject } from '../src/validation.js';
import { createComparisonDemo } from '../src/comparison.js';
import { CATALOG, settingsFor } from '../src/catalog.js';

const base = () => ({ version: 1, settings: settingsFor('blank'), objects: [], edits: {} });
const reject = (change, message) => { const p = base(); change(p); assert.throws(() => validateProject(p), error => error instanceof Error && /Некорректный проект/.test(error.message), message); };
reject(p => p.settings.gravity = NaN, 'NaN cannot enter the physics world');
reject(p => p.objects = [{ id: 'same', asset: 'ball' }, { id: 'same', asset: 'chair' }], 'Repeated identities cannot overwrite visible objects');
reject(p => p.objects = [{ parts: [{ shape: 'cylinder', d: [1] }] }], 'Malformed collider must be rejected');
reject(p => p.objects = [{ asset: 'ball', rotation: { x: 0, y: 0, z: 0, w: 0 } }], 'Zero quaternion cannot enter the renderer');
reject(p => p.edits.target = { launch: { speed: Infinity } }, 'Saved launches need finite inputs');
reject(p => p.objects = [{ asset: 'unknown-furniture' }], 'Missing geometry is a clear import error');
reject(p => p.objects = [{ asset: 'ball', position: [0, 0, 10001] }], 'Extreme coordinates are bounded');
reject(p => p.settings.emitters = [{ id: 'soft-emitter', asset: 'softcube' }], 'Rigid-only emitter cannot invoke a missing body');
const demo = createComparisonDemo(); assert.equal(validateProject(demo), demo);
const catalogObjects = CATALOG.map(a => ({ id: 'catalog-' + a.id, asset: a.id, material: a.mat, position: [0, 1, 0], mass: 1, scale: 1 }));
let catalogBatches = 0, checkedAssets = 0;
for (let offset = 0; offset < catalogObjects.length; offset += 150) {
  const catalog = base(); catalog.objects = catalogObjects.slice(offset, offset + 150);
  assert(catalog.objects.length <= 150);
  const before = JSON.stringify(catalog);
  assert.equal(validateProject(catalog), catalog);
  assert.equal(JSON.stringify(catalog), before);
  checkedAssets += catalog.objects.length; catalogBatches++;
}
assert.equal(checkedAssets, CATALOG.length);
reject(p => p.objects = Array.from({ length: 151 }, (_, index) => ({ id: 'over-limit-' + index, asset: 'ball' })), '151 valid objects must exceed the unchanged 150-object project limit');
const custom = base(); custom.objects = [{ id: 'own-part', asset: 'my-part', parts: [{ shape: 'box', d: [1, 2, 3], p: [1, 0, -1], r: [0, .2, 0] }], rotation: { x: 0, y: 1, z: 0, w: 1 }, mass: 2 }];
assert.equal(validateProject(custom), custom);

let roundtrips = 0;
const files = [new URL('../public/projects/crate-wall.json', import.meta.url)];
const videoDir = new URL('../../matter-lab-videos/', import.meta.url);
if(process.env.MATTER_LAB_VERIFY_LOCAL_MEDIA==='1'){
 let names=[];try{names=await readdir(videoDir);}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const name of names)if(name.endsWith('.project.json'))files.push(new URL(name,videoDir));
}
for (const file of files) {
  const project = JSON.parse(await readFile(file, 'utf8')), before = JSON.stringify(project);
  assert.equal(validateProject(project), project); assert.equal(JSON.stringify(project), before);
  assert.deepEqual(validateProject(JSON.parse(before)), project); roundtrips++;
}
console.log(`Validation passed: ${roundtrips} real project roundtrips, all ${CATALOG.length} catalog assets in ${catalogBatches} batches of at most 150, explicit 151-object rejection, compound geometry, unchanged identity, NaN/duplicates/malformed collider/launch rejection.`);
