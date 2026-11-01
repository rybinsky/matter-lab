import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile), release = path.resolve(process.argv[2] || '');
const manifest = JSON.parse(await readFile(path.join(release, 'manifest.json'), 'utf8'));
const data = await mkdtemp(path.join(tmpdir(), 'matter-release-qa-'));
const env = { ...process.env, MATTER_LAB_RELEASE_DATA_DIR: data, MATTER_LAB_WEB_PORT: '4325', MATTER_LAB_WORKER_PORT: '4326',MATTER_LAB_RELEASE_FORCE_LOAD:'1' };
const node = path.join(release, 'worker/runtime/bin/node'), launcher = path.join(release, 'packaging/launcher.mjs');
const report = { version: manifest.version, buildId: manifest.buildId, started: new Date().toISOString(), data, checks: [], passed: false };
const run = async action => { const r = await exec(node, [launcher, action, '--no-open'], { env, maxBuffer: 8 * 1024 * 1024, timeout: 120000 }); process.stdout.write(r.stdout); };
async function request(endpoint, options = {}) { const r = await fetch('http://127.0.0.1:4325' + endpoint, options); const value = await r.json(); assert(r.ok, `${endpoint}: ${r.status}: ${JSON.stringify(value)}`); return value; }
try {
  await run('start');delete env.MATTER_LAB_RELEASE_FORCE_LOAD;report.checks.push('Bundled Docker image archive loaded and image ID verified');
  assert.equal((await request('/api/health')).version, manifest.version);
  const status = await request('/api/render-status'); assert(status.ok); assert.equal(status.mode, 'worker'); report.checks.push('Container API reaches the authenticated Mac worker over HTTP');
  const denied = await fetch('http://127.0.0.1:4326/health'); assert.equal(denied.status, 401); report.checks.push('Worker rejects requests without a bearer token');
  const state = JSON.parse(await readFile(path.join(data, 'run/release-state.json'), 'utf8'));
  const inspection = JSON.parse((await exec('docker', ['inspect', state.project + '-studio-1'])).stdout)[0];
  const mount=inspection.Mounts.find(m => m.Type === 'bind' && m.Destination === '/data');assert(mount);assert.equal(await realpath(mount.Source),await realpath(data));
  assert(!inspection.Mounts.some(m => m.Destination === '/app' || m.Source.includes('/outputs/matter-lab/')));
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true); report.checks.push('Read-only image, only the separate data folder is mounted; no dev source mount');
  const { settingsFor } = await import(pathToFileURL(path.join(release, 'worker/app/src/catalog.js')));
  const settings = { ...settingsFor('blank'), exportFps: 30, audioPreset: 'none', environment: { id: 'gallery' }, simulationDuration: 2,
    story: { enabled: false, duration: 5, autoTrim: false, heroId: 'release-ball' },
    cameraRig: { mode: 'keys', interpolation: 'linear', points: [0, 2].map(time => ({ time, sourceTime: time, position: [4, 3, 6], target: [0, .5, 0], fov: 40 })) } };
  const project = { version: 1, name: 'Release persistence check', settings, objects: [{ id: 'release-ball', asset: 'ball', material: 'rubber', scale: .3, mass: 1, position: [0, 2, 0] }], edits: {}, series: false, height: 1080, outputName: 'release-smoke' };
  await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({id:'release-smoke',project}) });
  const saved = await request('/api/projects/release-smoke'); assert.equal((saved.project || saved).name, project.name);
  assert((await readdir(path.join(data, 'projects'))).some(name => name.endsWith('.json'))); report.checks.push('Project persisted through the API into the separate projects directory');
  const job = await request('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) }); assert(job.id);
  const deadline = Date.now() + 90000; let result;
  for (;;) { result = await request('/api/jobs/' + job.id); if (result.status !== 'running') break; assert(Date.now() < deadline, 'Smoke export timed out'); await new Promise(resolve => setTimeout(resolve, 500)); }
  assert.equal(result.status, 'done', result.message);
  const video = path.join(data, 'videos/release-smoke.mp4'); assert((await stat(video)).size > 1000);
  const probe = JSON.parse((await exec(path.join(release, 'worker/runtime/bin/ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video], { env: { PATH: '/usr/bin:/bin' } })).stdout);
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
  assert.equal(v.width, 1080); assert.equal(v.height, 1920); assert.equal(v.r_frame_rate, '30/1'); assert.equal(v.codec_name, 'h264'); assert(a && a.codec_name === 'aac'); assert(Math.abs(Number(probe.format.duration) - 2) < .05);
  report.video = { width: v.width, height: v.height, fps: v.r_frame_rate, duration: probe.format.duration, videoCodec: v.codec_name, audioCodec: a.codec_name, bytes: Number(probe.format.size) };
  report.checks.push('Container → authenticated worker → Metal render → FFmpeg audio mux → 1080×1920/30 H.264+AAC MP4');
  assert((await request('/api/reels')).some(r => r.name === 'release-smoke.mp4')); report.checks.push('Export is visible from the container video library on the shared volume');
  await run('stop'); await run('start');
  const restored = await request('/api/projects/release-smoke'); assert.equal((restored.project || restored).name, project.name);
  assert((await request('/api/reels')).some(r => r.name === 'release-smoke.mp4')); report.checks.push('Projects and videos survive a complete stop and restart');
  report.passed = true;
} catch (error) { report.error = error.stack || String(error); throw error; }
finally {
  try { await run('stop'); } catch {}
  report.finished = new Date().toISOString();
  const reportPath = process.argv.find(a => a.startsWith('--report='))?.slice(9) || path.join(path.dirname(release), path.basename(release) + '-verification.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2)); console.log('Verification report:', reportPath);
}
