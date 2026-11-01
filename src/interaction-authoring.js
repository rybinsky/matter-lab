import {MATERIALS} from './catalog.js';
import {supportsDeformableAsset,validateDeformableSpec} from './deformable-assets.js';
import {DEFAULT_PENETRATION_PARAMETERS} from './penetration.js';
import {validatePenetrationScene} from './penetration-scene.js';
import {validateBreakableAssemblies} from './breakable-assemblies.js';
import {validateProject} from './validation.js';
import {normalizeAtmosphere,normalizeBuoyancy} from './atmosphere.js';

const copy=structuredClone;
const text=v=>v===undefined?'':String(v);
const number=(v,label)=>{if(typeof v!=='number'&&(typeof v!=='string'||!v.trim()))throw Error(`Заполните поле «${label}».`);const n=Number(typeof v==='string'?v.trim().replace(',','.'):v);if(!Number.isFinite(n))throw Error(`Поле «${label}»: нужно конечное число.`);return n;};
export const DEFORMATION_FIELDS=Object.freeze([
 {key:'cellSize',label:'Размер ячейки',unit:'м',min:.001,max:1000},
 {key:'young',label:'Модуль Юнга E',unit:'Па',min:10,max:1e7},
 {key:'poisson',label:'Коэффициент Пуассона',unit:'безразм.',min:0,max:.49},
 {key:'elasticDampingRatio',label:'Доля критического затухания',unit:'безразм.',min:0,max:2},
 {key:'plasticYield',label:'Порог пластической деформации',unit:'отн. деформация',min:0,max:2},
 {key:'plasticCreep',label:'Скорость пластического течения',unit:'с⁻¹',min:0,max:100},
 {key:'plasticMax',label:'Предел пластической деформации',unit:'отн. деформация',min:0,max:2},
]);
export const PENETRATION_FIELDS=Object.freeze([
 {group:'projectile',key:'mass',label:'Масса снаряда',unit:'кг'},
 {group:'projectile',key:'radius',label:'Радиус цилиндра',unit:'м'},
 {group:'projectile',key:'length',label:'Длина цилиндра',unit:'м'},
 {group:'projectile',key:'specificHeat',label:'Удельная теплоёмкость',unit:'Дж/(кг·К)'},
 {group:'projectile',key:'temperature',label:'Температура снаряда',unit:'°C'},
 {group:'model',key:'initialSpeed',label:'Скорость при входе',unit:'м/с'},
 {group:'target',key:'thickness',label:'Толщина образца',unit:'м'},
 {group:'target',key:'density',label:'Плотность образца',unit:'кг/м³'},
 {group:'target',key:'temperature',label:'Начальная температура',unit:'°C'},
 {group:'target',key:'meltTemperature',label:'Температура плавления',unit:'°C'},
 {group:'target',key:'latentHeat',label:'Удельная теплота плавления',unit:'Дж/кг'},
 {group:'target',key:'specificHeat',label:'Теплоёмкость образца',unit:'Дж/(кг·К)'},
 {group:'target',key:'strength',label:'Эффективное сопротивление',unit:'Па',assumed:true},
 {group:'target',key:'drag',label:'Коэффициент инерционного сопротивления',unit:'безразм.',assumed:true},
 {group:'target',key:'heatTransfer',label:'Теплоотдача у торца',unit:'Вт/(м²·К)',assumed:true},
 {group:'target',key:'sideHeatTransfer',label:'Теплоотдача сбоку',unit:'Вт/(м²·К)',assumed:true},
 {group:'target',key:'liquidConductivity',label:'Теплопроводность расплава',unit:'Вт/(м·К)'},
 {group:'integration',key:'maxThermalStep',label:'Максимальный тепловой шаг',unit:'физ. с'},
]);

/** Persisted authoring data is authoritative; live bodies may have changed type
 * under an active phenomenon and must not be serialized back into the project. */
export function interactionObjects(project){return(project.objects||[]).map(o=>({...copy(o),...copy(project.edits?.[o.id]||{})})).filter(o=>!o.deleted);}
export const isRigidInteractionObject=o=>!!o&&o.asset!=='softcube'&&!(o.deformable&&o.deformable.enabled!==false);
export function atmosphereForm(spec){const normalized=normalizeAtmosphere(spec);return{source:copy(spec||{}),enabled:normalized.enabled,density:text(spec?.density??normalized.density),wind:spec?.wind?spec.wind.map(text):['','','']};}
export function atmosphereFromForm(form){
 const next={...copy(form.source||{}),enabled:form.enabled===true,density:number(form.density,'Плотность атмосферы')},wind=[0,1,2].map(i=>String(form.wind?.[i]??'').trim());
 if(wind.every(v=>v===''))delete next.wind;else{if(wind.some(v=>v===''))throw Error('Ветер: заполните все три компоненты или оставьте все три пустыми для наследования.');next.wind=wind.map(v=>number(v,'Ветер'));}
 normalizeAtmosphere(next);return next;
}
export function buoyancyForm(spec={}){const c=spec.buoyancy||{};return{source:copy(c),enabled:!!spec.buoyancy&&c.enabled!==false,volume:text(c.volume),center:[0,1,2].map(i=>text(c.center?.[i]??0)),dragCoefficient:text(c.dragCoefficient??0),referenceArea:text(c.referenceArea??0)};}
export function buoyancyFromForm(form,spec){
 const next={...copy(form.source||spec.buoyancy||{}),enabled:form.enabled===true};
 if(!next.enabled){if(!spec.buoyancy&&!Object.keys(form.source||{}).length)return null;normalizeBuoyancy(next);return next;}
 if(!isRigidInteractionObject(spec)||spec.fixed||spec.kinematic)throw Error('Вытесненный объём задаётся для свободного твёрдого предмета. Сначала снимите закрепление или отключите деформацию.');
 next.volume=number(form.volume,'Вытесненный объём');next.center=[0,1,2].map(i=>number(form.center?.[i],'Центр вытесненного объёма'));next.dragCoefficient=number(form.dragCoefficient,'Коэффициент сопротивления');next.referenceArea=number(form.referenceArea,'Опорная площадь');normalizeBuoyancy(next);return next;
}
/** Exact geometry helper only for a single declared sphere. It makes no claim
 * about the closed union of compound assets, gas type, envelope mass or Cd. */
export function sphereBuoyancyGeometry(spec={}){
 const part=spec.parts?(spec.parts.length===1&&spec.parts[0].shape==='sphere'?spec.parts[0]:null):spec.asset==='ball'?{d:[.5],p:[0,0,0]}:null;
 if(!part)throw Error('Авторасчёт доступен для шара или одной сферической детали. У составного предмета задайте известный замкнутый объём вручную.');
 const scale=spec.scale??1,r=part.d?.[0]*scale;if(!Number.isFinite(r)||r<=0)throw Error('У сферы должен быть положительный физический радиус.');
 const center=[0,1,2].map(i=>(part.p?.[i]??0)*scale);if(!center.every(Number.isFinite))throw Error('У сферы должны быть конечные координаты локального центра.');return{volume:4/3*Math.PI*r**3,referenceArea:Math.PI*r*r,center};
}
export function deformationForm(spec={}){const c=spec.deformable||{};return{enabled:!!spec.deformable&&c.enabled!==false,preserveSkin:c.preserveSkin!==false,source:copy(c),...Object.fromEntries(DEFORMATION_FIELDS.map(f=>[f.key,text(c[f.key])]))};}
export function deformationDefaults(spec={}){const m=MATERIALS[spec.material]||{};return{cellSize:'Авто',young:m.young??2200,poisson:m.poisson??.35,elasticDampingRatio:.25,plasticYield:m.plasticYield??0,plasticCreep:m.plasticCreep??0,plasticMax:.8};}
export function deformationFromForm(form,spec){
 const config={...copy(form.source||spec.deformable||{}),enabled:form.enabled===true};
 if(config.enabled){
  if(!supportsDeformableAsset(spec))throw Error('У этого предмета нет поддерживаемой замкнутой оболочки. Выберите банан, шар, эллипсоид или отдельную замкнутую поверхность.');
  if(spec.fixed||spec.kinematic)throw Error('Сначала снимите закрепление или управляемое движение у мягкого предмета.');
  config.preserveSkin=form.preserveSkin!==false;
  for(const f of DEFORMATION_FIELDS){if(String(form[f.key]??'').trim()===''){delete config[f.key];continue;}config[f.key]=number(form[f.key],f.label);}
 }
 validateDeformableSpec({...spec,deformable:config});return config;
}
export function penetrationForm(spec,project={objects:[],settings:{}}){
 const objects=interactionObjects(project),available=objects.filter(isRigidInteractionObject),source=spec?copy(spec):null;
 const p={...copy(DEFAULT_PENETRATION_PARAMETERS),...copy(spec?.parameters||{}),projectile:{...DEFAULT_PENETRATION_PARAMETERS.projectile,...spec?.parameters?.projectile},target:{...DEFAULT_PENETRATION_PARAMETERS.target,...spec?.parameters?.target},integration:{...DEFAULT_PENETRATION_PARAMETERS.integration,...spec?.parameters?.integration}};
 const projectileId=spec?.projectileId||available.find(o=>!o.fixed&&!o.kinematic)?.id||'',targetId=spec?.targetId||available.find(o=>o.fixed)?.id||'',shot=objects.find(o=>o.id===projectileId),target=objects.find(o=>o.id===targetId);
 if(!spec?.parameters?.projectile?.mass&&shot?.mass)p.projectile.mass=shot.mass;
 const entry=spec?.entry||[...(target?.position||[0,p.target.thickness/2,0])].map((v,i)=>v+(i===1?p.target.thickness/2:0));
 return{enabled:!!spec,source,projectileId,targetId,axis:(spec?.axis||[0,-1,0]).map(text),entry:entry.map(text),leadDistance:text(spec?.leadDistance??0),values:Object.fromEntries(PENETRATION_FIELDS.map(f=>[`${f.group}.${f.key}`,text(f.group==='model'?p[f.key]:p[f.group][f.key])])),clock:(spec?.clock||[{time:0,elapsed:0},{time:20,elapsed:20}]).map(p=>({time:text(p.time),elapsed:text(p.elapsed)}))};
}
export function penetrationFromForm(form,project){
 if(!form.enabled)return null;
 const objects=interactionObjects(project),shot=objects.find(o=>o.id===form.projectileId),target=objects.find(o=>o.id===form.targetId);
 if(!shot||!target)throw Error('Выберите снаряд и образец из сохранённых предметов своей сцены.');
 if(!isRigidInteractionObject(shot)||shot.fixed||shot.kinematic)throw Error('Снаряд должен быть свободным твёрдым телом.');
 if(!isRigidInteractionObject(target)||!target.fixed)throw Error('Образец должен быть закреплённым твёрдым телом.');
 const config={...copy(form.source||{}),projectileId:shot.id,targetId:target.id,parameters:{...copy(form.source?.parameters||{}),projectile:{...copy(form.source?.parameters?.projectile||{})},target:{...copy(form.source?.parameters?.target||{})},integration:{...copy(form.source?.parameters?.integration||{})}}};
 for(const f of PENETRATION_FIELDS){const value=number(form.values?.[`${f.group}.${f.key}`],f.label);if(f.group==='model')config.parameters[f.key]=value;else config.parameters[f.group][f.key]=value;}
 config.entry=(form.entry||[]).map(v=>number(v,'Точка входа'));config.axis=(form.axis||[]).map(v=>number(v,'Ось проникновения'));
 const length=Math.hypot(...config.axis);if(config.axis.length!==3||length<1e-10)throw Error('Ось проникновения: три координаты ненулевого направления.');config.axis=config.axis.map(v=>v/length);
 config.parameters.gravity=-(project.settings?.gravity??9.81)*config.axis[1];
 config.leadDistance=number(form.leadDistance,'Расстояние до входа');
 config.clock=(form.clock||[]).map(p=>({time:number(p.time,'Время сцены'),elapsed:number(p.elapsed,'Физическое время')}));
 validatePenetrationScene(config);return config;
}
export function assemblyForms(assemblies=[]){return assemblies.map(a=>({source:copy(a),id:a.id,name:a.name||'',bonds:a.bonds.map(b=>({source:copy(b),id:b.id,a:b.a,b:b.b,breakForceN:text(b.breakForceN??b.strengthPa*b.areaM2)}))}));}
export function assembliesFromForms(forms,project){
 const allowed=new Set(interactionObjects(project).filter(isRigidInteractionObject).map(o=>o.id));allowed.add('ground');
 const assemblies=forms.map(form=>({...(copy(form.source||{})),id:form.id,...(String(form.name||'').trim()?{name:String(form.name).trim()}:{name:undefined}),loadModel:'contact-graph',bonds:form.bonds.map(b=>{if(!allowed.has(b.a)||!allowed.has(b.b))throw Error('У разрушаемой связи выберите два существующих твёрдых тела.');const value=number(b.breakForceN,'Порог разрыва'),out={...copy(b.source||{}),id:b.id,a:b.a,b:b.b};if(out.breakForceN!==undefined||out.strengthPa===undefined||value!==out.strengthPa*out.areaM2){delete out.strengthPa;delete out.areaM2;out.breakForceN=value;}return out;})}));
 for(const a of assemblies)if(a.name===undefined)delete a.name;
 validateBreakableAssemblies(assemblies,{knownBodyIds:allowed});return assemblies;
}
/** All changes compile onto a deep clone. An error leaves the input intact.
 * Unspecified sections, project/film identity and camera authoring are retained. */
export function compileInteractionDraft(project,patch={}){
 const next=copy(project);next.edits??={};
 if(patch.atmosphere!==undefined)next.settings.atmosphere=atmosphereFromForm(patch.atmosphere);
 for(const item of patch.deformables||[]){const spec=interactionObjects(next).find(o=>o.id===item.id);if(!spec)throw Error('Мягкий предмет удалён из сцены.');next.edits[item.id]={...next.edits[item.id],deformable:deformationFromForm(item.form,spec)};}
 if(patch.penetration!==undefined){const config=penetrationFromForm(patch.penetration,next);if(config){next.settings.penetration=config;next.edits[config.projectileId]={...next.edits[config.projectileId],mass:config.parameters.projectile.mass};}else delete next.settings.penetration;}
 if(patch.assemblies!==undefined)next.settings.assemblies=assembliesFromForms(patch.assemblies,next);
 for(const item of patch.buoyancies||[]){const spec=interactionObjects(next).find(o=>o.id===item.id);if(!spec)throw Error('Предмет с вытесненным объёмом удалён из сцены.');if(item.form.enabled&&next.settings.penetration?.projectileId===item.id)throw Error('У осевого снаряда своя динамика. Отключите осевую модель перед добавлением подъёмной силы.');const config=buoyancyFromForm(item.form,spec);if(config)next.edits[item.id]={...next.edits[item.id],buoyancy:config};}
 validateProject(next);return next;
}

/** Optional blank-scene convenience. The two generated source IDs are persisted,
 * not references to built-in bodies; no existing object or editing state is lost. */
export function addPenetrationPair(project){
 if(project.settings.experiment!=='blank')throw Error('Новая осевая пара доступна в пустой сцене. Существующую модель можно редактировать в её проекте.');
 if(project.settings.penetration)throw Error('В сцене уже есть модель проникновения. Сначала отключите её и сохраните.');
 const next=copy(project),used=new Set(next.objects.map(o=>o.id));let n=1;while(used.has(`penetration-projectile-${n}`)||used.has(`penetration-target-${n}`))n++;
 const projectileId=`penetration-projectile-${n}`,targetId=`penetration-target-${n}`;
 next.objects.push({id:projectileId,name:'Цилиндр · осевая модель',asset:'custom',material:'metal',mass:1,position:[0,1.05,0],parts:[{shape:'cylinder',d:[.02,.1],p:[0,0,0]}]},{id:targetId,name:'Образец · осевая модель',asset:'custom',material:'ice',fixed:true,position:[0,.5,0],parts:[{shape:'box',d:[1,1,1],p:[0,0,0]}]});
 const form=penetrationForm(undefined,next);form.enabled=true;form.projectileId=projectileId;form.targetId=targetId;form.entry=['0','1','0'];
 return compileInteractionDraft(next,{penetration:form});
}
