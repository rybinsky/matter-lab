import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProject } from './src/validation.js';
import { validateFilm } from './src/film.js';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const MAX_BYTES = 20_000_000;
const error = (message, statusCode = 400, code = 'INVALID_PROJECT') => Object.assign(new Error(message), { statusCode, code });
function validId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw error('Некорректный идентификатор проекта', 400, 'INVALID_PROJECT_ID');
  return id;
}
function validate(project) {
  validateProject(project);
  validateFilm(project.film, { fps: project.settings?.exportFps || 30 });
  return project;
}
function metadata(project, id, info) {
  const title = [project.name, project.film?.enabled && project.film.title, project.settings?.story?.title].find(value => typeof value === 'string' && value.trim());
  return { id, name: title?.trim().slice(0, 160) || 'Без названия', updated: info.mtime.toISOString(), objects: project.objects.length, clips: project.film?.clips?.length || 0 };
}

/** Persistent local scene files. Each overwrite retains the preceding bytes. */
export function createProjectStore(projectsDir) {
  if (typeof projectsDir !== 'string' || !projectsDir) throw error('Не указана папка проектов');
  const root = path.resolve(projectsDir), writes = new Map();
  let ready;
  async function directory() {
    ready ||= (async () => { await mkdir(root, { recursive: true }); return realpath(root); })();
    return ready;
  }
  async function safeDirectory(file) {
    await mkdir(file, { recursive: true });
    const info = await lstat(file);
    if (!info.isDirectory() || info.isSymbolicLink()) throw error('Папка истории проекта недоступна', 400, 'UNSAFE_PROJECT_PATH');
  }
  async function read(id) {
    validId(id);
    const file = path.join(await directory(), `${id}.json`);
    let handle;
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw error('Недопустимый путь проекта', 400, 'UNSAFE_PROJECT_PATH');
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const actual = await handle.stat();
      if (!actual.isFile() || actual.size > MAX_BYTES) throw error('Файл проекта слишком большой или недоступен');
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_BYTES) throw error('Файл проекта слишком большой');
      return { bytes, info: actual };
    } catch (cause) {
      if (cause.code === 'ENOENT') throw error('Проект не найден', 404, 'PROJECT_NOT_FOUND');
      if (cause.code === 'ELOOP') throw error('Недопустимый путь проекта', 400, 'UNSAFE_PROJECT_PATH');
      throw cause;
    } finally { await handle?.close(); }
  }
  function decode(bytes, id) {
    let project;
    try { project = JSON.parse(bytes.toString('utf8')); }
    catch { throw error('Не удалось прочитать файл проекта'); }
    validate(project);
    return { ...project, id };
  }
  async function serialized(id, task) {
    const previous = writes.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    writes.set(id, current);
    try { return await current; }
    finally { if (writes.get(id) === current) writes.delete(id); }
  }

  return {
    async list() {
      const base = await directory(), names = await readdir(base), projects = [];
      for (const name of names) {
        if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue;
        const id = name.slice(0, -5);
        try {
          const { bytes, info } = await read(id);
          projects.push(metadata(decode(bytes, id), id, info));
        } catch (cause) {
          // One interrupted/manual/corrupt file must not hide the whole library.
          if (cause.code === 'EACCES' || cause.code === 'EPERM') throw cause;
        }
      }
      return projects.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
    },
    async get(id) { return decode((await read(id)).bytes, id); },
    async save(project, { id } = {}) {
      validate(project);
      const projectId = id === undefined ? randomUUID() : validId(id);
      let bytes;
      try { bytes = Buffer.from(JSON.stringify({ ...project, id: projectId }, null, 2) + '\n', 'utf8'); }
      catch { throw error('Проект должен содержать данные JSON'); }
      if (bytes.byteLength > MAX_BYTES) throw error('Слишком большой проект');
      // Validate the serialized representation too: stored JSON is exactly what
      // future imports/render jobs will use, including every child film scene.
      const stored = decode(bytes, projectId);
      return serialized(projectId, async () => {
        const base = await directory(), destination = path.join(base, `${projectId}.json`);
        let previous;
        try { previous = await read(projectId); }
        catch (cause) { if (cause.code !== 'PROJECT_NOT_FOUND') throw cause; }
        const temporary = path.join(base, `.${projectId}-${randomUUID()}.tmp`);
        let handle;
        try {
          handle = await open(temporary, 'wx', 0o600);
          await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
          if (previous) {
            const historyRoot = path.join(base, '.history'); await safeDirectory(historyRoot);
            const history = path.join(historyRoot, projectId); await safeDirectory(history);
            const version = path.join(history, `${Date.now()}-${randomUUID()}.json`);
            const backup = await open(version, 'wx', 0o600);
            try { await backup.writeFile(previous.bytes); await backup.sync(); }
            finally { await backup.close(); }
          }
          await rename(temporary, destination);
          const info = await lstat(destination);
          return metadata(stored, projectId, info);
        } finally {
          await handle?.close();
          await unlink(temporary).catch(cause => { if (cause.code !== 'ENOENT') throw cause; });
        }
      });
    },
  };
}
