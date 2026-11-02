import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {MATERIALS,EXPERIMENTS,settingsFor} from '../src/catalog.js';
import {normalizedStory,editorialFrame} from '../src/storyboard.js';
import {montagePlan,allocateTakeFrames} from '../src/montage.js';
import {objectBounds,chooseHero,salientEvent,assessTake} from '../src/scene-analysis.js';
import {planCamera} from '../src/cinematography.js';
import {comparisonVariants} from '../src/comparison.js';
import {validateProject} from '../src/validation.js';
import {objectLabelMap,objectLabel} from '../src/object-labels.js';
import {normalizeCameraRig,createCameraSampler,cameraTrackPlan} from '../src/camera-rig.js';
import {normalizeEnvironment} from '../src/environments.js';
import {assetSurface} from '../src/asset-surfaces.js';
import {sampleCapturedFrame} from '../src/frame-sampling.js';
import {specimenAppearance} from '../src/lab-fixtures.js';
import {normalizeContextView} from '../src/context-view.js';
import {modelReadouts} from '../src/measurement-readouts.js';
import {resolveSceneAnnotations} from '../src/scene-annotations.js';
import {takeModelProvenance,captureModelProvenance} from '../src/model-provenance.js';

const pack=arr=>Buffer.from(new Float32Array(arr).buffer).toString('base64');
function modelMetric(lab,stats){
 if(lab.penetration){const s=lab.penetration.snapshot();return{value:s.depth*100,unit:'см',label:'Глубина · осевая модель',precision:1};}
 if(lab.thermal){const s=lab.thermal.snapshot();stats.caption=s.elapsed>0?'Шар плавит лёд и остывает':'Шар начинает падение';stats.outcome=s.passed?'Шар прошёл насквозь':`За ${Math.round(s.elapsed)} секунд`;return{value:s.depth*100,unit:'см',label:'Глубина проникновения',precision:1};}
 if(lab.orbit){const s=lab.orbit.snapshot(),ratio=s.initialSpeed/s.circularSpeed;stats.caption='Тяготение искривляет траекторию';stats.outcome=s.status==='impact'?'Упал на поверхность':ratio>=Math.SQRT2?'Уходит по открытой траектории':Math.abs(ratio-1)<.01?'Круговая орбита':'Эллиптическая орбита';return{value:s.altitude/1000,unit:'км',label:'Над поверхностью',precision:0};}
 if(lab.press){stats.caption=stats.time<.6?'Материал без нагрузки':stats.time<2.6?'Сжимаем материал':stats.time<3.4?'Удерживаем нагрузку':stats.time<4.8?'Снимаем нагрузку':'Смотрим на восстановление';stats.outcome=stats.softHeight/1.4>.95?'Высота восстановилась':'Осталась вмятина';return{value:stats.softHeight/1.4*100,unit:'%',label:'От исходной высоты',precision:0};}
 if(lab.fluid){stats.caption=stats.collected?'Поток достигает резервуара':'Следим за фронтом потока';stats.outcome=stats.collected?'Сравниваем за одинаковое время':'До резервуара ещё не дошло';return{value:stats.collected,unit:'из 840',label:'Дошли до резервуара',precision:0};}
 if(lab.payloadApex!==undefined){stats.caption=stats.time<.9?'Тяжёлый груз ударяет по рычагу':'Лёгкий груз получает импульс';stats.outcome='На сколько поднялся груз?';return{value:Math.max(0,lab.payloadApex-1.25),unit:'м',label:'Максимальный подъём',precision:2};}
 stats.caption=stats.movedObjects?'Импульс передаётся другим предметам':'Следим за главным предметом';stats.outcome=stats.movedObjects?'Сколько предметов сдвинулось?':'Другие предметы остались на месте';
 return{value:stats.movedObjects,unit:lab.settings.measurement?.objectIds?.length?`из ${lab.settings.measurement.objectIds.length}`:'предметов',label:lab.settings.measurement?.label||`Хотя бы раз >${Math.round(stats.movementThreshold*100)} см`,precision:0};
}
const PARAMETER_KEYS={thermal:['mass','temperature'],orbit:['speed'],mechanism:['mass','dropHeight'],soft:['material'],flow:['material','slope'],impact:['speed','mass','material'],cascade:['gap','material']};
const UNITS={mass:'кг',temperature:'°C',speed:'м/с',dropHeight:'м',slope:'°',gap:'м'};
function parameterLabel(settings){return(PARAMETER_KEYS[settings.experiment]||[]).map(key=>key==='material'?MATERIALS[settings[key]]?.name?.split(' · ')[0]:key==='mass'&&settings.mass<1?`${Math.round(settings.mass*1000)} г`:`${Number(settings[key]).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${UNITS[key]}`).filter(Boolean).join(' · ');}
function groupSubject(objects,id='reaction'){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const o of objects)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],o.position[k]-o.bounds[k]/2);hi[k]=Math.max(hi[k],o.position[k]+o.bounds[k]/2);}
 return{id,name:'Результат взаимодействия',position:lo.map((x,k)=>(x+hi[k])/2),bounds:lo.map((x,k)=>Math.max(.2,hi[k]-x)),velocity:[0,0,0],fixed:false};
}
export async function capture(project,cachePath,onProgress=()=>{}){
 validateProject(project);
 await initializePhysics();
 const snapshots=project.preview?60:project.settings.exportFps===60?120:60;
 const ex=EXPERIMENTS.find(e=>e.id===project.settings.experiment)||{title:'Мой эксперимент',variants:[{label:'Мой дубль'}]};
 const story=normalizedStory({...project.settings.story||{},...(project.settings.renderStyle==='light'&&!project.settings.story?.theme?{theme:'editorial'}:{})});
 const custom=project.series?comparisonVariants(project.settings.comparison):[];
 const cameraRig=normalizeCameraRig(project.settings.cameraRig),manual=cameraRig.mode!=='auto'&&cameraRig.points.length>0,manualTimed=manual&&['recorded','keys'].includes(cameraRig.mode);
 const cameraSample=createCameraSampler(cameraRig);
 if(cameraRig.mode!=='auto'&&!cameraRig.points.length)throw new Error('Сначала сохраните ракурс или запишите движение камеры в разделе «Съёмка».');
 const series=project.series&&(custom.length>1||ex.variants.length>1),variants=series?(custom.length?custom:ex.variants):[{label:'Мой дубль',...project.settings}];
 const fps=project.preview?([24,30,60].includes(project.previewFps)?project.previewFps:Math.min(30,project.settings.exportFps||30)):([24,30,60].includes(project.settings.exportFps)?project.settings.exportFps:30),baseDuration=manualTimed&&!series?cameraRig.duration:project.preview?(project.previewDuration||8):(series?story.duration/variants.length:story.duration);
 const width=[720,1080,2160].includes(project.height)?project.height:1080;
 const data={title:story.title,subtitle:story.question,experiment:project.settings.experiment,fps,width,height:Math.round(width*16/9),duration:baseDuration*variants.length,targetDuration:baseDuration*variants.length,renderStyle:project.settings.renderStyle||'cinematic',audioPreset:project.settings.audioPreset||'auto',musicTrack:project.settings.musicTrack,soundDesign:project.settings.soundDesign,environment:normalizeEnvironment(project.settings.environment),cameraMode:manual?cameraRig.mode:'story',cameraRig:manual?cameraRig:undefined,story,takes:[],revision:5,sourceProject:project.preview?project:undefined};
 const prepared=[];data.renderSurfaces={};
 for(let n=0;n<variants.length;n++){
  const comparisonSettings=custom[n]&&['speed','elevation','gravity'].includes(custom[n].field)?{[custom[n].field]:custom[n].value}:{};
  const settings=series?{...project.settings,...(custom.length?comparisonSettings:variants[n]),variant:n}:project.settings;
  const lab=new LabWorld(settings,project.objects||[],project.edits||{});
  const entities=lab.entities.filter(e=>e.id!=='ground'&&(!e.renderHidden||e.spec?.visualRig)),sizes=new Map(entities.map(e=>[e.id,objectBounds(e)]));
  const instanceLabels=objectLabelMap([...entities,...lab.softs]);
  for(const[id,edit]of Object.entries(project.edits||{}))if(edit.position&&lab.find(id)?.soft)lab.moveSoft(id,{x:edit.position[0],y:edit.position[1],z:edit.position[2]});
  if(manual&&cameraRig.anchorId&&!lab.find(cameraRig.anchorId)){lab.dispose();throw new Error('Опора записанной камеры удалена. Выберите существующий предмет или запишите новый маршрут.');}
  const fallbackFocus=lab.fluid?'fluid':lab.find('hot-ball')?'hot-ball':lab.find('specimen')?'specimen':lab.find('payload')?'payload':lab.find('projectile')?'projectile':'';
  // A comparison acts on its recipient. Choosing another camera hero must not
  // redirect the launch, change that recipient's mass, or change who is counted.
  let receiver=custom[n]?.targetId||settings.focusId||fallbackFocus||story.heroId||'';
  let focus=story.heroId||receiver;
  if(custom[n]?.field==='mass')lab.setMass(receiver,custom[n].value);
  if(custom[n]?.field==='material')lab.setMaterial(receiver,custom[n].value);
  const launchOverrides=custom[n]&&['speed','elevation'].includes(custom[n].field)?{[custom[n].field]:custom[n].value}:{};
  for(const[id,edit]of Object.entries(project.edits||{}))if(edit.launch)lab.actions.push({time:edit.launch.delay||.35,run:()=>lab.launch(id,{...settings,...edit.launch,...(id===receiver?launchOverrides:{})})});
  if(!project.edits?.[receiver]?.launch&&(settings.autoLaunch||custom.length)&&receiver)lab.actions.push({time:.35,run:()=>lab.launch(receiver,settings)});
  lab.resetMeasurements(receiver,story.movementThreshold);
  const initial=new Map(entities.map(e=>{const p=e.body.translation();return[e.id,[p.x,p.y,p.z]];}));
  const maxTime=manualTimed?Math.max(.01,...cameraRig.points.map(p=>p.sourceTime)):Math.max(1,Math.min(20,settings.simulationDuration||(lab.payloadApex!==undefined?2.9:7.5)));
  const meshes=[...lab.softs.map(e=>{const appearance={...specimenAppearance(e.material),...e.sourceAppearance,...e.appearance};return{id:e.id,material:e.material,indices:Array.from(e.soft.meshIndices(0)),color:appearance?.color||MATERIALS[e.material].color,appearance};}),...lab.surfaces.map(s=>({id:s.id,kind:s.kind,material:s.material,color:s.appearance?.color||s.color||MATERIALS[s.material].color,appearance:s.appearance,cutPlane:s.cutPlane,indices:Array.from(s.geometry().indices)}))];
  const take={contextView:normalizeContextView(settings.contextView),label:variants[n].label||'Мой дубль',detail:variants[n].detail||'',settings,entities:entities.map(e=>{
   const surface=e.renderSurface||assetSurface(e.asset);
   // Content keys preserve different generated surfaces across montage clips.
   const surfaceKey=e.renderSurface?'custom-'+createHash('sha256').update(JSON.stringify(surface)).digest('hex').slice(0,24):e.asset;
   if(surface)data.renderSurfaces[surfaceKey]=surface;
   return{id:e.id,asset:e.asset,name:objectLabel(e,instanceLabels),parts:e.renderHidden?[]:e.visualParts||e.parts,scale:e.scale,material:e.material,color:e.color,...(e.appearance?{appearance:structuredClone(e.appearance)}:{}),surface:surface?surfaceKey:undefined};
  }),meshes,frames:[],impacts:[]};
  const samples=[];
  for(let f=0;f<=Math.ceil(maxTime*snapshots);f++){
   const t=f/snapshots;while(lab.time+1e-7<t)lab.step();
   const poses=[],objects=[],vertices={},stats=lab.stats();stats.readouts=modelReadouts(lab);stats.movementThreshold=story.movementThreshold||.2;
   for(const e of entities){const p=e.body.translation(),q=e.body.rotation(),v=e.body.linvel(),w=e.body.angvel(),start=initial.get(e.id);poses.push(p.x,p.y,p.z,q.x,q.y,q.z,q.w);if(!e.body.isEnabled())continue;const displacement=Math.hypot(p.x-start[0],p.y-start[1],p.z-start[2]);objects.push({id:e.id,name:objectLabel(e,instanceLabels),position:[p.x,p.y,p.z],quaternion:[q.x,q.y,q.z,q.w],bounds:sizes.get(e.id),velocity:[v.x,v.y,v.z],angularVelocity:[w.x,w.y,w.z],fixed:e.fixed,mass:lab.surfaceMotion?.entity===e?lab.surfaceMotion.config.mass:e.body.mass(),initialPosition:start,distance:displacement});}
   for(const e of lab.softs){const a=e.soft.meshVertices(0),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];vertices[e.id]=pack(a);for(let k=0;k<a.length;k++){const axis=k%3;lo[axis]=Math.min(lo[axis],a[k]);hi[axis]=Math.max(hi[axis],a[k]);}objects.push({id:e.id,name:objectLabel(e,instanceLabels),position:lo.map((x,k)=>(x+hi[k])/2),bounds:lo.map((x,k)=>hi[k]-x),velocity:[0,0,0],fixed:false});if(e.id==='specimen')stats.softHeight=hi[1]-lo[1];}
   for(const s of lab.surfaces)vertices[s.id]=pack(s.geometry().vertices);
   const annotationPositions=new Map([...lab.entities,...lab.softs].map(e=>[e.id,lab.position(e.id)]));
   const frame={poses:pack(poses),vertices,stats,objects,annotations:resolveSceneAnnotations(settings.annotations,annotationPositions),measuredChanges:lab.measuredChanges()};
   if(lab.fluid){frame.fluidParticles=pack(lab.fluid.particles.flatMap(p=>[p.x,p.y,p.z]));frame.fluidColor=MATERIALS[settings.material].color;stats.collected=lab.fluid.particles.filter(p=>p.z<-2.55).length;const front=lab.fluid.particles.slice().sort((a,b)=>a.z-b.z).slice(0,30);if(front.length){const p=['x','y','z'].map(k=>front.reduce((s,p)=>s+p[k],0)/front.length);objects.push({id:'fluid',name:MATERIALS[settings.material].name,position:p,bounds:[1.3,.9,1.3],velocity:['vx','vy','vz'].map(k=>front.reduce((s,p)=>s+p[k],0)/front.length),fixed:false});}}
   if(lab.thermal)frame.thermal=lab.thermal.snapshot();if(lab.orbit)frame.orbit=lab.orbit.snapshot();
   if(lab.penetration)frame.penetration=lab.penetration.snapshot();
   if(lab.breakables)frame.assemblies=lab.assemblyState();
   if(lab.elasticCables)frame.elasticCables=lab.elasticCables.snapshot();
   if(lab.contactSensors)frame.contactSensors=lab.contactSensors.snapshot(lab.settings.gravity);
   frame.hero=chooseHero(objects,focus);if(!focus&&frame.hero)focus=frame.hero.id;
   if(!receiver&&frame.hero){receiver=frame.hero.id;lab.resetMeasurements(receiver,story.movementThreshold);}
   stats.heroSpeed=frame.orbit?.speed||Math.hypot(...(frame.hero?.velocity||[0,0,0]));stats.heroHeight=frame.hero?.position[1];stats.displacement=frame.hero?.distance||0;stats.metric=modelMetric(lab,stats);
   samples.push(frame);
  }
  const event=salientEvent(lab.impacts,receiver,samples,{targetIds:settings.measurement?.objectIds});
  const contextSubjects=samples[0].objects.filter(o=>o.id!==receiver&&!o.fixed),reactionRadius=contextSubjects.length?Math.max(.5,Math.hypot(...groupSubject(contextSubjects).bounds)*2):5;
  take.reference=samples[0].hero?{position:samples[0].hero.position,bounds:samples[0].hero.bounds,quaternion:samples[0].hero.quaternion||[0,0,0,1]}:null;
  const initialReceiver=samples[0]?.objects.find(o=>o.id===receiver),initialSpeed=Math.hypot(...(initialReceiver?.velocity||[0,0,0]));
  take.analysis=assessTake(samples,lab.impacts,receiver,{
   contactExpected:typeof settings.analysis?.expectContact==='boolean'?settings.analysis.expectContact:undefined,
   targetIds:settings.measurement?.objectIds,
   launchConfigured:!!(settings.autoLaunch||custom.length||project.edits?.[receiver]?.launch||initialSpeed>.15),
  });take.event=event;
  const models={thermal:!!lab.thermal,penetration:!!lab.penetration,orbit:!!lab.orbit,press:!!lab.press,fluid:!!lab.fluid,mechanism:lab.payloadApex!==undefined};
  // Read-only provenance: preserve effective model choices before world disposal.
  take.modelProvenance=takeModelProvenance(take,{
   rigidStep:lab.world.timestep,
   surfaceMotion:lab.surfaceMotion?{config:lab.surfaceMotion.config,handoff:lab.surfaceMotion.handoff||null}:undefined,
   penetration:lab.penetration?{parameters:lab.penetration.model.parameters,axis:lab.penetration.axis,entry:lab.penetration.entry,leadDistance:lab.penetration.lead,clock:lab.penetration.clock,geometryApproximation:lab.penetration.surface.geometryApproximation}:undefined,
   atmosphere:lab.atmosphere?.settings.enabled?{...lab.atmosphere.settings,volumes:lab.atmosphere.eligible().map(e=>({id:e.id,mass:e.body.mass(),volume:e.spec.buoyancy.volume,center:e.spec.buoyancy.center||[0,0,0],dragCoefficient:e.spec.buoyancy.dragCoefficient??0,referenceArea:e.spec.buoyancy.referenceArea??0}))}:undefined,
   softBodies:lab.softs.map(e=>{const m=e.soft.material();return{id:e.id,solver:e.deformableMetadata?'fem':'constraints',materialPreset:e.material,particles:e.soft.numParticles(),cells:e.soft.numCells(),parameters:{young:m.youngModulus,poisson:m.poissonRatio,elasticDampingRatio:m.elasticDampingRatio,plasticYield:m.plasticYield,plasticCreep:m.plasticCreep,plasticMax:m.plasticMax},...(e.deformableMetadata?{cellSize:e.deformableMetadata.cellSize,skinCollision:e.deformableMetadata.skinCollision,limitations:e.deformableMetadata.limitations}:{})};}),
  });
  const isControl=!Object.values(models).some(Boolean)&&['auto','moved'].includes(story.metric)&&contextSubjects.length>0&&take.analysis.movedObjects===0;
  prepared.push({take,samples,focus,receiver,maxTime,event,reactionRadius,models,isControl,impacts:[...lab.impacts],orbitObstacle:lab.orbit?{position:[0,0,0],radius:lab.orbit.planet.radius/lab.orbit.unit}:null});
  lab.dispose();
  onProgress((n+1)/variants.length*10,`Расчёт ${n+1}/${variants.length}`);
 }
 const budget=allocateTakeFrames({duration:data.targetDuration,fps,takes:prepared,autoTrim:story.autoTrim&&!manual});
 let offset=0;
 for(let n=0;n<prepared.length;n++){
  const {take,samples,focus,receiver,maxTime,event,reactionRadius,models,isControl,impacts,orbitObstacle}=prepared[n],settings=take.settings,duration=budget.frames[n]/fps;
  const plan=manualTimed?cameraTrackPlan(cameraRig,duration):montagePlan({duration,maxTime,eventTime:event.time,opening:isControl&&story.autoTrim?'question':story.opening,tempo:story.tempo,resultHold:n===prepared.length-1&&prepared.length>1?3.4:undefined});
  if(manualTimed)plan.eventMovie=plan.timesFor(event.time)[0]??duration*.5;
  take.start=offset;take.duration=duration;take.observationTime=maxTime;take.negativeControl=isControl;
  let previous=null,lastBeat='',directing=null;
  for(let f=0;f<budget.frames[n];f++){
   const time=f/fps,edit=plan.at(time),source=sampleCapturedFrame(samples,edit.source,snapshots);
   const eventAt=edit.beat==='hook'?Math.min(plan.hook/2,time):plan.eventMovie;
   const onScreenLabel=story.parameterLabel??'';
   const metadata=editorialFrame({story:{...story,heroId:focus},time,duration,stats:source.stats,hero:source.hero,event:{...event,movieTime:eventAt},takeIndex:n,takeCount:variants.length,takeLabel:onScreenLabel});
   if(!story.cues.length){
   if(edit.beat==='hook')metadata.hideMetric=true;
   metadata.phase=edit.beat==='hook'?'hook':edit.beat==='context'?'setup':edit.beat==='result'?'result':metadata.phase;
   metadata.phaseLabel='';
   if(edit.beat==='result'){metadata.caption=story.takeaway||story.labels.result;metadata.effects.reference=story.effects.reference;}
   // A short negative control still opens the film with its authored question.
   // This changes the title layer only: do not invent a teaser/contact frame.
   if(n===0&&isControl&&story.autoTrim&&time<Math.min(.9,duration*.28)){metadata.phase='hook';metadata.phaseLabel='';metadata.hideMetric=true;metadata.teaser=false;}
   }
   let cameraFocus=focus,cameraObjects=source.objects,cameraHero=source.hero;
   const cameraEvent={...event,time:plan.eventMovie};if(models.orbit&&edit.beat!=='hook')cameraEvent.participants=[focus,'planet'];
   const canFollowReaction=story.camera==='auto'&&(!story.heroId||story.heroId===receiver)&&!Object.values(models).some(Boolean);
   if(canFollowReaction&&(edit.beat==='result'||source.stats.movedObjects>2&&edit.source>event.time+.4)){
    const subjects=source.objects.filter(o=>o.id!==receiver&&!o.fixed&&Math.hypot(...o.position.map((x,i)=>x-(event.position?.[i]||0)))<reactionRadius);
    if(subjects.length){cameraHero=groupSubject(subjects);cameraFocus=cameraHero.id;cameraObjects=[...source.objects,cameraHero];cameraEvent.participants=[];cameraEvent.position=cameraHero.position;metadata.heroName=cameraHero.name;}
   }
   const authoredContext=settings.cameraHints?.context;
   if(!manual&&story.camera==='auto'&&Array.isArray(authoredContext)&&authoredContext.length){
    const ids=new Set(authoredContext),targets=new Set(settings.measurement?.objectIds||[]);
    const overview=edit.beat==='context'||edit.source<.12;
    let subjects=overview?source.objects.filter(o=>ids.has(o.id)||o.id===focus):source.stats.movedObjects>0&&targets.size?source.objects.filter(o=>targets.has(o.id)):source.objects.filter(o=>!o.fixed&&Math.hypot(...o.velocity)>.3);
    if(!subjects.length)subjects=[source.hero].filter(Boolean);
    if(subjects.length){cameraHero=groupSubject(subjects,'interaction');cameraFocus='interaction';cameraObjects=[...source.objects,cameraHero];cameraEvent.participants=[];cameraEvent.position=cameraHero.position;metadata.heroName=overview?'Сцена целиком':'Взаимодействие';}
   }
   const hints=settings.cameraHints||{},viewDirection=models.orbit?[0,0,1]:hints.viewDirection||directing?.axis;
   const camera=manual?cameraSample(time/duration*cameraRig.duration,source.objects.find(o=>o.id===cameraRig.anchorId)?.position,{resolveTarget:id=>source.objects.find(o=>o.id===id)?.position}):planCamera({time,duration,aspect:data.width/data.height,objects:cameraObjects,focusId:cameraFocus,event:cameraEvent,style:story.camera==='context'?'wide':story.camera==='follow'?'follow':'auto',storyBeat:edit.beat,safeFrame:story.enabled?undefined:{top:.07,bottom:.07,left:.07,right:.07},previous:edit.cut||lastBeat==='hook'&&edit.beat!=='hook'?undefined:previous,directing,actionAxis:hints.actionAxis,obstacles:orbitObstacle&&edit.beat==='hook'?[orbitObstacle]:[],viewDirection});
   if(camera.attentionMissingIds?.length)throw new Error('Цель камеры недоступна в выбранный момент: '+camera.attentionMissingIds.join(', ')+'. Измените цель ключа или время появления предмета.');
   directing=camera.directing||directing;
   previous={...camera,time};lastBeat=edit.beat;
   take.frames.push({...source,heroPosition:cameraHero?.position,heroBounds:cameraHero?.bounds,objects:undefined,hero:undefined,camera:{...camera,scale:Math.hypot(...camera.position.map((x,i)=>x-camera.target[i]))*Math.tan((camera.fov||40)*Math.PI/360)},editorial:metadata,sourceTime:edit.source,beat:edit.beat,event:Math.abs(edit.source-event.time)<.25?event:null});
  }
  take.impacts=impacts.flatMap(e=>plan.timesFor(e.t).map(t=>({t:offset+t,strength:e.strength,participants:e.participants,position:e.position})));data.takes.push(take);offset+=duration;
  onProgress(10+(n+1)/variants.length*4,`Монтаж ${n+1}/${variants.length}`);
 }
 data.duration=data.takes.reduce((sum,t)=>sum+t.frames.length,0)/fps;
 data.editing={autoTrim:story.autoTrim,shortened:budget.shortened,observationTimes:data.takes.map(t=>t.observationTime),takeDurations:data.takes.map(t=>t.duration)};
 data.analysis={warnings:data.takes.flatMap((t,i)=>t.analysis.warnings.map(w=>`Дубль ${i+1}: ${w}`)),takes:data.takes.map(t=>t.analysis)};
 if(budget.shortened)data.analysis.warnings.push(`Во всех дублях нет реакции других предметов. Монтаж сокращён до ${data.duration.toLocaleString('ru-RU')} с вместо ${data.targetDuration} с. Измените взаимодействие или отключите сокращение дублей.`);
 if(data.takes.some(t=>t.negativeControl)&&data.takes.some(t=>!t.negativeControl)&&story.autoTrim)data.analysis.warnings.push('Контрольный дубль без сдвига предметов показан короче. Физическое время наблюдения одинаковое во всех сравнениях.');
 if(data.takes.length>1){const values=data.takes.map(t=>t.frames.at(-1).editorial.metricValue).filter(Number.isFinite);if(values.length===data.takes.length&&Math.max(...values)-Math.min(...values)<.02)data.analysis.warnings.push('Итоговый показатель почти одинаков во всех дублях. Измените диапазон параметра или выберите другое измерение.');}
 if(data.takes.length>2){for(let i=1;i<data.takes.length;i++){const a=data.takes[i-1].frames.at(-1).editorial.metricValue,b=data.takes[i].frames.at(-1).editorial.metricValue;if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<.02)data.analysis.warnings.push(`Дубли ${i} и ${i+1} дают одинаковый итоговый показатель. Проверьте, интересна ли разница в самом движении.`);}}
 Object.assign(data,captureModelProvenance(data.takes));
 await writeFile(cachePath,JSON.stringify(data));return data;
}
