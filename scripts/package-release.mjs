import { readFile, writeFile, mkdir, cp, rm, readdir, stat, symlink, unlink, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bundleMacRuntime } from '../packaging/mac-runtime.mjs';

const exec = promisify(execFile), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const buildId = new Date().toISOString().replaceAll(/[-:.]/g, '').replace('Z', 'z');
const output = path.resolve(argument('--output') || path.join(root, 'release'));
const name = `Matter-Lab-${pkg.version}-${buildId}-macos-${process.arch}`, destination = path.join(output, name);
const work = path.resolve(argument('--work-dir') || path.join(root, '.cache', 'release-' + buildId)), snapshot = path.join(work, 'app');
const sourceEntries = [...(await readdir(root)).filter(name=>name.endsWith('.mjs')).sort(), 'index.html', 'package.json', 'package-lock.json', 'src', 'scripts', 'public'];
const nodeImage = 'node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53';
async function run(command, args, options = {}) { await new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
async function files(folder) { const result = []; for (const entry of await readdir(folder, { withFileTypes: true })) { const target = path.join(folder, entry.name); if (entry.isDirectory()) result.push(...await files(target)); else if (entry.isFile()) result.push(target); } return result.sort(); }
async function hash(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
async function sourceHashes() { const result = {}; for (const name of sourceEntries) { const target = path.join(root, name), list = (await stat(target)).isDirectory() ? await files(target) : [target]; for (const file of list) result[path.relative(root, file)] = await hash(file); } return result; }
async function copyProductionModules() {
  const copied = new Set();
  async function copy(name) { if (copied.has(name)) return; copied.add(name); const from = path.join(root, 'node_modules', name); await cp(from, path.join(snapshot, 'node_modules', name), { recursive: true, dereference: true }); const metadata = JSON.parse(await readFile(path.join(from, 'package.json'), 'utf8')); for (const dependency of Object.keys(metadata.dependencies || {})) await copy(dependency); }
  for (const dependency of Object.keys(pkg.dependencies || {})) await copy(dependency);
}
async function checksums(folder) { let text = ''; for (const file of await files(folder)) if (path.basename(file) !== 'SHA256SUMS') text += `${await hash(file)}  ${path.relative(folder, file)}\n`; await writeFile(path.join(folder, 'SHA256SUMS'), text); }

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This packaging target requires an Apple Silicon Mac with Swift, Metal and Docker Desktop.');
await exec('docker', ['info', '--format', '{{.ServerVersion}}']);
await mkdir(output, { recursive: true }); await mkdir(snapshot, { recursive: true });
console.log('Снимок исходников →', snapshot);
const before = await sourceHashes();
for (const entry of sourceEntries) await cp(path.join(root, entry), path.join(snapshot, entry), { recursive: true, dereference: true });
if (JSON.stringify(before) !== JSON.stringify(await sourceHashes())) throw new Error('Source changed during the snapshot. Freeze the source and rerun packaging.');
await readFile(path.join(snapshot, 'scripts/render-worker.mjs'));
await symlink(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
try { await run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: snapshot }); } finally { await unlink(path.join(snapshot, 'node_modules')); }
await copyProductionModules();
await mkdir(destination, { recursive: true });
await cp(snapshot, path.join(destination, 'worker/app'), { recursive: true, dereference: true });
for (const entry of ['compose.yaml', 'Dockerfile', '.dockerignore']) await cp(path.join(root, entry), path.join(destination, entry));
await mkdir(path.join(destination, 'packaging'), { recursive: true });
await cp(path.join(root, 'packaging/launcher.mjs'), path.join(destination, 'packaging/launcher.mjs'));
await cp(path.join(root, 'packaging/verify-release.mjs'), path.join(destination, 'packaging/verify-release.mjs'));
await cp(path.join(root, 'packaging/README.md'), path.join(destination, 'README.md'));

const runtime = path.join(destination, 'worker/runtime'); await mkdir(path.join(runtime, 'bin'), { recursive: true });
const native = path.join(runtime, 'bin/render-native');
console.log('Компилируем зафиксированный Mac renderer…');
await run('swiftc', ['-O', '-module-cache-path', path.join(work, 'swift-modules'), path.join(snapshot, 'scripts/render-native.swift'), '-o', native]);
const which = async name => (await exec('/usr/bin/which', [name])).stdout.trim();
const runtimeManifest = await bundleMacRuntime({ target: runtime, native, ffmpeg: await which('ffmpeg'), ffprobe: await which('ffprobe') });
const portableEnv = { ...process.env, PATH: path.join(runtime, 'bin') + ':/usr/bin:/bin', DYLD_LIBRARY_PATH: '', DYLD_FALLBACK_LIBRARY_PATH: '' };
const nodeVersion = (await exec(path.join(runtime, 'bin/node'), ['--version'], { env: portableEnv })).stdout.trim();
const ffmpegVersion = (await exec(path.join(runtime, 'bin/ffmpeg'), ['-version'], { env: portableEnv })).stdout.split('\n')[0];
await exec(path.join(runtime, 'bin/ffprobe'), ['-version'], { env: portableEnv });

const imageTag = `matter-lab-web:${pkg.version}-${buildId.toLowerCase()}`;
console.log('Собираем immutable web/API image…');
await cp(path.join(root, 'Dockerfile'), path.join(snapshot, 'Dockerfile')); await cp(path.join(root, '.dockerignore'), path.join(snapshot, '.dockerignore'));
await run('docker', ['build', '--pull=false', '--build-arg', 'MATTER_NODE_IMAGE=' + nodeImage, '--label', 'org.opencontainers.image.version=' + pkg.version, '--label', 'com.matter-lab.build=' + buildId, '-t', imageTag, '-f', path.join(snapshot, 'Dockerfile'), snapshot]);
const imageId = (await exec('docker', ['image', 'inspect', imageTag, '--format', '{{.Id}}'])).stdout.trim();
console.log('Сохраняем Docker image для передачи без registry…');
const save = spawn('docker', ['image', 'save', imageTag], { stdio: ['ignore', 'pipe', 'pipe'] }); let saveError = ''; save.stderr.on('data', c => saveError += c);
await Promise.all([pipeline(save.stdout, createGzip({ level: 6 }), createWriteStream(path.join(destination, 'web-image.tar.gz'))), new Promise((resolve, reject) => { save.on('error', reject); save.on('exit', code => code === 0 ? resolve() : reject(new Error(saveError))); })]);
for (const [file, action] of [['Start Matter Lab.command', 'start'], ['Stop Matter Lab.command', 'stop'], ['Verify Matter Lab.command', 'verify']]) {
  const text = `#!/bin/zsh\nset -eu\nrelease_dir="$(cd -- "$(dirname -- "$0")" && pwd)"\n"$release_dir/worker/runtime/bin/node" "$release_dir/packaging/launcher.mjs" ${action}\n`;
  await writeFile(path.join(destination, file), text); await chmod(path.join(destination, file), 0o755);
}
const manifest = { product: 'Matter Lab', version: pkg.version, buildId, created: new Date().toISOString(), platform: 'darwin', arch: process.arch, minimumMacOS: '26.0', testedMacOS: (await exec('/usr/bin/sw_vers',['-productVersion'])).stdout.trim(), distribution: 'Docker web/API plus local Mac Metal render worker', sourceHash: createHash('sha256').update(JSON.stringify(before)).digest('hex'), sourceFiles: before, container: { imageTag, imageId, base: nodeImage, platform: 'linux/arm64', localPort: 4315 }, worker: { localPort: 4316, nodeVersion, ffmpegVersion, ...runtimeManifest }, data: { default: './data', directories: ['projects', 'videos', 'cache', 'logs', 'run'], sourceMounts: false }, prerequisites: ['Docker Desktop for Apple Silicon', 'macOS 26+ Mac with Metal'], signing: 'ad-hoc; not Developer ID signed or notarized', verification: { runtimeBinaries: 'passed without Homebrew PATH', sourceSnapshot: 'stable', fullExport: 'run packaging/verify-release.mjs against this folder' } };
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
await checksums(destination);
await run(path.join(runtime, 'bin/node'), [path.join(destination, 'packaging/launcher.mjs'), 'verify']);
if(!process.argv.includes('--skip-smoke')){
  console.log('Проверяем полный экспорт через контейнер и Mac worker…');
  const reportPath=path.join(work,'verification.json');
  await run(path.join(runtime,'bin/node'),[path.join(destination,'packaging/verify-release.mjs'),destination,'--report='+reportPath]);
  const report=JSON.parse(await readFile(reportPath,'utf8'));delete report.data;
  await writeFile(path.join(destination,'verification.json'),JSON.stringify(report,null,2));
  manifest.verification.fullExport='passed';manifest.verification.report='verification.json';
  await writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));await checksums(destination);
}
const zip = destination + '.zip';
if (!process.argv.includes('--no-zip')) { console.log('Создаём архив…'); await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', destination, zip]); await writeFile(zip + '.sha256', (await hash(zip)) + '  ' + path.basename(zip) + '\n'); }
await writeFile(path.join(output, 'LATEST.json'), JSON.stringify({ version: pkg.version, buildId, directory: name, archive: process.argv.includes('--no-zip') ? null : path.basename(zip), sourceHash: manifest.sourceHash }, null, 2));
console.log(JSON.stringify({ release: destination, archive: process.argv.includes('--no-zip') ? null : zip, imageTag, imageId }));
