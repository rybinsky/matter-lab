import { readFile, writeFile, mkdir, chmod, open, rm, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const exec = promisify(execFile), release = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(release, 'manifest.json'), 'utf8'));
const data = path.resolve(process.env.MATTER_LAB_RELEASE_DATA_DIR || path.join(release, 'data'));
const runDir = path.join(data, 'run'), statePath = path.join(runDir, 'release-state.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dockerEnv = { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin' };
const command = process.argv[2] || 'start';
async function state() { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; } }
async function request(url, token) { return fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(2000) }); }
async function ready(url, token, timeout = 30000) { const end = Date.now() + timeout; for (;;) { try { const r = await request(url, token); if (r.ok) return await r.json(); } catch {} if (Date.now() >= end) throw new Error(`Сервис не запустился: ${url}`); await sleep(350); } }
async function verify() {
  const list = (await readFile(path.join(release, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  for (const line of list) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line); if (!match) throw new Error('Повреждён SHA256SUMS');
    const file = path.resolve(release, match[2]); if (!file.startsWith(release + path.sep)) throw new Error('Недопустимый путь в SHA256SUMS');
    const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk);
    if (digest.digest('hex') !== match[1]) throw new Error(`Файл релиза изменён: ${match[2]}`);
  }
  console.log(`Matter Lab ${manifest.version} · ${manifest.buildId}: контрольные суммы совпадают.`);
}
async function docker(args, options = {}) { return exec('docker', args, { env: dockerEnv, maxBuffer: 8 * 1024 * 1024, ...options }); }
function composeArgs(s) { return ['compose', '--project-name', s.project, '--env-file', path.join(runDir, 'compose.env'), '-f', path.join(release, 'compose.yaml')]; }
async function saveImage() {
  try { const r = await docker(['image', 'inspect', manifest.container.imageTag, '--format', '{{.Id}}']); if (r.stdout.trim() === manifest.container.imageId && process.env.MATTER_LAB_RELEASE_FORCE_LOAD!=='1') return; } catch {}
  console.log('Загружаем фиксированный образ приложения в Docker…');
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['image', 'load'], { env: dockerEnv, stdio: ['pipe', 'pipe', 'pipe'] }); let error = '';
    child.stderr.on('data', c => error += c); child.stdout.resume(); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || 'docker load failed')));
    createReadStream(path.join(release, 'web-image.tar.gz')).pipe(createGunzip()).on('error', reject).pipe(child.stdin);
  });
  const r = await docker(['image', 'inspect', manifest.container.imageTag, '--format', '{{.Id}}']);
  if (r.stdout.trim() !== manifest.container.imageId) throw new Error('Загруженный Docker image не совпадает с manifest');
}
async function start() {
  if (process.platform !== 'darwin' || process.arch !== manifest.arch) throw new Error(`Этот релиз содержит Mac render worker для ${manifest.arch}. Нужен совместимый Mac и Docker Desktop.`);
  const macVersion=(await exec('/usr/bin/sw_vers',['-productVersion'])).stdout.trim();
  if(Number(macVersion.split('.')[0])<26)throw new Error('Включённый render worker требует macOS 26 или новее. Для более ранней macOS нужна другая сборка runtime.');
  await verify();
  try { await docker(['info', '--format', '{{.ServerVersion}}']); } catch { throw new Error('Запустите Docker Desktop и повторно откройте Start Matter Lab.command. Docker в релиз не включён.'); }
  await Promise.all(['videos', 'projects', 'cache', 'logs', 'run'].map(folder => mkdir(path.join(data, folder), { recursive: true })));
  await chmod(runDir, 0o700);
  const existing = await state();
  if (existing) {
    let workerHealthy=false,webHealthy=false;
    try{workerHealthy=(await request(`http://127.0.0.1:${existing.workerPort}/health`,existing.token)).ok;}catch{}
    try{webHealthy=(await request(`http://127.0.0.1:${existing.webPort}/api/health`)).ok;}catch{}
    if(workerHealthy&&existing.buildId!==manifest.buildId)throw new Error(`В этой папке данных работает другая сборка (${existing.version}, ${existing.buildId}). Сначала остановите её, чтобы открыть ${manifest.buildId}.`);
    if(workerHealthy&&webHealthy&&existing.buildId===manifest.buildId){console.log(`Уже запущено: http://127.0.0.1:${existing.webPort}`);return;}
    await stop();
  }
  await saveImage();
  const webPort = Number(process.env.MATTER_LAB_WEB_PORT || 4315), workerPort = Number(process.env.MATTER_LAB_WORKER_PORT || 4316);
  if (![webPort, workerPort].every(p => Number.isInteger(p) && p > 1024 && p < 65536) || webPort === workerPort) throw new Error('Проверьте порты веб-сайта и render worker.');
  for(const port of [webPort,workerPort])await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error(`Порт ${port} занят другим приложением. Выберите другой порт.`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
  const token = randomBytes(32).toString('base64url'), project = 'matter-lab-' + createHash('sha256').update(await realpath(release) + data).digest('hex').slice(0, 12);
  const runtime = path.join(release, 'worker/runtime'), app = path.join(release, 'worker/app');
  const env = { ...process.env, NODE_ENV: 'production', MATTER_LAB_DEV: '0', MATTER_LAB_DATA_DIR: data, MATTER_LAB_MEDIA_DIR: path.join(data, 'videos'), MATTER_LAB_CACHE_DIR: path.join(data, 'cache'), MATTER_LAB_PROJECTS_DIR: path.join(data, 'projects'), MATTER_LAB_RENDER_BINARY: path.join(runtime, 'bin/render-native'), MATTER_LAB_RENDER_WORKER_HOST: '127.0.0.1', MATTER_LAB_RENDER_WORKER_PORT: String(workerPort), MATTER_LAB_RENDER_WORKER_TOKEN: token, PATH: path.join(runtime, 'bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', DYLD_LIBRARY_PATH:'', DYLD_FALLBACK_LIBRARY_PATH:'' };
  delete env.MATTER_LAB_RENDER_WORKER_URL;delete env.NODE_PATH;delete env.NODE_OPTIONS;
  const log = await open(path.join(data, 'logs/worker.log'), 'a');
  const worker = spawn(path.join(runtime, 'bin/node'), [path.join(app, 'scripts/render-worker.mjs')], { cwd: app, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
  worker.unref(); await log.close();
  const current = { version: manifest.version, buildId: manifest.buildId, project, webPort, workerPort, workerPid: worker.pid, token, started: new Date().toISOString() };
  await writeFile(statePath, JSON.stringify(current, null, 2), { mode: 0o600 });
  const values = { MATTER_LAB_IMAGE: manifest.container.imageTag, MATTER_LAB_RELEASE_DATA_DIR: data, MATTER_LAB_WEB_PORT: webPort, MATTER_LAB_WORKER_PORT: workerPort, MATTER_LAB_RENDER_WORKER_TOKEN: token, MATTER_LAB_RUN_UID: process.getuid?.() ?? 1000, MATTER_LAB_RUN_GID: process.getgid?.() ?? 1000 };
  const envFile = Object.entries(values).map(([key, value]) => `${key}='${String(value).replaceAll("'", "\\'")}'`).join('\n') + '\n';
  await writeFile(path.join(runDir, 'compose.env'), envFile, { mode: 0o600 });
  try {
    await ready(`http://127.0.0.1:${workerPort}/health`, token);
    await docker([...composeArgs(current), 'up', '-d', '--no-build', '--wait', '--wait-timeout', '45']);
    await ready(`http://127.0.0.1:${webPort}/api/health`);
  } catch (error) { await stop(); throw error; }
  console.log(`Готово: http://127.0.0.1:${webPort}\nПроекты и видео: ${data}\nОстановить: Stop Matter Lab.command`);
  if (!process.argv.includes('--no-open')) await exec('/usr/bin/open', [`http://127.0.0.1:${webPort}`]);
}
async function stop() {
  const current = await state(); if (!current) { console.log('Этот релиз не запущен.'); return; }
  try { await docker([...composeArgs(current), 'down', '--timeout', '15']); } catch (error) { console.error('Docker: ' + error.message); }
  try { const response = await request(`http://127.0.0.1:${current.workerPort}/health`, current.token); if (response.ok) process.kill(current.workerPid, 'SIGTERM'); } catch {}
  await rm(statePath, { force: true }); console.log('Matter Lab остановлен. Проекты и видео сохранены.');
}
try {
  if (command === 'verify') await verify();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'status') { const s = await state(); console.log(s ? `Matter Lab ${s.version}: http://127.0.0.1:${s.webPort}\nДанные: ${data}` : 'Релиз не запущен.'); }
  else throw new Error('Команда: start, stop, status или verify');
} catch (error) { console.error(error.message); process.exitCode = 1; }
