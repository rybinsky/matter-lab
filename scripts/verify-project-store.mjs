import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectStore } from '../project-store.mjs';
import { settingsFor } from '../src/catalog.js';

const temporary = await mkdtemp(path.join(tmpdir(), 'matter-project-store-'));
const projectsDir = path.join(temporary, 'projects'), store = createProjectStore(projectsDir);
const project = name => ({ version: 1, name, settings: { ...settingsFor('blank'), experiment: 'blank', exportFps: 60, story: { duration: 5 } }, objects: [{ id: 'ball', asset: 'ball', position: [0, 2, 0], mass: 1, material: 'metal' }], edits: {} });
let checks = 0, saved;
const check = async (label, run) => { await run(); checks++; console.log(`✓ ${label}`); };

try {
  await check('New store starts empty; UUID save survives reopening with exact data', async () => {
    assert.deepEqual(await store.list(), []);
    const source = project('Сцена'), before = JSON.stringify(source); saved = await store.save(source);
    assert.match(saved.id, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
    assert.deepEqual(Object.keys(saved).sort(), ['clips', 'id', 'name', 'objects', 'updated']);
    assert.equal(saved.name, 'Сцена'); assert.equal(saved.objects, 1); assert.equal(saved.clips, 0); assert(Number.isFinite(Date.parse(saved.updated)));
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(await createProjectStore(projectsDir).get(saved.id), { ...source, id: saved.id });
  });
  await check('Overwrite keeps the exact previous bytes in .history and leaves no temporary files', async () => {
    const original = await readFile(path.join(projectsDir, `${saved.id}.json`));
    const next = project('Новая версия'); next.objects[0].position = [1, 3, 2];
    const result = await store.save(next, { id: saved.id }); assert.equal(result.id, saved.id);
    const history = path.join(projectsDir, '.history', saved.id), versions = await readdir(history);
    assert.equal(versions.length, 1); assert.deepEqual(await readFile(path.join(history, versions[0])), original);
    assert.deepEqual(await store.get(saved.id), { ...next, id: saved.id });
    assert(!(await readdir(projectsDir)).some(name => name.endsWith('.tmp')));
  });
  await check('Concurrent writes preserve every version and leave an atomic readable final file', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.save(project(`Concurrent ${index}`), { id: saved.id })));
    assert.equal((await store.get(saved.id)).name, 'Concurrent 4');
    const history = path.join(projectsDir, '.history', saved.id), versions = await readdir(history);
    assert.equal(versions.length, 6);
    const names = await Promise.all(versions.map(async name => JSON.parse(await readFile(path.join(history, name), 'utf8')).name));
    for (const name of ['Сцена', 'Новая версия', 'Concurrent 0', 'Concurrent 1', 'Concurrent 2', 'Concurrent 3']) assert(names.includes(name));
    assert(!(await readdir(projectsDir)).some(name => name.endsWith('.tmp')));
  });
  await check('Film scenes roundtrip and library listings expose metadata only', async () => {
    const film = project('Монтаж'); film.film = { version: 1, enabled: true, title: 'Film', clips: [{ id: 'one', label: 'Первая', project: project('Внутри') }, { id: 'two', label: '', project: project('Вторая') }] };
    const result = await store.save(film, { id: 'film-example' }); assert.equal(result.clips, 2);
    assert.deepEqual(await store.get(result.id), { ...film, id: result.id });
    const list = await store.list(); assert.equal(list.length, 2);
    assert(list.every(item => Object.keys(item).sort().join() === ['clips', 'id', 'name', 'objects', 'updated'].join()));
    assert(!JSON.stringify(list).includes('settings')); assert(!JSON.stringify(list).includes('Внутри'));
  });
  await check('Traversal, absolute paths, encoded separators, unsafe identifiers and missing files fail safely', async () => {
    for (const id of ['../outside', '..', '.', '/tmp/escape', 'a/b', 'a\\b', '%2e%2e', 'x.json', '', 'a'.repeat(81), null, 42]) {
      await assert.rejects(store.get(id), cause => cause.code === 'INVALID_PROJECT_ID');
      await assert.rejects(store.save(project('Unsafe'), { id }), cause => cause.code === 'INVALID_PROJECT_ID');
    }
    await assert.rejects(store.get('missing-project'), cause => cause.statusCode === 404);
    assert.deepEqual((await readdir(temporary)).sort(), ['projects']);
  });
  await check('Invalid nested films and malformed child scenes never replace a valid project', async () => {
    const original = await readFile(path.join(projectsDir, `${saved.id}.json`)), history = await readdir(path.join(projectsDir, '.history', saved.id));
    const invalid = project('Invalid'); invalid.objects[0].position[0] = NaN;
    await assert.rejects(store.save(invalid, { id: saved.id }));
    const nested = project('Nested'); nested.film = { version: 1, enabled: true, clips: [{ id: 'one', project: { ...project('Child'), film: { version: 1, enabled: false, clips: [] } } }] };
    await assert.rejects(store.save(nested, { id: saved.id }), /вложенные/);
    delete nested.film.clips[0].project.film; nested.film.clips[0].project.objects[0].asset = 'missing';
    await assert.rejects(store.save(nested, { id: saved.id }));
    const duplicate = project('Duplicate'); duplicate.film = { version: 1, enabled: true, clips: [{ id: 'one', project: project('One') }, { id: 'one', project: project('Two') }] };
    await assert.rejects(store.save(duplicate, { id: saved.id }), /повторяется/);
    assert.deepEqual(await readFile(path.join(projectsDir, `${saved.id}.json`)), original);
    assert.deepEqual(await readdir(path.join(projectsDir, '.history', saved.id)), history);
  });
  await check('Corrupt files are skipped; symlinks cannot read or overwrite files outside the store', async () => {
    await writeFile(path.join(projectsDir, 'corrupt.json'), '{');
    await writeFile(path.join(projectsDir, 'invalid.json'), JSON.stringify({ version: 1 }));
    const outside = path.join(temporary, 'outside.json'); await writeFile(outside, JSON.stringify(project('Outside')));
    await symlink(outside, path.join(projectsDir, 'linked.json'));
    await assert.rejects(store.get('linked'), cause => cause.code === 'UNSAFE_PROJECT_PATH');
    await assert.rejects(store.save(project('Replacement'), { id: 'linked' }), cause => cause.code === 'UNSAFE_PROJECT_PATH');
    assert.equal(JSON.parse(await readFile(outside, 'utf8')).name, 'Outside');
    assert.equal((await store.list()).length, 2);
    const unsafe = await store.save(project('History test'), { id: 'unsafe-history' });
    await symlink(temporary, path.join(projectsDir, '.history', unsafe.id));
    await assert.rejects(store.save(project('Must fail'), { id: unsafe.id }), cause => cause.code === 'UNSAFE_PROJECT_PATH');
    assert.equal((await store.get(unsafe.id)).name, 'History test');
    assert(!(await readdir(projectsDir)).some(name => name.endsWith('.tmp')));
  });
  console.log(`Project-store QA passed: ${checks} checks; persistence, atomic overwrite/history, concurrent saves, film roundtrip, metadata-only list and path/nested-input safety.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
