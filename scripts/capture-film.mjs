import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { capture } from './capture.mjs';
import { validateProject } from '../src/validation.js';
import { normalizeFilm, validateFilm, filmClipDuration, FILM_MAX_SECONDS } from '../src/film.js';
import { normalizedStory } from '../src/storyboard.js';
import { normalizeEnvironment } from '../src/environments.js';
import { captureModelProvenance } from '../src/model-provenance.js';

const owns = (object, key) => Object.hasOwn(object || {}, key);
const inherited = (settings, key, fallback) => owns(settings, key) ? settings[key] : fallback;

/** Combine independent captures before one native render/encode operation. */
export async function captureFilm(project, cachePath, onProgress = () => {}) {
  validateProject(project);
  validateFilm(project.film);
  const film = normalizeFilm(project.film);
  if (!film.enabled || !film.clips.length) return capture(project, cachePath, onProgress);

  const settings = project.settings || {};
  const exportFps = [24, 30, 60].includes(settings.exportFps) ? settings.exportFps : 30;
  const fps = project.preview === true ? ([24,30,60].includes(project.previewFps) ? project.previewFps : Math.min(30,exportFps)) : exportFps;
  const width = [720, 1080, 2160].includes(project.height) ? project.height : 1080;
  validateFilm(project.film, { fps });
  const directory = path.join(path.dirname(cachePath), path.basename(cachePath, path.extname(cachePath)) + '-clips');
  await mkdir(directory, { recursive: true });

  const chunks = [], provenance = [];
  onProgress(0, `Расчёт ${film.clips.length} клипов`);
  for (const [index, clip] of film.clips.entries()) {
    const slug = clip.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 70) || 'clip';
    const stem = `${String(index + 1).padStart(2, '0')}-${slug}`;
    // Runtime export flags belong to the film, not to a stored child project.
    const input = {
      ...clip.project, series: false, height: width, preview: project.preview === true,
      previewDuration: filmClipDuration(clip.project), previewFps: fps,
      settings: { ...clip.project.settings, exportFps },
    };
    const childCache = path.join(directory, stem + '.json');
    await writeFile(path.join(directory, stem + '.project.json'), JSON.stringify(input, null, 2));
    const data = await capture(input, childCache, (progress, message) => {
      const fraction = Math.max(0, Math.min(14, Number(progress) || 0)) / 14;
      onProgress((index + fraction) / film.clips.length * 14, `Клип ${index + 1}/${film.clips.length}: ${message}`);
    });
    if (data.fps !== fps || data.width !== width || data.height !== Math.round(width * 16 / 9)) throw new Error('Клипы фильма рассчитаны с разными параметрами кадра.');
    chunks.push(data); provenance.push({ id: clip.id, label: clip.label, sourceCache: path.relative(path.dirname(cachePath), childCache) });
  }

  const first = chunks[0], frameCount = chunks.reduce((n, data) => n + data.takes.reduce((sum, take) => sum + take.frames.length, 0), 0);
  const duration = frameCount / fps;
  if (duration > FILM_MAX_SECONDS + 1e-8) throw new Error(`Общая длительность фильма превышает ${FILM_MAX_SECONDS} секунд.`);
  const takeCount = chunks.reduce((n, data) => n + data.takes.length, 0);
  const anyTitles = chunks.some(data => data.takes.some(take => take.frames.some(frame => frame.editorial?.enabled !== false)));
  const story = owns(settings, 'story') ? normalizedStory(settings.story) : first.story;
  const title = film.title || project.name || story?.title || first.title || 'Фильм';
  const data = {
    title, subtitle: story?.question || first.subtitle || '', experiment: 'film', revision: 6,
    fps, width, height: Math.round(width * 16 / 9), duration, targetDuration: duration,
    renderStyle: inherited(settings, 'renderStyle', first.renderStyle),
    audioPreset: inherited(settings, 'audioPreset', first.audioPreset),
    musicTrack: inherited(settings, 'musicTrack', first.musicTrack),
    soundDesign: inherited(settings, 'soundDesign', first.soundDesign),
    environment: owns(settings, 'environment') ? normalizeEnvironment(settings.environment) : first.environment,
    cameraMode: 'film', story: { ...story, title, duration, enabled: anyTitles }, takes: [], renderSurfaces: {},
    film: { version: 1, enabled: true, title, clips: [] },
    analysis: { warnings: [], takes: [] },
    sourceProject: project.preview === true ? project : undefined,
  };
  let globalFrame = 0;
  for (const [clipIndex, child] of chunks.entries()) {
    const clip = film.clips[clipIndex], clipFrameStart = globalFrame, clipStart = globalFrame / fps, takeStart = data.takes.length;
    const surfaceIds = new Map();
    for (const [id, surface] of Object.entries(child.renderSurfaces || {})) {
      let outputId = id;
      if (owns(data.renderSurfaces, outputId) && JSON.stringify(data.renderSurfaces[outputId]) !== JSON.stringify(surface)) {
        outputId = `clip-${clipIndex + 1}:${id}`;
        while (owns(data.renderSurfaces, outputId)) outputId = '_' + outputId;
      }
      data.renderSurfaces[outputId] = surface; surfaceIds.set(id, outputId);
    }
    for (const take of child.takes) {
      const takeIndex = data.takes.length, start = globalFrame / fps;
      const frames = take.frames.map((frame, frameIndex) => ({
        ...frame,
        editorial: frame.editorial ? {
          ...frame.editorial, takeIndex, takeCount,
          // Existing renderers consume local take progress for segment bars.
          progress: frameIndex / Math.max(1, take.frames.length - 1),
          movieProgress: (globalFrame + frameIndex) / Math.max(1, frameCount - 1),
          movieTime: (globalFrame + frameIndex) / fps,
          clipIndex, clipCount: film.clips.length,
        } : frame.editorial,
      }));
      data.takes.push({
        ...take, label: clip.label || take.label, experiment: child.experiment,
        clipId: clip.id, clipIndex, clipLabel: clip.label, story: child.story,
        entities: take.entities.map(entity => entity.surface && surfaceIds.has(entity.surface) ? { ...entity, surface: surfaceIds.get(entity.surface) } : entity),
        start, duration: frames.length / fps, frames,
        impacts: (take.impacts || []).map(impact => ({ ...impact, t: clipStart + impact.t })),
      });
      globalFrame += frames.length;
    }
    const entry = {
      ...provenance[clipIndex], experiment: child.experiment,
      start: clipStart, duration: (globalFrame - clipFrameStart) / fps,
      frameStart: clipFrameStart, frameCount: globalFrame - clipFrameStart,
      takeStart, takeCount: child.takes.length, editing: child.editing,
    };
    data.film.clips.push(entry);
    for (const warning of child.analysis?.warnings || []) data.analysis.warnings.push(`${clip.label || `Клип ${clipIndex + 1}`}: ${warning}`);
    for (const analysis of child.analysis?.takes || []) data.analysis.takes.push({ ...analysis, clipId: clip.id, clipIndex });
  }
  Object.assign(data, captureModelProvenance(data.takes));
  data.editing = { mode: 'film', autoTrim: false, shortened: false, takeDurations: data.takes.map(t => t.duration), observationTimes: data.takes.map(t => t.observationTime) };
  await writeFile(cachePath, JSON.stringify(data));
  onProgress(14, `Монтаж собран: ${film.clips.length} клипов, ${duration.toLocaleString('ru-RU')} с`);
  return data;
}
