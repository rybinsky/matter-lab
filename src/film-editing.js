import { normalizeCameraRig, createCameraSampler } from './camera-rig.js';
import { validateProject } from './validation.js';

const MAX_CAMERA_POINTS = 3601;
const MIN_KEY_INTERVAL = .0001;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(`Монтаж клипа: ${message}`); };
const validId = id => typeof id === 'string' && id.trim() && id.length <= 160 && !/[\u0000-\u001f\u007f]/.test(id);

function editingContext(clip, fps) {
  if (![24, 30, 60].includes(fps)) fail('частота кадров должна быть 24, 30 или 60.');
  if (!isObject(clip) || !validId(clip.id) || !isObject(clip.project)) fail('нужен сохранённый клип с идентификатором и проектом сцены.');
  if (Object.hasOwn(clip.project, 'film')) fail('вложенные фильмы не поддерживаются.');
  validateProject(clip.project);
  const rig = normalizeCameraRig(clip.project.settings?.cameraRig);
  if (!['recorded', 'keys'].includes(rig.mode) || rig.points.length < 2) fail('сначала запишите камеру или сохраните маршрут из нескольких ключей.');
  const frames = Math.round(rig.duration * fps);
  return { rig, fps, frames, duration: frames / fps, scale: rig.duration / (frames / fps), sample: createCameraSampler(rig) };
}

function selectedFrames(context, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Math.max(context.duration, context.rig.duration) + 1e-8) fail('задайте начало и конец внутри клипа; конец должен быть позже начала.');
  const first = Math.round(start * context.fps), last = Math.round(end * context.fps);
  if (first < 0 || last > context.frames || first >= last || (last - first) / context.fps < .1 - 1e-8) fail('после привязки к кадрам фрагмент должен длиться хотя бы 0,1 секунды и находиться внутри клипа.');
  return { first, last };
}

function values(point) {
  return [...point.position, ...point.target, point.fov, point.sourceTime];
}

// Remove only straight runs. A cut and the key immediately before it are
// retained, since that preceding key defines the pose held before the cut.
function simplifyLinearRuns(points) {
  const result = [];
  for (const point of points) {
    result.push(point);
    while (result.length > 2) {
      const [a, b, c] = result.slice(-3);
      if (b.cut || c.cut || a.attentionMix || b.attentionMix || c.attentionMix) break;
      const ratio = (b.time - a.time) / (c.time - a.time);
      const av = values(a), bv = values(b), cv = values(c);
      const straight = bv.every((value, index) => {
        const predicted = av[index] + (cv[index] - av[index]) * ratio;
        return Math.abs(value - predicted) <= 1e-11 + 1e-14 * Math.max(Math.abs(value), Math.abs(predicted));
      });
      if (!straight) break;
      result.splice(-2, 1);
    }
  }
  return result;
}

function croppedRig(context, first, last) {
  const { rig, fps, scale } = context, start = first / fps, end = last / fps;
  const at = (time, oldMovieTime = start + time, rigTime = oldMovieTime / context.duration * rig.duration) => {
    // Coordinates remain relative to the existing anchor. capture() adds the
    // sampled body's position once, at the unchanged physical source time.
    const sample = context.sample(rigTime);
    return { time, sourceTime: sample.sourceTime, position: sample.position, target: sample.target, fov: sample.fov, cut: false,
      ...(sample.attentionMix?{attentionMix:sample.attentionMix,attentionTransition:'linear'}:{}) };
  };
  const points = Array.from({ length: last - first + 1 }, (_, index) => at(index / fps, (first + index) / fps));
  // Original source-clock breakpoints preserve freezes, rewinds and sound
  // event timing between output frames. Close keys cannot survive the rig's
  // normalizer; in that case the exact frame samples take precedence.
  for (const original of rig.points) {
    const movieTime = original.time / scale;
    if (movieTime <= start + 1e-10 || movieTime >= end - 1e-10) continue;
    const local = movieTime - start, nearestFrame = Math.round(local * fps);
    const frameDistance = Math.abs(points[nearestFrame].time - local);
    if (frameDistance < MIN_KEY_INTERVAL) {
      if (original.cut) points[Math.min(points.length - 1, Math.ceil(local * fps - 1e-9))].cut = true;
      continue;
    }
    const point = at(local, movieTime, original.time);
    point.cut = original.cut;
    points.push(point);
  }
  points.sort((a, b) => a.time - b.time);
  const reduced = simplifyLinearRuns(points);
  if (reduced.length > MAX_CAMERA_POINTS) fail(`фрагмент требует ${reduced.length} ключей камеры при ${fps} кадрах/с; предел — ${MAX_CAMERA_POINTS}. Выберите более короткий фрагмент или меньшую частоту кадров.`);
  return { ...rig, mode: 'keys', interpolation: 'linear', duration: (last - first) / fps, points: reduced };
}

function cropClip(clip, context, first, last) {
  const result = structuredClone(clip), start = first / context.fps, end = last / context.fps;
  result.project.settings.cameraRig = croppedRig(context, first, last);
  const story = result.project.settings.story ?? {};
  result.project.settings.story = {
    ...story, duration: end - start,
    ...(story.metricStart === undefined ? {} : { metricStart: Math.max(0, story.metricStart - start) }),
    ...(Array.isArray(story.cues) ? {
      cues: story.cues.flatMap(cue => {
        const from = Math.max(start, cue.start), until = Math.min(end, cue.end);
        return until <= from ? [] : [{
          ...cue, start: from - start, end: until - start,
          ...(cue.fade === undefined ? {} : { fade: Math.min(cue.fade, (until - from) / 2) }),
        }];
      }),
    } : {}),
  };
  validateProject(result.project);
  return result;
}

/**
 * Keep movie interval [start,end), snapped to the requested export frame grid.
 * Camera samples at that fps and the physical source clock are preserved;
 * smooth camera paths are baked because clipping Hermite keys changes tangents.
 * The input and all physical objects/settings remain untouched. Switching fps
 * later interpolates the baked route rather than restoring the original curve.
 */
export function trimFilmClip(clip, { start, end, fps = 60 } = {}) {
  const context = editingContext(clip, fps), { first, last } = selectedFrames(context, start, end);
  return cropClip(clip, context, first, last);
}

/** Split into independent clips. Left retains its id; the caller names right. */
export function splitFilmClip(clip, at, { rightId, fps = 60 } = {}) {
  const context = editingContext(clip, fps);
  if (!validId(rightId) || rightId === clip.id) fail('задайте новому фрагменту отдельный непустой идентификатор.');
  if (!Number.isFinite(at) || at <= 0 || at >= context.duration) fail('точка разреза должна находиться внутри клипа.');
  const cut = Math.round(at * fps);
  selectedFrames(context, 0, cut / fps);
  selectedFrames(context, cut / fps, context.duration);
  const left = cropClip(clip, context, 0, cut), right = cropClip(clip, context, cut, context.frames);
  right.id = rightId;
  return [left, right];
}
