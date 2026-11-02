import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {capture} from './capture.mjs';
import {captureFilm} from './capture-film.mjs';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {createRunnerActor} from '../src/motion-rig.js';
import {surfaceMotionForm,compileSurfaceMotion} from '../src/surface-motion-authoring.js';
import {modelReadouts} from '../src/measurement-readouts.js';

const began=performance.now(),directory=await mkdtemp(path.join(tmpdir(),'matter-surface-capture-qa-'));
const near=(a,b,tolerance=1e-6,label='measurement')=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance,`${label}: ${a} differs from ${b}`);
const vectorNear=(a,b,tolerance=1e-6,label='pose')=>{assert.equal(a.length,b.length);a.forEach((v,i)=>near(v,b[i],tolerance,`${label}[${i}]`));};
const unpack=packed=>{const bytes=Buffer.from(packed,'base64');return Array.from(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));};
const pose=body=>{const p=body.translation(),q=body.rotation();return[p.x,p.y,p.z,q.x,q.y,q.z,q.w];};
const floatPose=body=>Array.from(new Float32Array(pose(body)));
const hash=surface=>'custom-'+createHash('sha256').update(JSON.stringify(surface)).digest('hex').slice(0,24);
const modelParameters=provenance=>provenance.models.find(m=>m.id==='surface-motion')?.parameters;
let checks=0,framesChecked=0;
const check=async(label,fn)=>{await fn();checks++;console.log(`PASS ${label}`);};

function base(id,{duration=.75,sourceStart=0,sourceEnd=duration,gravity=9.81}={}){
 return{version:1,name:'Surface capture regression',height:720,series:false,objects:[],edits:{},settings:{...settingsFor('blank'),experiment:'blank',gravity,autoLaunch:false,windSpeed:0,atmosphere:{enabled:false},connections:[],assemblies:[],exportFps:60,focusId:id,story:{enabled:false,heroId:id,autoTrim:false,duration:5,metric:'distance'},analysis:{expectContact:false},cameraRig:{mode:'keys',interpolation:'linear',points:[{time:0,sourceTime:sourceStart,position:[9,8,12],target:[0,2,0],fov:45},{time:duration,sourceTime:sourceEnd,position:[9,8,12],target:[0,2,0],fov:45}]}}};
}
function surfaceScene(id,options={}){
 const original=base(id,options),actor=createRunnerActor(id,{mass:70,height:1.73}),form=surfaceMotionForm(original);
 form.body=actor.id;form.targetSpeed=options.targetSpeed??3;
 const project=compileSurfaceMotion(original,form,actor);
 project.settings.surfaceMotion.render={...project.settings.surfaceMotion.render,segments:48,radialSegments:8};
 return project;
}
async function captureAndVerify(project,stem,{rig=false,dynamic=false}={}){
 const before=JSON.stringify(project),file=path.join(directory,stem+'.json'),data=await capture(project,file);
 assert.equal(JSON.stringify(project),before,'Capture must not mutate authored input');
 const stored=JSON.parse(await readFile(file,'utf8'));assert.equal(JSON.stringify(stored.renderSurfaces),JSON.stringify(data.renderSurfaces));
 assert.equal(data.takes.length,1);const take=data.takes[0],subjectId=project.settings.focusId;
 assert.equal(take.analysis.hero,subjectId,'Hidden physical root remains the analysis subject');
 assert.ok(take.analysis.maxDisplacement>.01,'Analysis must measure the moving physical root');
 const lab=new LabWorld(structuredClone(project.settings),structuredClone(project.objects),structuredClone(project.edits));
 try{
  const subject=lab.find(subjectId),index=take.entities.findIndex(e=>e.id===subjectId);assert.ok(index>=0,'Physical root must retain a packed-pose slot');
  assert.equal(take.frames.length,Math.round(project.settings.cameraRig.points.at(-1).time*data.fps));
  const helpers=rig?lab.motionRigs.find(r=>r.entity===subject).helpers:[];
  if(rig){
   assert.equal(helpers.length,11);assert.deepEqual(take.entities[index].parts,[],'Physical proxy geometry must be hidden');
   for(const helper of helpers){assert.equal(helper.colliders.length,0);const visible=take.entities.find(e=>e.id===helper.id);assert.ok(visible?.parts.length,'All captured rig helpers remain visible');}
  }else assert.ok(take.entities[index].parts.length,'Ordinary body remains visible');
  const surface=lab.surfaceMotion?.surfaceEntity,mesh=surface?.renderSurface;
  if(surface){
   const entry=take.entities.find(e=>e.id===surface.id);assert.equal(entry.surface,hash(mesh),'Generated surface has its content hash, not a shared asset key');
   assert.deepEqual(data.renderSurfaces[entry.surface],mesh,'Capture stores the actual static render/collision mesh');
   const parameters=modelParameters(take.modelProvenance);assert.equal(parameters.parametersSource,'effective-runtime');
   near(parameters.config.mass,lab.surfaceMotion.config.mass,1e-8,'Effective provenance mass');near(parameters.config.gravity,lab.surfaceMotion.config.gravity,1e-9,'Effective provenance gravity');
   assert.notEqual(parameters.config.mass,999);assert.notEqual(parameters.config.gravity,123);
   assert.deepEqual(modelParameters(data.modelProvenance.takes[0]),parameters,'Aggregated provenance preserves effective configuration');
  }
  let dynamicFrames=0,helperMoved=false,previousHelper=null;
  for(const frame of take.frames){
   // These fixtures deliberately align output source times to native 120 Hz ticks.
   near(frame.sourceTime*120,Math.round(frame.sourceTime*120),1e-8,'Source time alignment');
   while(lab.time+1e-7<frame.sourceTime)lab.step();
   const values=unpack(frame.poses);assert.equal(values.length,take.entities.length*7);assert.ok(values.every(Number.isFinite));
   vectorNear(values.slice(index*7,index*7+7),floatPose(subject.body),0,'Native root pose');
   if(helpers.length){
    const helper=helpers[3],helperIndex=take.entities.findIndex(e=>e.id===helper.id),actual=values.slice(helperIndex*7,helperIndex*7+7);
    vectorNear(actual,floatPose(helper.body),0,'Native helper pose');
    if(previousHelper&&actual.some((value,i)=>value!==previousHelper[i]))helperMoved=true;previousHelper=actual;
   }
   if(surface){
    assert.ok(!Object.hasOwn(frame.vertices,surface.id),'Static generated mesh must not be serialized as per-frame vertices');
    const measured=lab.surfaceMotion.snapshot(),readouts=modelReadouts(lab);
    near(frame.stats.surfaceMotion.bodyMass,lab.surfaceMotion.config.mass,1e-8,'Captured inherited mass');near(frame.stats.surfaceMotion.effectiveGravity,lab.surfaceMotion.config.gravity,1e-9,'Captured inherited gravity');
    near(frame.stats.readouts.azimuthSpeed,measured.azimuthSpeed,1e-8,'Actual azimuth speed readout');near(frame.stats.readouts.surfaceHeight,readouts.surfaceHeight,1e-8,'Actual anchor height');
    assert.equal(frame.stats.surfaceMotion.phase,measured.phase);
    if(measured.phase==='dynamic'){
     dynamicFrames++;assert.equal(frame.stats.surfaceMotion.energyResidual,null,'Frozen contact ledger cannot describe later collisions');assert.equal(frame.stats.surfaceMotion.energy,null);
     near(frame.stats.surfaceMotion.modelTime,lab.surfaceMotion.model.time,1e-8,'Stopped contact-model time');
     near(frame.stats.surfaceMotion.handoff.time,lab.surfaceMotion.handoff.time,1e-8,'Actual handoff provenance');
    }
   }
   framesChecked++;
  }
  if(helpers.length)assert.ok(helperMoved,'Rig helpers must animate, not just be present');
  if(dynamic){assert.ok(dynamicFrames>=5,'The source window must include real dynamic frames after handoff');assert.ok(modelParameters(take.modelProvenance).handoff,'Runtime provenance must record the actual rigid handoff');}
  return data;
 }finally{lab.dispose();}
}

try{
 await initializePhysics();
 await check('Ordinary visible body retains its native motion and analysis identity',async()=>{
  const project=base('ordinary-item',{duration:.5,gravity:0});project.objects.push({id:project.settings.focusId,asset:'cube',position:[0,3,0],velocity:[1.2,.2,0],scale:.3,mass:2,material:'metal',linearDamping:0,angularDamping:0});
  await captureAndVerify(project,'ordinary');
 });
 await check('New factory rig captures the hidden root, eleven visible helpers, actual mass/gravity and static mesh',async()=>{
  const project=surfaceScene('factory-actor',{duration:.75,gravity:1.62,targetSpeed:3});
  project.edits[project.settings.focusId]={mass:84};project.settings.surfaceMotion.mass=999;project.settings.surfaceMotion.gravity=123;
  await captureAndVerify(project,'factory-rig',{rig:true});
 });
 await check('Post-edge capture follows native rigid dynamics and stops the contact energy ledger',async()=>{
  const project=surfaceScene('edge-actor',{duration:.5,sourceStart:2.2,sourceEnd:2.7,targetSpeed:6.6});
  await captureAndVerify(project,'dynamic-rig',{rig:true,dynamic:true});
 });
 await check('Film clips with the same generated entity identity retain their different profile meshes',async()=>{
  const first=surfaceScene('shared-subject',{duration:.5,targetSpeed:3}),second=structuredClone(first);
  second.settings.surfaceMotion.surface={kind:'paraboloid',curvature:.16,offset:.3,minRadius:.05,rimRadius:4.2};
  const projects=[first,second],film=base('',{duration:1});film.film={version:1,enabled:true,title:'Distinct generated profiles',clips:projects.map((project,i)=>({id:'profile-'+i,label:'Profile '+i,project}))};
  const before=JSON.stringify(film),data=await captureFilm(film,path.join(directory,'film.json'));assert.equal(JSON.stringify(film),before);
  assert.equal(data.takes.length,2);const keys=[];
  for(const[index,project]of projects.entries()){
   const lab=new LabWorld(structuredClone(project.settings),structuredClone(project.objects),structuredClone(project.edits));
   try{
    const surface=lab.surfaceMotion.surfaceEntity,take=data.takes[index],entry=take.entities.find(e=>e.id===surface.id),expected=surface.renderSurface;
    assert.equal(entry.surface,hash(expected));keys.push(entry.surface);assert.deepEqual(data.renderSurfaces[entry.surface],expected,'A later clip cannot replace an earlier profile');
    const child=JSON.parse(await readFile(path.resolve(directory,data.film.clips[index].sourceCache),'utf8'));
    assert.equal(JSON.stringify(data.renderSurfaces[entry.surface]),JSON.stringify(child.renderSurfaces[child.takes[0].entities.find(e=>e.id===surface.id).surface]));
    assert.equal(modelParameters(data.modelProvenance.takes[index]).config.surface.kind,project.settings.surfaceMotion.surface.kind);
    assert.equal(take.frames.length,30);assert.ok(take.frames.every(f=>!Object.hasOwn(f.vertices,surface.id)));framesChecked+=take.frames.length;
   }finally{lab.dispose();}
  }
  assert.notEqual(keys[0],keys[1],'Different profiles with the same entity id must have different content keys');
  assert.notDeepEqual(data.renderSurfaces[keys[0]].positions,data.renderSurfaces[keys[1]].positions);assert.equal(Object.keys(data.renderSurfaces).length,2);
  const stored=JSON.parse(await readFile(path.join(directory,'film.json'),'utf8'));assert.equal(JSON.stringify(stored.renderSurfaces),JSON.stringify(data.renderSurfaces));
 });
 console.log(`Surface capture integration passed: ${checks} checks; ${framesChecked} frames; native root/helper poses, hidden proxy analysis, effective mass/gravity/readouts, rigid handoff and distinct hashed film meshes. ${Math.round(performance.now()-began)} ms.`);
}finally{await rm(directory,{recursive:true,force:true});}
