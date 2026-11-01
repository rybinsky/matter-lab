import { validateProject } from './validation.js';
import { normalizeCameraRig, retimeCameraRig } from './camera-rig.js';
import { normalizedStory } from './storyboard.js';

export const FILM_MAX_CLIPS = 48;
export const FILM_MAX_SECONDS = 180;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const fail = message => { throw new Error(`Некорректный фильм: ${message}`); };

/** Authoring defaults only. Validation never truncates excess clips. */
export function normalizeFilm(input = {}) {
  const value = object(input) ? input : {};
  return {
    version: 1, enabled: value.enabled === true, title: clean(value.title, 160),
    clips: (Array.isArray(value.clips) ? value.clips : []).map((clip, index) => ({
      id: clean(clip?.id, 160) || `clip-${index + 1}`,
      label: clean(clip?.label, 120),
      project: clip?.project === undefined ? undefined : structuredClone(clip.project),
    })),
  };
}

/** Open a child scene without making its old soundtrack the film soundtrack.
 * Scene authoring belongs to the child; identity, montage and delivery belong
 * to the root project. Absence of a root global setting means use its default,
 * not an accidentally inherited child override. No input object is reused.
 */
export function prepareFilmClipEditorProject(root,child){
 if(!object(root)||!object(root.settings)||!object(child)||!object(child.settings))fail('для открытия клипа нужны проект фильма и сцена клипа.');
 const result=structuredClone(child);
 for(const key of ['id','name','film','height']){
  delete result[key];if(Object.hasOwn(root,key))result[key]=structuredClone(root[key]);
 }
 for(const key of ['musicTrack','audioPreset','soundDesign','exportFps']){
  delete result.settings[key];if(Object.hasOwn(root.settings,key))result.settings[key]=structuredClone(root.settings[key]);
 }
 return result;
}

/** Matches capture's series:false timeline; physics duration is independent. */
export function filmClipDuration(project) {
  const rig = normalizeCameraRig(project?.settings?.cameraRig);
  if (['recorded', 'keys'].includes(rig.mode) && rig.points.length) return rig.duration;
  return normalizedStory(project?.settings?.story).duration;
}

/** Editing changes the clock, never the forces or the recorded camera poses. */
export function filmClipTiming(project){
 const rig=normalizeCameraRig(project?.settings?.cameraRig),manual=['recorded','keys'].includes(rig.mode)&&rig.points.length>1;
 return{duration:filmClipDuration(project),manual:!!manual,sourceStart:manual?rig.points[0].sourceTime:null,sourceEnd:manual?rig.points.at(-1).sourceTime:null};
}
export function setFilmClipTiming(project,change={}){
 const result=structuredClone(project),before=filmClipTiming(project),duration=change.duration??before.duration;
 if(!Number.isFinite(duration)||duration<(before.manual ? .1 : 5)||duration>120)throw new Error(`Длительность клипа — от ${before.manual?'0,1':'5'} до 120 секунд.`);
 const rangeChanged=change.sourceStart!==undefined||change.sourceEnd!==undefined;
 if(rangeChanged&&!before.manual)throw new Error('Диапазон опыта доступен для записанной камеры и ключевых кадров.');
 if(before.manual){
  const rig=retimeCameraRig(project.settings.cameraRig,duration);
  if(rangeChanged){
   const start=change.sourceStart??before.sourceStart,end=change.sourceEnd??before.sourceEnd;
   if(![start,end].every(Number.isFinite)||start<0||end<start||end>20)throw new Error('Диапазон опыта: начало ≤ конец, от 0 до 20 секунд.');
   const span=before.sourceEnd-before.sourceStart;
   rig.points=rig.points.map(p=>({...p,sourceTime:start+(end-start)*(Math.abs(span)>1e-8?(p.sourceTime-before.sourceStart)/span:p.time/duration)}));
   if(rig.points.some(p=>p.sourceTime<0||p.sourceTime>20))throw new Error('Выбранный диапазон выводит часть ключей за границы опыта.');
  }
  result.settings.cameraRig=rig;
 }
 const ratio=duration/before.duration;
 result.settings.story={...result.settings.story,duration,metricStart:(result.settings.story?.metricStart||0)*ratio,...(Array.isArray(result.settings.story?.cues)?{cues:result.settings.story.cues.map(c=>({...c,start:c.start*ratio,end:c.end*ratio,...(c.fade===undefined?{}:{fade:Math.min(1,c.fade*ratio)})}))}:{})};
 validateProject(result);return result;
}

export function filmDuration(input, { fps } = {}) {
  const clips = Array.isArray(input?.clips) ? input.clips : [];
  return clips.reduce((sum, clip) => {
    const duration = filmClipDuration(clip?.project);
    return sum + (Number.isFinite(fps) && fps > 0 ? Math.round(duration * fps) / fps : duration);
  }, 0);
}

/**
 * Read-only. Every clip is an ordinary project WITHOUT a film property, so a
 * validateProject -> validateFilm hook cannot recurse into another film.
 * Returns the original value by identity; undefined/null mean no film.
 */
export function validateFilm(input, { fps } = {}) {
  if (input === undefined || input === null) return input;
  if (!object(input) || input.version !== 1) fail('поддерживается версия 1.');
  if (typeof input.enabled !== 'boolean') fail('поле enabled должно быть включено или выключено.');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 160)) fail('название должно быть строкой длиной до 160 символов.');
  if (!Array.isArray(input.clips) || input.clips.length > FILM_MAX_CLIPS) fail(`допускается не больше ${FILM_MAX_CLIPS} клипов.`);
  const ids = new Set();
  input.clips.forEach((clip, index) => {
    const label = `клип ${index + 1}`;
    if (!object(clip)) fail(`${label}: ожидается описание клипа.`);
    if (typeof clip.id !== 'string' || !clip.id.trim() || clip.id.length > 160 || /[\u0000-\u001f\u007f]/.test(clip.id)) fail(`${label}: нужен непустой идентификатор до 160 символов.`);
    if (ids.has(clip.id)) fail(`${label}: повторяется идентификатор «${clip.id}».`);
    ids.add(clip.id);
    if (clip.label !== undefined && (typeof clip.label !== 'string' || clip.label.length > 120)) fail(`${label}: подпись должна быть строкой до 120 символов.`);
    if (!object(clip.project)) fail(`${label}: не указан проект сцены.`);
    if (Object.hasOwn(clip.project, 'film')) fail(`${label}: вложенные фильмы не поддерживаются.`);
    try { validateProject(clip.project); }
    catch (error) { fail(`${label}: ${error?.message || 'неверный проект сцены'}`); }
  });
  const seconds = filmDuration(input, { fps });
  if (!Number.isFinite(seconds) || seconds > FILM_MAX_SECONDS + 1e-8) fail(`общая длительность не должна превышать ${FILM_MAX_SECONDS} секунд.`);
  return input;
}
