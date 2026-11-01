import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCameraSampler, normalizeCameraRig, simplifyCameraRig } from '../src/camera-rig.js';
import { trimFilmClip, splitFilmClip } from '../src/film-editing.js';
import { settingsFor } from '../src/catalog.js';
import { capture } from './capture.mjs';

const started=performance.now(),temporary=await mkdtemp(path.join(tmpdir(),'matter-camera-attention-'));
let passed=0,captures=0,comparedFrames=0,maxCameraError=0,maxEditedCameraError=0;
const failures=[];
const near=(a,b,tolerance=1e-7)=>assert(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const vectorNear=(a,b)=>a.forEach((value,index)=>{maxCameraError=Math.max(maxCameraError,Math.abs(value-b[index]));near(value,b[index]);});
const add=(a,b)=>a.map((value,index)=>value+b[index]);
const average=(a,b)=>a.map((value,index)=>(value+b[index])/2);
const point=(time,sourceTime,ids,offset=[0,0,0],method='smooth')=>({time,sourceTime,position:[6,5,8],target:[0,1,0],fov:40,...(ids?{attentionIds:ids,attentionOffset:offset,attentionTransition:method}:{})});
const rig=()=>({mode:'keys',interpolation:'smooth',anchorId:'',points:[
  point(0,0,['a']),point(1,.6,['a']),point(2,.6,['b']),point(3,1.2,['a','b'],[0,.4,0]),point(4,.2),
]});
const project=cameraRig=>({version:1,name:'Authored attention regression',series:false,edits:{},objects:[
  {id:'a',asset:'ball',position:[-1,3,0],velocity:[1.1,0,.1],scale:.3,mass:1,material:'metal'},
  {id:'b',asset:'ball',position:[3,1.8,-1],velocity:[-.25,.1,.5],scale:.3,mass:2,material:'wood'},
  {id:'anchor',asset:'crate',position:[-3,1.2,0],velocity:[.2,0,0],scale:.3,mass:3,material:'wood'},
],settings:{...settingsFor('blank'),experiment:'blank',gravity:0,exportFps:30,simulationDuration:1.2,story:{enabled:false,duration:5,metric:'none',heroId:'a',autoTrim:false,cues:[]},cameraRig}});
const removeAttention=input=>({...input,points:input.points.map(({attentionIds,attentionOffset,attentionTransition,attentionMix,...point})=>point)});
async function check(name,run){try{await run();passed++;console.log(`✓ ${name}`);}catch(error){failures.push(`${name}: ${error.stack||error.message}`);console.error(`✗ ${name}: ${error.message}`);}}
async function render(input){const result=await capture(input,path.join(temporary,`${captures++}.json`));assert.equal(result.takes.length,1);return result.takes[0];}
function position(take,frame,id){const index=take.entities.findIndex(entity=>entity.id===id);assert(index>=0);const bytes=Buffer.from(frame.poses,'base64');return[0,1,2].map(axis=>bytes.readFloatLE((index*7+axis)*4));}
function physicalEqual(a,b){assert.equal(a.frames.length,b.frames.length);for(let index=0;index<a.frames.length;index++){assert.equal(a.frames[index].poses,b.frames[index].poses);assert.deepEqual(a.frames[index].vertices,b.frames[index].vertices);near(a.frames[index].sourceTime,b.frames[index].sourceTime,1e-10);vectorNear(a.frames[index].camera.position,b.frames[index].camera.position);near(a.frames[index].camera.fov,b.frames[index].camera.fov);}}
function sameFrames(actual,expected){assert.equal(actual.length,expected.length);for(let index=0;index<actual.length;index++){const a=actual[index],b=expected[index];assert.equal(a.poses,b.poses);assert.deepEqual(a.vertices,b.vertices);near(a.sourceTime,b.sourceTime,1e-10);for(const field of ['position','target'])for(let axis=0;axis<3;axis++)maxEditedCameraError=Math.max(maxEditedCameraError,Math.abs(a.camera[field][axis]-b.camera[field][axis]));vectorNear(a.camera.position,b.camera.position);vectorNear(a.camera.target,b.camera.target);near(a.camera.fov,b.camera.fov);comparedFrames++;}}

try{
  await check('World-space legacy keys stay unchanged; sampler snapshots and recipe results are independent',()=>{
    const old=removeAttention(rig()),snapshot=structuredClone(old),sample=createCameraSampler(old),before=sample(1.5);
    assert(!Object.hasOwn(normalizeCameraRig(old).points[0],'attentionIds'));
    assert(!Object.hasOwn(before,'attentionMix'));vectorNear(before.position,[6,5,8]);vectorNear(before.target,[0,1,0]);
    old.points[0].position[0]=999;before.target[0]=999;
    vectorNear(sample(1.5).target,[0,1,0]);vectorNear(sample(0).position,[6,5,8]);
    const input=rig(),sampler=createCameraSampler(input,{resolveTarget:()=>[2,3,4]}),pose=sampler(.2);
    pose.attentionMix[0].target[0]=888;assert.notEqual(sampler(.2).attentionMix[0].target[0],888);
    assert.deepEqual(input,rig());assert.deepEqual(snapshot,removeAttention(rig()));
  });
  await check('Actual moving targets and groups change only look-at, including a physics hold and rewind',async()=>{
    const input=project(rig()),plain=await render(project(removeAttention(rig()))),take=await render(input);
    physicalEqual(take,plain);
    const targetAt=index=>take.frames[index].camera.target;
    vectorNear(targetAt(0),position(take,take.frames[0],'a'));
    const held=take.frames[45],a=position(take,held,'a'),b=position(take,held,'b');
    vectorNear(targetAt(45),average(a,b));
    vectorNear(targetAt(60),position(take,take.frames[60],'b'));
    const groupFrame=take.frames[90];
    vectorNear(targetAt(90),add(average(position(take,groupFrame,'a'),position(take,groupFrame,'b')),[0,.4,0]));
    const rewind=take.frames[105];
    vectorNear(rewind.camera.target,average(add(average(position(take,rewind,'a'),position(take,rewind,'b')),[0,.4,0]),[0,1,0]));
    assert(take.frames.slice(31,60).every(frame=>frame.poses===held.poses));
    assert(Math.hypot(...targetAt(31).map((value,axis)=>value-targetAt(59)[axis]))>1);
    assert(take.frames.some((frame,index)=>index>0&&frame.sourceTime<take.frames[index-1].sourceTime));
  });
  await check('Coordinate anchor moves the eye once while object attention remains in world coordinates',async()=>{
    const input=project({...rig(),anchorId:'anchor'}),take=await render(input),plain=await render(project(removeAttention(input.settings.cameraRig)));
    physicalEqual(take,plain);
    for(const index of [0,30,60,90]){const frame=take.frames[index];vectorNear(frame.camera.position,add(position(take,frame,'anchor'),[6,5,8]));}
    vectorNear(take.frames[60].camera.target,position(take,take.frames[60],'b'));
    const frame=take.frames[105],group=add(average(position(take,frame,'a'),position(take,frame,'b')),[0,.4,0]);
    vectorNear(frame.camera.target,average(group,add(position(take,frame,'anchor'),[0,1,0])));
  });
  await check('Static camera can watch a moving object without translating the camera',async()=>{
    const input=project({mode:'static',interpolation:'linear',points:[point(0,0,['a']),point(4,1.2,['a'])]}),take=await render(input);
    for(const frame of take.frames){vectorNear(frame.camera.position,[6,5,8]);vectorNear(frame.camera.target,position(take,frame,'a'));}
    assert.notDeepEqual(take.frames[0].camera.target,take.frames.at(-1).camera.target);
  });
  await check('Cut and smooth attention transitions are independent of the camera position and resolver uses source time',()=>{
    const calls=[],input={mode:'keys',interpolation:'linear',points:[point(0,0,['a']),point(2,1,['b'],[0,0,0],'cut')]};
    const sampler=createCameraSampler(input,{resolveTarget:(id,source)=>{calls.push(source);return id==='a'?[source,0,0]:[10+source,0,0];}});
    vectorNear(sampler(1.5).target,[.75,0,0]);vectorNear(sampler(2).target,[11,0,0]);
    assert(calls.includes(.75));vectorNear(sampler(1.5).position,[6,5,8]);
    input.points[1].attentionTransition='smooth';const smooth=createCameraSampler(input,{resolveTarget:id=>id==='a'?[0,0,0]:[10,0,0]});
    vectorNear(smooth(.5).target,[1.5625,0,0]);
  });
  await check('Trim, split, and a second trim preserve actual attention frames and local anchor recipes',async()=>{
    const input={id:'original',project:project({...rig(),anchorId:'anchor'})},before=structuredClone(input),original=await render(input.project);
    const trimmed=trimFilmClip(input,{start:.4,end:3.6,fps:30}),take=await render(trimmed.project);
    sameFrames(take.frames,original.frames.slice(12,108));
    assert(trimmed.project.settings.cameraRig.points.some(point=>point.attentionMix?.length));
    const [left,right]=splitFilmClip(input,1.367,{rightId:'right',fps:30});
    sameFrames([...(await render(left.project)).frames,...(await render(right.project)).frames],original.frames);
    const again=trimFilmClip(trimmed,{start:.3,end:2.4,fps:30});
    sameFrames((await render(again.project)).frames,original.frames.slice(21,84));
    assert.deepEqual(input,before);
  });
  await check('Simplification keeps attention recipes and repeated recipe normalization coalesces identical groups',()=>{
    const input=rig(),sampler=createCameraSampler(input),dense={...input,points:Array.from({length:61},(_,index)=>{const time=index/15,p=sampler(time);return{time,sourceTime:p.sourceTime,position:p.position,target:p.target,fov:p.fov,...(p.attentionMix?{attentionMix:p.attentionMix,attentionTransition:'linear'}:{})};})};
    const reduced=simplifyCameraRig(dense,13);assert.equal(reduced.points.length,13);assert(reduced.points.every(point=>point.attentionMix?.length));
    const resolver=id=>id==='a'?[1,3,2]:[7,1,4],a=createCameraSampler(dense,{resolveTarget:resolver}),b=createCameraSampler(reduced,{resolveTarget:resolver});
    for(const point of reduced.points)vectorNear(a(point.time).target,b(point.time).target);
    const mixture={mode:'keys',points:[{...point(0,0),attentionMix:[{weight:.3,ids:['a'],offset:[0,1,0],target:[0,0,0]},{weight:.7,ids:['a'],offset:[0,3,0],target:[2,0,0]}]}]};
    const normalized=normalizeCameraRig(mixture);assert.equal(normalized.points[0].attentionMix.length,1);near(normalized.points[0].attentionMix[0].offset[1],2.4);near(normalized.points[0].attentionMix[0].target[0],1.4);
  });
  await check('Missing attention ids are visible in sampler diagnostics and rejected clearly at export',async()=>{
    const input=project({mode:'keys',points:[point(0,0,['removed']),point(1,.6,['removed'])]}),sample=createCameraSampler(input.settings.cameraRig)(0);
    assert.deepEqual(sample.attentionMissingIds,['removed']);vectorNear(sample.target,[0,1,0]);
    await assert.rejects(()=>render(input),/цел|вниман|предмет|удал|attention/i);
    const excessive={mode:'keys',points:[point(0,0,Array.from({length:17},(_,i)=>`object-${i}`))]};
    assert.throws(()=>createCameraSampler(excessive),/16/);
  });
}finally{await rm(temporary,{recursive:true,force:true});}
console.log(JSON.stringify({passed,failed:failures.length,captures,comparedFrames,maxCameraError,maxEditedCameraError,seconds:+((performance.now()-started)/1000).toFixed(3)},null,2));
if(failures.length){console.error(failures.join('\n\n'));process.exitCode=1;}
