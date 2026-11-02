import {normalizeSurfaceMotionScene} from './surface-motion-scene.js';
import {surfaceProfile} from './surface-motion.js';
const clone=structuredClone;
export function surfaceMotionObjects(project){return(project.objects||[]).map(o=>({...clone(o),...clone(project.edits?.[o.id]||{})})).filter(o=>!o.deleted&&!o.fixed&&!o.kinematic&&!o.renderOnly&&o.asset!=='softcube'&&!(o.deformable&&o.deformable.enabled!==false));}
const number=(value,label)=>{if(typeof value==='string'&&!value.trim())throw Error(`${label}: введите число.`);const n=Number(value);if(!Number.isFinite(n))throw Error(`${label}: введите конечное число.`);return n;};
export function surfaceMotionForm(project,selected){
 const c=project.settings.surfaceMotion,objects=surfaceMotionObjects(project),s=c?.surface||{},d=c?.drive||{},i=c?.initial||{};
 return{enabled:true,body:c?.body||(objects.some(o=>o.id===selected)?selected:objects[0]?.id)||'',kind:s.kind||'cone',radius:s.rimRadius??4.2,minRadius:s.minRadius??.05,height:s.kind==='cone'?(s.slope??2/3)*(s.rimRadius??4.2):2.8,curvature:s.curvature??.16,coefficients:(s.coefficients||[0,0,.16]).join(', '),offset:s.offset??0,origin:(c?.origin||[0,0,0]).slice(),initialRadius:i.radius??1.1,azimuth:(i.azimuth??0)*180/Math.PI,upslopeSpeed:i.upslopeSpeed??0,azimuthSpeed:i.azimuthSpeed??2.68,driveEnabled:d.enabled??true,targetSpeed:d.targetSpeed??6.6,response:d.response??.25,lateralDamping:d.lateralDamping??1/.65,friction:d.friction??.65,maxForce:d.maxForce??280,maxPower:d.maxPower??1400,apronWidth:c?.render?.apronWidth??3,color:c?.render?.color||'#DEDCD4'};
}
export function surfaceMotionDraftConfig(project,form){
 const n=(key,label)=>number(form[key],label),radius=n('radius','Радиус края'),kind=form.kind;
 let surface={kind,minRadius:n('minRadius','Внутренний край'),rimRadius:radius};
 if(kind==='cone')surface={...surface,slope:n('height','Глубина')/radius,offset:n('offset','Смещение профиля')};
 else if(kind==='paraboloid')surface={...surface,curvature:n('curvature','Кривизна'),offset:n('offset','Смещение профиля')};
 else if(kind==='polynomial')surface={...surface,coefficients:String(form.coefficients).split(/[,;\s]+/).filter(Boolean).map(v=>number(v,'Коэффициент профиля'))};
 const previous=project.settings.surfaceMotion||{},body=surfaceMotionObjects(project).find(o=>o.id===form.body);
 return normalizeSurfaceMotionScene({...clone(previous),body:form.body||'surface-preview',mass:body?.mass||previous.mass||70,gravity:project.settings.gravity??9.81,origin:form.origin.map(v=>number(v,'Положение поверхности')),surface,initial:{radius:n('initialRadius','Начальный радиус'),azimuth:n('azimuth','Угол старта')*Math.PI/180,upslopeSpeed:n('upslopeSpeed','Скорость вверх по склону'),azimuthSpeed:n('azimuthSpeed','Начальная скорость по кругу')},drive:{enabled:!!form.driveEnabled,targetSpeed:n('targetSpeed','Целевая скорость'),response:n('response','Время разгона'),lateralDamping:n('lateralDamping','Поперечное торможение'),friction:n('friction','Сцепление'),maxForce:n('maxForce','Предел силы'),maxPower:n('maxPower','Предел мощности')},render:{...clone(previous.render||{}),color:form.color,apronWidth:n('apronWidth','Площадка у края')}});
}
export function compileSurfaceMotion(project,form,createdBody=null){
 const p=clone(project);
 if(!form.enabled){delete p.settings.surfaceMotion;return p;}
 if(p.settings.experiment!=='blank')throw Error('Откройте свободную сцену для движения по поверхности.');
 if(createdBody){if(p.objects.some(o=>o.id===createdBody.id))throw Error('Идентификатор нового предмета уже занят.');p.objects.push(clone(createdBody));}
 if(!surfaceMotionObjects(p).some(o=>o.id===form.body))throw Error('Выберите свободный твёрдый предмет.');
 const config=surfaceMotionDraftConfig(p,form),body=surfaceMotionObjects(p).find(o=>o.id===form.body);
 if(body.angularVelocity?.some(v=>Math.abs(v)>1e-9))throw Error('Для движения по поверхности обнулите начальное вращение предмета.');
 if((p.settings.connections||[]).some(c=>c.a===body.id||c.b===body.id)||(p.settings.assemblies||[]).some(a=>a.bonds?.some(b=>b.a===body.id||b.b===body.id)))throw Error('Сначала снимите связи выбранного предмета.');
 if(p.settings.windSpeed||p.settings.atmosphere?.enabled)throw Error('Для этого опыта отключите ветер и атмосферу.');
 p.settings.surfaceMotion=config;p.settings.focusId=body.id;
 return p;
}
export function circularBalanceSpeed(project,form){const c=surfaceMotionDraftConfig(project,form),p=surfaceProfile(c.surface,c.initial.radius),squared=c.gravity*p.slope*c.initial.radius;if(squared<0)throw Error('У этого профиля в точке старта нет кругового равновесия.');return Math.sqrt(squared);}
