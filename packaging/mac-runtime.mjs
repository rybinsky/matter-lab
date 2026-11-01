import { copyFile, mkdir, chmod, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const system = name => name.startsWith('/System/') || name.startsWith('/usr/lib/');
async function dependencies(file) {
  const { stdout } = await exec('/usr/bin/otool', ['-L', file]);
  return stdout.split('\n').slice(1).map(line => /^\s+(.+?) \(compatibility version/.exec(line)?.[1]).filter(Boolean);
}
async function fileHash(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }

// Homebrew binaries are dynamically linked. Copy their complete non-system
// dependency closure and rewrite every load command; no Homebrew install is
// needed on the receiving Mac.
export async function bundleMacRuntime({ target, native, node = process.execPath, ffmpeg, ffprobe }) {
  const bin = path.join(target, 'bin'), lib = path.join(target, 'lib'), notices = path.join(target, 'licenses');
  await Promise.all([mkdir(bin, { recursive: true }), mkdir(lib, { recursive: true }), mkdir(notices, { recursive: true })]);
  const libraries = new Map(), names = new Map(), records = [], formulae = new Map();
  async function copyDependency(source) {
    const resolved = await realpath(source);
    if (libraries.has(resolved)) return libraries.get(resolved);
    const name = path.basename(resolved), destination = path.join(lib, name);
    if (names.has(name) && names.get(name) !== resolved && await fileHash(names.get(name)) !== await fileHash(resolved)) throw new Error(`Conflicting runtime library: ${name}`);
    libraries.set(resolved, destination); names.set(name, resolved);
    await copyFile(resolved, destination); await chmod(destination, 0o755);
    const cellar = resolved.match(/^(.*\/Cellar\/([^/]+)\/[^/]+)\//);
    if (cellar) formulae.set(cellar[2], cellar[1]);
    const deps = await dependencies(resolved), replacements = [];
    for (const dependency of deps) {
      if (dependency === source || dependency === resolved || system(dependency)) continue;
      if (!path.isAbsolute(dependency)) throw new Error(`Unresolved load command ${dependency} in ${resolved}`);
      const copied = await copyDependency(dependency); replacements.push([dependency, '@loader_path/' + path.basename(copied)]);
    }
    records.push({ source: resolved, destination, replacements, library: true });
    return destination;
  }
  for (const [name, source] of Object.entries({ node, ffmpeg, ffprobe, 'render-native': native })) {
    const resolved = await realpath(source), destination = path.join(bin, name);
    if (resolved !== destination) await copyFile(resolved, destination);
    await chmod(destination, 0o755);
    const replacements = [];
    for (const dependency of await dependencies(resolved)) {
      if (system(dependency)) continue;
      if (!path.isAbsolute(dependency)) throw new Error(`Unresolved load command ${dependency} in ${resolved}`);
      const copied = await copyDependency(dependency); replacements.push([dependency, '@loader_path/../lib/' + path.basename(copied)]);
    }
    records.push({ source: resolved, destination, replacements, library: false });
  }
  for (const record of records) {
    const args = record.replacements.flatMap(([from, to]) => ['-change', from, to]);
    if (record.library) args.push('-id', '@loader_path/' + path.basename(record.destination));
    if (args.length) await exec('/usr/bin/install_name_tool', [...args, record.destination]);
    await exec('/usr/bin/codesign', ['--force', '--sign', '-', record.destination]);
    const unresolved = (await dependencies(record.destination)).filter(name => !system(name) && !name.startsWith('@loader_path/'));
    if (unresolved.length) throw new Error(`External runtime paths remain: ${record.destination}: ${unresolved.join(', ')}`);
  }
  for (const [name, folder] of formulae) {
    const destination = path.join(notices, name); await mkdir(destination, { recursive: true });
    for (const file of await readdir(folder)) if (/^(copying|licen[cs]e|notice|copyright|install_receipt|sbom)/i.test(file)) await copyFile(path.join(folder, file), path.join(destination, file)).catch(() => {});
    for (const file of await readdir(path.join(folder, '.brew')).catch(() => [])) if (file.endsWith('.rb')) await copyFile(path.join(folder, '.brew', file), path.join(destination, file));
  }
  const nodeLicense = path.resolve(node, '../../LICENSE');
  await copyFile(nodeLicense, path.join(notices, 'NODE-LICENSE')).catch(() => {});
  const result = { platform: process.platform, arch: process.arch, binaries: records.filter(r => !r.library).map(r => path.basename(r.destination)), libraries: [...libraries.values()].map(file => path.basename(file)), signing: 'ad-hoc; no Developer ID or notarization' };
  await writeFile(path.join(target, 'runtime-manifest.json'), JSON.stringify(result, null, 2));
  return result;
}
