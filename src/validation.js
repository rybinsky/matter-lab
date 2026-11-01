import { CATALOG, EXPERIMENTS, MATERIALS } from './catalog.js';
import { COMPARISON_FIELDS, COMPARISON_MATERIALS } from './comparison.js';
import { CAMERA_ATTENTION_LIMITS } from './camera-rig.js';
import { PATTERNS, layoutPoints } from './layouts.js';
import {validateBreakableAssemblies} from './breakable-assemblies.js';
import {validateDeformableSpec,supportsDeformableAsset} from './deformable-assets.js';
import {validatePenetrationScene} from './penetration-scene.js';
import {normalizeContextView} from './context-view.js';
import {normalizeConnectionVisual} from './connection-visuals.js';
import {normalizeAtmosphere,normalizeBuoyancy} from './atmosphere.js';
import {normalizeSceneAnnotations} from './scene-annotations.js';

const assets = new Set(CATALOG.map(a => a.id));
const experiments = new Set([...EXPERIMENTS.map(e => e.id), 'blank']);
const shapeArity = { box: 3, ellipsoid: 3, sphere: 1, icosa: 1, cylinder: 2, cone: 2, torus: 2 };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined;
const fail = (where, message) => { throw new Error(`Некорректный проект: ${where} — ${message}`); };

function object(value, where) {
  if (!record(value)) fail(where, 'ожидается объект с настройками');
}
function text(value, where, max = 160, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) fail(where, `ожидается ${allowEmpty ? '' : 'непустая '}строка длиной до ${max} символов`);
}
function number(value, where, min = -1e6, max = 1e6, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (positive && value <= 0)) fail(where, `нужно конечное ${positive ? 'положительное ' : ''}число от ${min} до ${max}`);
}
function optionalNumber(value, where, min, max, positive = false) {
  if (present(value)) number(value, where, min, max, positive);
}
function vector(value, where, limit = 10000) {
  if (!Array.isArray(value) || value.length !== 3) fail(where, 'нужны ровно три координаты');
  value.forEach((v, i) => number(v, `${where}, ${'XYZ'[i]}`, -limit, limit));
}
function rotation(value, where) {
  if (Array.isArray(value)) return vector(value, where, 1e6);
  object(value, where);
  for (const axis of ['x', 'y', 'z', 'w']) number(value[axis], `${where}, ${axis}`, -1e6, 1e6);
  if (Math.hypot(value.x, value.y, value.z, value.w) <= 0) fail(where, 'кватернион поворота не может быть нулевым');
}
function material(value, where) {
  if (present(value) && (typeof value !== 'string' || !Object.hasOwn(MATERIALS, value))) fail(where, 'такого материала нет в библиотеке');
}
function boolean(value, where) {
  if (present(value) && typeof value !== 'boolean') fail(where, 'ожидается включено или выключено');
}
function list(value, where, limit, required = false) {
  if (!present(value) && !required) return [];
  if (!Array.isArray(value) || value.length > limit) fail(where, `нужен список, не больше ${limit} элементов`);
  return value;
}
function parts(value, where) {
  const items = list(value, where, 200, true);
  if (!items.length) fail(where, 'у составного предмета должна быть хотя бы одна часть');
  items.forEach((part, i) => {
    const label = `${where}, часть ${i + 1}`;
    object(part, label);
    if (!Object.hasOwn(shapeArity, part.shape)) fail(label, 'неизвестная геометрическая форма');
    if (!Array.isArray(part.d) || part.d.length !== shapeArity[part.shape]) fail(label, `для формы «${part.shape}» нужно размеров: ${shapeArity[part.shape]}`);
    part.d.forEach((d, k) => number(d, `${label}, размер ${k + 1}`, 0, 10000, true));
    if (present(part.p)) vector(part.p, `${label}, положение`);
    if (present(part.r)) vector(part.r, `${label}, поворот`, 1e6);
  });
}
function transforms(spec, where) {
  if(present(spec.buoyancy))try{normalizeBuoyancy(spec.buoyancy);}catch(error){fail(where,error.message);}
  if(present(spec.deformable))try{validateDeformableSpec(spec);}catch(error){fail(where,error.message);}
  if (present(spec.position)) vector(spec.position, `${where}, положение`);
  if (present(spec.velocity)) vector(spec.velocity, `${where}, скорость`, 1e6);
  if (present(spec.angularVelocity)) vector(spec.angularVelocity, `${where}, угловая скорость`, 1e4);
  if (present(spec.rotation)) rotation(spec.rotation, `${where}, поворот`);
  optionalNumber(spec.scale, `${where}, масштаб`, .001, 1000, true);
  optionalNumber(spec.mass, `${where}, масса`, 0, 1e6, true);
  optionalNumber(spec.friction, `${where}, трение`, 0, 100);
  optionalNumber(spec.restitution, `${where}, отскок`, 0, 1);
  optionalNumber(spec.linearDamping,`${where}, линейное затухание`,0,100);
  optionalNumber(spec.angularDamping,`${where}, угловое затухание`,0,100);
  material(spec.material, `${where}, материал`);
  boolean(spec.fixed, `${where}, закрепление`);
  boolean(spec.kinematic, `${where}, управляемое движение`);
  boolean(spec.appearanceFromMaterial, `${where}, цвет материала`);
  if(present(spec.appearance)&&spec.appearance!==null){
    object(spec.appearance,`${where}, внешний вид`);
    if(Object.keys(spec.appearance).some(k=>!['color','roughness','metalness'].includes(k)))fail(`${where}, внешний вид`,'неизвестный параметр');
    if(present(spec.appearance.color)&&(typeof spec.appearance.color!=='string'||!/^#[\da-f]{6}$/i.test(spec.appearance.color)))fail(`${where}, цвет`,'нужен цвет в формате #RRGGBB');
    optionalNumber(spec.appearance.roughness,`${where}, шероховатость`,0,1);
    optionalNumber(spec.appearance.metalness,`${where}, металличность`,0,1);
  }
}
function launch(spec, where) {
  object(spec, where);
  optionalNumber(spec.speed, `${where}, скорость`, 0, 1e6);
  optionalNumber(spec.azimuth, `${where}, азимут`, -360000, 360000);
  optionalNumber(spec.elevation, `${where}, угол вверх`, -360000, 360000);
  optionalNumber(spec.delay, `${where}, задержка`, 0, 3600);
}

function validateStory(story) {
  if (!present(story)) return;
  object(story, 'история ролика');
  boolean(story.enabled, 'история, включение');
  optionalNumber(story.duration, 'история, длительность', .1, 600);
  optionalNumber(story.metricStart, 'история, появление показателя', 0, 120);
  if(present(story.cues)){
   const cues=list(story.cues,'дорожка пояснений',24).slice();
   for(const cue of cues){object(cue,'пояснение');number(cue.start,'начало пояснения',0,120);number(cue.end,'конец пояснения',0,120);if(cue.end<=cue.start)fail('пояснение','конец должен быть позже начала');text(cue.text,'текст пояснения',96);if(present(cue.label))text(cue.label,'условия пояснения',120,true);boolean(cue.hideMetric,'скрытие показателя');optionalNumber(cue.fade,'плавность появления пояснения',0,1);}
   cues.sort((a,b)=>a.start-b.start);for(let i=1;i<cues.length;i++)if(cues[i].start<cues[i-1].end)fail('дорожка пояснений','интервалы не должны пересекаться');
  }
  if (present(story.heroId)) text(story.heroId, 'история, главный предмет', 160, true);
  if (present(story.effects)) {
    object(story.effects, 'эффекты истории');
    for (const [key, value] of Object.entries(story.effects)) boolean(value, `эффект «${key}»`);
  }
}
function validateCameraRig(rig){
 if(!present(rig))return;object(rig,'режиссура камеры');
 if(!['auto','static','recorded','keys'].includes(rig.mode))fail('режим камеры','выберите авто, ракурс, запись или ключи');
 if(present(rig.anchorId))text(rig.anchorId,'якорь камеры',160,true);
 let previous=-1;
 list(rig.points,'кадры камеры',3601).forEach((p,i)=>{
  object(p,`кадр камеры ${i+1}`);number(p.time,'время кадра',0,120);if(p.time<=previous)fail('кадры камеры','время должно возрастать');previous=p.time;
  optionalNumber(p.sourceTime,'физическое время кадра',0,20);vector(p.position,'позиция камеры',1e8);vector(p.target,'точка взгляда',1e8);
  if(Math.hypot(...p.position.map((x,k)=>x-p.target[k]))<.00001)fail('точка взгляда','камера и цель должны различаться');
  optionalNumber(p.fov,'угол обзора',20,75);boolean(p.cut,'склейка камеры');
  const validateIds=(value)=>{const ids=list(value,'предметы цели камеры',CAMERA_ATTENTION_LIMITS.ids);ids.forEach(id=>text(id,'предмет цели камеры',160));if(new Set(ids).size!==ids.length)fail('цель камеры','предметы не должны повторяться');return ids.length;};
  if(present(p.attentionIds))validateIds(p.attentionIds);
  if(present(p.attentionOffset))vector(p.attentionOffset,'смещение цели камеры',1e8);
  if(present(p.attentionTransition)&&!['smooth','linear','cut'].includes(p.attentionTransition))fail('переход цели камеры','выберите smooth, linear или cut');
  if(present(p.attentionMix)){
   let references=0,total=0;
   const descriptors=list(p.attentionMix,'смесь целей камеры',CAMERA_ATTENTION_LIMITS.mix);
   for(const d of descriptors){object(d,'цель монтажной камеры');number(d.weight,'вес цели камеры',0,1,true);total+=d.weight;references+=validateIds(d.ids);vector(d.target,'резервная точка цели',1e8);vector(d.offset,'смещение монтажной цели',1e8);}
   if(!descriptors.length||Math.abs(total-1)>.00001)fail('смесь целей камеры','сумма весов должна равняться 1');
   if(references>CAMERA_ATTENTION_LIMITS.mixIdReferences)fail('смесь целей камеры','слишком много ссылок на предметы');
  }
 });
}
function validateComparison(spec) {
  if (!present(spec)) return;
  object(spec, 'сравнение');
  boolean(spec.enabled, 'сравнение, включение');
  if (present(spec.version) && spec.version !== 1) fail('сравнение', 'эта версия формата не поддерживается');
  const field = COMPARISON_FIELDS.find(f => f.id === (spec.field || spec.parameter || 'speed'));
  if (!field) fail('сравнение', 'неизвестный параметр');
  if (present(spec.targetId)) text(spec.targetId, 'сравнение, предмет', 160, true);
  if (present(spec.values)) {
    if (!Array.isArray(spec.values) || spec.values.length !== 4) fail('сравнение', 'нужны четыре значения параметра');
    spec.values.forEach((value, i) => {
      if (field.id === 'material') {
        if (!COMPARISON_MATERIALS.some(m => m.id === value)) fail(`сравнение, вариант ${i + 1}`, 'выберите материал твёрдого тела');
      } else number(value, `сравнение, вариант ${i + 1}`, field.min, field.max);
    });
  }
  list(spec.labels, 'подписи сравнения', 4).forEach((label, i) => text(label, `подпись варианта ${i + 1}`, 64, true));
}

function validateGeneratorConnection(spec,where){
 object(spec,where);
 if(present(spec.id))text(spec.id,`${where}, идентификатор`);
 text(spec.a,`${where}, первый предмет`);
 if(present(spec.b))text(spec.b,`${where}, второй предмет`,160,true);
 if(spec.a===spec.b)fail(where,'нельзя связать предмет с самим собой');
 if(present(spec.type)&&!['fixed','hinge','ball','spring','rope'].includes(spec.type))fail(where,'неизвестный тип связи');
 if(present(spec.axis)&&!['x','y','z'].includes(spec.axis))fail(where,'выберите ось X, Y или Z');
 if(present(spec.point))vector(spec.point,`${where}, точка подвеса`);
 for(const key of ['anchorA','anchorB'])if(present(spec[key])){if(spec.type!=='rope')fail(where,'локальные точки anchorA/anchorB предназначены для верёвки');vector(spec[key],`${where}, локальная точка ${key}`);}
 optionalNumber(spec.length,`${where}, длина`,0,10000,true);
 optionalNumber(spec.stiffness,`${where}, жёсткость`,0,1e8,true);
 optionalNumber(spec.damping,`${where}, затухание`,0,1e6);
 try{normalizeConnectionVisual(spec.visual);}catch(error){fail(where,error.message);}
}

function validateGenerators(value){
 const ids=new Set();
 for(const[gIndex,g]of list(value,'расстановки',150).entries()){
  const where=`расстановка ${gIndex+1}`;object(g,where);
  // Generated body/joint suffixes must still fit the project's 160-char ids.
  text(g.id,`${where}, идентификатор`,140);
  if(ids.has(g.id))fail(where,'идентификаторы расстановок должны быть разными');ids.add(g.id);
  text(g.name,`${where}, название`);
  if(!PATTERNS.some(p=>p.id===g.pattern))fail(where,'неизвестная схема размещения');
  vector(g.count,`${where}, количество`,30);
  if(g.count.some(n=>n<1||!Number.isInteger(n)))fail(where,'количество по каждой оси должно быть целым от 1 до 30');
  for(const key of ['step','origin','extent'])vector(g[key],`${where}, ${key}`);
  if(g.extent.some(n=>n<0))fail(where,'размер области не может быть отрицательным');
  for(const key of ['rotation','turn'])vector(g[key],`${where}, ${key}`,1e6);
  optionalNumber(g.radius,`${where}, радиус`,0,10000,true);
  optionalNumber(g.turns,`${where}, обороты`,0,10000,true);
  optionalNumber(g.jitter,`${where}, разброс положения`,0,10000);
  optionalNumber(g.angleJitter,`${where}, разброс поворота`,0,360);
  optionalNumber(g.scaleJitter,`${where}, разброс размера`,0,.99);
  optionalNumber(g.seed,`${where}, зерно`,0,0xffffffff);
  if(present(g.seed)&&!Number.isInteger(g.seed))fail(where,'случайное зерно должно быть целым');
  boolean(g.fixed,`${where}, закрепление`);boolean(g.align,`${where}, поворот по траектории`);
  if(present(g.fixedMode)&&!['preserve','fixed','dynamic'].includes(g.fixedMode))fail(where,'неизвестный режим закрепления');
  if(present(g.velocity))vector(g.velocity,`${where}, скорость`,1e6);
  const sources=list(g.sources,`${where}, исходные предметы`,150,true),sourceIds=new Set();
  if(!sources.length)fail(where,'выберите хотя бы один исходный предмет');
  for(const[sIndex,source]of sources.entries()){
   const label=`${where}, источник ${sIndex+1}`;object(source,label);
   // Earlier composer versions stored Rapier's zero mass for fixed sources.
   // Geometry builders already use their documented 1 kg fallback on release.
   transforms(source.fixed===true&&source.mass===0?{...source,mass:1}:source,label);
   if(present(source.parts))parts(source.parts,`${label}, геометрия`);
   if(present(source.visualParts))parts(source.visualParts,`${label}, визуальная геометрия`);
   if(!assets.has(source.asset)&&!Array.isArray(source.parts)&&!(source.deformable&&source.deformable.enabled!==false&&(source.asset==='ellipsoid'||source.deformable.surface)))fail(label,'неизвестный предмет или отсутствует составная геометрия');
   if(present(source.name))text(source.name,`${label}, название`);
   if(present(source.offset))vector(source.offset,`${label}, смещение`);
   if(present(source.sourceId))text(source.sourceId,`${label}, идентификатор источника`);
   if(present(source.id))text(source.id,`${label}, идентификатор`);
   const id=source.sourceId||source.id;
   if(id){if(sourceIds.has(id))fail(label,'идентификаторы исходных предметов должны быть разными');sourceIds.add(id);}
  }
  const copies=layoutPoints(g).length;
  if(copies*sources.length>150)fail(where,'после построения будет больше 150 предметов');
  const connectionIds=new Set();let internal=0;
  for(const[cIndex,c]of list(g.sourceConnections,`${where}, связи источника`,150).entries()){
   const label=`${where}, связь источника ${cIndex+1}`;validateGeneratorConnection(c,label);
   if(c.id){if(connectionIds.has(c.id))fail(label,'идентификаторы связей должны быть разными');connectionIds.add(c.id);}
   // External links are valid template metadata: the composer exposes their
   // explicit omission instead of guessing new attachments to the old scene.
   if(sourceIds.has(c.a)&&sourceIds.has(c.b))internal++;
  }
  if(copies*internal>150)fail(where,'после построения будет больше 150 связей');
 }
}

/** Detect non-JSON numbers anywhere, including optional future metadata. */
function finiteData(root) {
  const active = new WeakSet(); let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 200000 || depth > 32) fail('структура файла', 'слишком большой или глубоко вложенный проект');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('числовые данные', 'обнаружено бесконечное или неопределённое число');
    if (!value || typeof value !== 'object') return;
    if (active.has(value)) fail('структура файла', 'обнаружена циклическая ссылка');
    active.add(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
    active.delete(value);
  }
  visit(root, 0);
}

/**
 * Shared by importing, previewing and rendering. No DOM, coercion, defaults,
 * cloning or mutation: a valid project is returned by identity.
 */
export function validateProject(project) {
  object(project, 'файл');
  if (project.version !== 1) fail('версия файла', 'поддерживается версия 1');
  object(project.settings, 'настройки мира');
  const settings = project.settings;
  if (!experiments.has(settings.experiment)) fail('сценарий', 'такого сценария нет в лаборатории');
  finiteData(project);
  const ids = new Set();
  list(project.objects, 'предметы сцены', 150, true).forEach((spec, i) => {
    const where = `предмет ${i + 1}`;
    object(spec, where);
    if (present(spec.id)) {
      text(spec.id, `${where}, имя в сцене`);
      if (ids.has(spec.id)) fail(where, `повторяется идентификатор «${spec.id}»`);
      ids.add(spec.id);
    }
    if (present(spec.parts) && !(spec.asset === 'softcube' && Array.isArray(spec.parts) && !spec.parts.length)) parts(spec.parts, `${where}, геометрия`);
    if (present(spec.visualParts)) parts(spec.visualParts, `${where}, визуальная геометрия`);
    if (!assets.has(spec.asset) && !Array.isArray(spec.parts) && !(spec.deformable&&spec.deformable.enabled!==false&&(spec.asset==='ellipsoid'||spec.deformable.surface))) fail(where, 'выберите предмет из библиотеки или задайте составную геометрию');
    transforms(spec, where);
    if (present(spec.launch)) launch(spec.launch, `${where}, запуск`);
    const merged={...spec,...project.edits?.[spec.id]};
    if(merged.buoyancy&&merged.buoyancy.enabled!==false&&(merged.asset==='softcube'||merged.deformable&&merged.deformable.enabled!==false))fail(where,'постоянный вытесненный объём атмосферы поддерживается только у твёрдых тел');
    if(!merged.deleted&&merged.deformable&&merged.deformable.enabled!==false){if(merged.fixed||merged.kinematic)fail(where,'мягкое тело не может быть fixed/kinematic без отдельного закрепления частиц');if(!supportsDeformableAsset(merged))fail(where,'для этого мягкого предмета нужна отдельная замкнутая оболочка');}
  });
  optionalNumber(settings.gravity, 'ускорение свободного падения', 0, 1e6);
  try{normalizeAtmosphere(settings.atmosphere);}catch(error){fail('атмосфера',error.message);}
  try{normalizeSceneAnnotations(settings.annotations);}catch(error){fail('подписи в сцене',error.message);}
  launch(settings, 'начальное движение');
  optionalNumber(settings.mass, 'масса в настройках', 0, 1e6, true);
  material(settings.material, 'материал в настройках');
  validateStory(settings.story);
  validateComparison(settings.comparison);
  validateCameraRig(settings.cameraRig);
  try{normalizeContextView(settings.contextView);}catch(error){fail('дополнительный ракурс',error.message);}
  validateGenerators(settings.generators);
  try{validateBreakableAssemblies(settings.assemblies);}catch(error){fail('разрушаемые сборки',error.message);}
  if(present(settings.penetration)){
   try{validatePenetrationScene(settings.penetration);}catch(error){fail('проникновение и теплообмен',error.message);}
   const config=settings.penetration,source=id=>{const item=project.objects.find(o=>o.id===id);return item?{...item,...project.edits?.[id]}:null;},shot=source(config.projectileId),target=source(config.targetId);
   if(!shot||!target||shot.deleted||target.deleted)fail('проникновение и теплообмен','выберите существующие предметы сцены');
   if(shot.fixed||shot.kinematic||shot.deformable?.enabled!==false&&shot.deformable||shot.asset==='softcube'||!target.fixed||target.asset==='softcube'||target.deformable?.enabled!==false&&target.deformable)fail('проникновение и теплообмен','нужны свободный твёрдый снаряд и закреплённый твёрдый образец');
   if(project.edits?.[shot.id]?.launch||shot.launch)fail('проникновение и теплообмен','скорость снаряда задаётся в параметрах модели');
   if((settings.connections||[]).some(c=>c.a===shot.id||c.b===shot.id)||(settings.assemblies||[]).some(a=>a.bonds.some(b=>b.a===shot.id||b.b===shot.id)))fail('проникновение и теплообмен','снаряд осевой модели нельзя связывать с другими телами');
  }
  if(present(settings.measurement)){
   object(settings.measurement,'измерение');optionalNumber(settings.measurement.threshold,'порог измерения',.01,2);
   list(settings.measurement.objectIds,'измеряемые предметы',500).forEach(id=>text(id,'предмет измерения'));
  }

  if (present(project.edits)) {
    object(project.edits, 'изменения предметов');
    const entries = Object.entries(project.edits);
    if (entries.length > 500) fail('изменения предметов', 'не больше 500 изменённых предметов');
    for (const [id, edit] of entries) {
      text(id, 'идентификатор изменённого предмета');
      object(edit, `изменения «${id}»`);
      transforms(edit, `изменения «${id}»`);
      boolean(edit.deleted, `изменения «${id}», удаление`);
      if (present(edit.launch)) launch(edit.launch, `запуск «${id}»`);
    }
  }
  const connectionIds = new Set();
  list(settings.connections, 'связи предметов', 150).forEach((spec, i) => {
    const where = `связь ${i + 1}`; object(spec, where);
    if(present(spec.name))text(spec.name,`${where}, название`);
    if (present(spec.id)) {
      text(spec.id, `${where}, идентификатор`);
      if (connectionIds.has(spec.id)) fail(where, 'идентификаторы связей должны быть разными');
      connectionIds.add(spec.id);
    }
    text(spec.a, `${where}, первый предмет`);
    if (present(spec.b)) text(spec.b, `${where}, второй предмет`, 160, true);
    if (spec.a === spec.b) fail(where, 'нельзя связать предмет с самим собой');
    if (present(spec.type) && !['fixed', 'hinge', 'ball', 'spring','rope'].includes(spec.type)) fail(where, 'неизвестный тип связи');
    if (present(spec.axis) && !['x', 'y', 'z'].includes(spec.axis)) fail(where, 'выберите ось X, Y или Z');
    if (present(spec.point)) vector(spec.point, `${where}, точка подвеса`);
    for(const key of ['anchorA','anchorB'])if(present(spec[key])){if(spec.type!=='rope')fail(where,'локальные точки anchorA/anchorB предназначены для верёвки');vector(spec[key],`${where}, локальная точка ${key}`);}
    optionalNumber(spec.length, `${where}, длина`, 0, 10000, true);
    optionalNumber(spec.stiffness, `${where}, жёсткость`, 0, 1e8, true);
    optionalNumber(spec.damping, `${where}, затухание`, 0, 1e6);
    try{normalizeConnectionVisual(spec.visual);}catch(error){fail(where,error.message);}
  });
  let emittedCount = 0; const emitterIds = new Set();
  list(settings.emitters, 'источники предметов', 20).forEach((spec, i) => {
    const where = `источник ${i + 1}`; object(spec, where);
    if (present(spec.id)) {
      text(spec.id, `${where}, идентификатор`);
      if (emitterIds.has(spec.id)) fail(where, 'идентификаторы источников должны быть разными');
      emitterIds.add(spec.id);
    }
    if (present(spec.asset) && (!assets.has(spec.asset) || spec.asset === 'softcube')) fail(where, 'источник выпускает твёрдые предметы из библиотеки');
    transforms(spec, where); launch(spec, where);
    if (present(spec.count) && (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > 50)) fail(where, 'количество должно быть целым числом от 1 до 50');
    optionalNumber(spec.interval, `${where}, интервал`, 0, 3600, true);
    emittedCount += spec.count ?? 12;
  });
  if (emittedCount > 500) fail('источники предметов', 'в сумме можно выпустить не больше 500 предметов');
  if(settings.experiment==='blank'&&settings.assemblies?.length){const known=new Set(['ground',...project.objects.filter(o=>!project.edits?.[o.id]?.deleted).map(o=>o.id)]);for(const e of settings.emitters||[])for(let i=0;i<(e.count||12);i++)known.add(`${e.id}-${i}`);try{validateBreakableAssemblies(settings.assemblies,{knownBodyIds:known});}catch(error){fail('разрушаемые сборки',error.message);}}
  return project;
}
