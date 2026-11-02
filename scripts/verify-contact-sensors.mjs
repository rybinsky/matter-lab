import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {ContactSensors,normalizeContactSensors} from '../src/contact-sensors.js';
import {modelReadouts} from '../src/measurement-readouts.js';
import {takeModelProvenance} from '../src/model-provenance.js';
import {validateProject} from '../src/validation.js';
import {capture} from './capture.mjs';
await initializePhysics();
const near=(a,b,e=1e-6,label='measurement')=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=e,`${label}: ${a} / ${b}`),arr=v=>[v.x,v.y,v.z];
const pan={id:'pan',asset:'custom',parts:[{shape:'box',d:[6,.2,6],p:[0,0,0]}],position:[0,1,0],mass:1,fixed:true,material:'metal',friction:.7,restitution:0};
const weight={id:'load',asset:'custom',parts:[{shape:'box',d:[.5,.5,.5],p:[0,0,0]}],position:[0,1.35,0],mass:5,material:'metal',friction:.7,restitution:0,linearDamping:0,angularDamping:0};
const cell=(id='vertical',axis=[0,1,0],body='pan',window=.1)=>({id,body,axis,window});
const settings=(extra={})=>({...settingsFor('blank'),experiment:'blank',gravity:9.81,windSpeed:0,autoLaunch:false,atmosphere:{enabled:false},contactSensors:[cell()],contactSensorId:'vertical',...extra});
function lab(extra={},objects=[pan,weight]){return new LabWorld(settings(extra),structuredClone(objects));}
function read(l,id='vertical'){const array=l.contactSensors.snapshot(l.settings.gravity);assert.ok(Array.isArray(array),'Sensor snapshot contract is always an array');const s=array.find(s=>s.id===id);assert.ok(s);return s;}
function advance(l,seconds,hz){for(let i=0;i<Math.round(seconds*hz);i++)l.step(1/hz);}
let checks=0;const report=[];
async function check(label,fn){const value=await fn();checks++;if(value)report.push({label,...value});console.log(`PASS ${label}`);}

await check('Schemas clone and normalize axes; duplicates and malformed sensors are rejected',()=>{
 const source=[cell('normal',[0,2,0])],before=JSON.stringify(source),n=normalizeContactSensors(source);assert.equal(JSON.stringify(source),before);assert.deepEqual(n[0].axis,[0,1,0]);n[0].axis[0]=1;assert.equal(source[0].axis[0],0);assert.deepEqual(normalizeContactSensors(undefined),[]);assert.equal(normalizeContactSensors(Array.from({length:16},(_,i)=>cell('s'+i))).length,16);
 for(const x of[null,{},[cell(),cell()],Array.from({length:17},(_,i)=>cell('s'+i)),[cell('bad id')],[{...cell(),body:''}],[cell('x',[0,0,0])],[cell('x',[0,NaN,0])],[cell('x',[0,Infinity,0])],[cell('x',[0,1])],[cell('x',[0,1,0],'pan',.009)],[cell('x',[0,1,0],'pan',2.01)],[{...cell(),surprise:1}]])assert.throws(()=>normalizeContactSensors(x));
 const project={version:1,settings:settings(),objects:structuredClone([pan,weight]),edits:{}};validateProject(project);assert.throws(()=>validateProject({...project,settings:settings({contactSensorId:'absent'})}));assert.throws(()=>validateProject({...project,settings:settings({contactSensors:[cell(),cell()]})}));
});
await check('A real5kg resting contact reads mg at120/240Hz, including sleeping and changed dt while asleep',()=>{
 const runs=[];for(const hz of[120,240]){const l=lab();try{advance(l,5,hz);const b=l.find('load').body,s=read(l);near(s.force,5*9.81,.05,'Resting5kg force');near(s.equivalentMass,5,.006,'Resting equivalent mass');if(!b.isSleeping())b.sleep();const before=read(l).force;
  for(const dt of[1/240,1/90,1/120,1/60])for(let i=0;i<24;i++){l.step(dt);assert.equal(b.isSleeping(),true,'A passive reading must not wake a sleeping load');near(read(l).force,before,.05,'Sleep force cannot scale with changed timestep');}
  runs.push({hz,force:read(l).force,equivalentMass:read(l).equivalentMass,loadSleeping:b.isSleeping()});
 }finally{l.dispose();}}return{runs};
});
await check('Lunar gravity still reports5kg equivalent; zero gravity has no equivalent-kg readout',()=>{
 const moon=lab({gravity:1.62});try{advance(moon,5,120);near(read(moon).force,8.1,.02);near(read(moon).equivalentMass,5,.013);near(modelReadouts(moon).normalLoadKg,5,.013);}finally{moon.dispose();}
 const zero=lab({gravity:0});try{advance(zero,1,120);assert.equal(read(zero).equivalentMass,null);assert.ok(!Object.hasOwn(modelReadouts(zero),'normalLoadKg'));assert.ok(Number.isFinite(modelReadouts(zero).normalLoadN));}finally{zero.dispose();}
});
await check('Wrong axes show no normal load even with genuine tangential friction impulses',()=>{
 const l=lab({contactSensors:[cell('side',[1,0,0]),cell('down',[0,-1,0]),cell('vertical')],contactSensorId:'vertical'});try{const load=l.find('load').body;load.addForce({x:12,y:0,z:0},true);let tangential=0;for(let i=0;i<360;i++){const before=load.linvel().x;l.step();tangential+=Math.abs(load.mass()*(load.linvel().x-before)-12/120);}assert.ok(tangential>.1,'Horizontal momentum balance must contain real friction reaction to the external12N force');near(read(l,'side').force,0,1e-7);near(read(l,'down').force,0,1e-7);near(read(l).force,49.05,.1);return{tangentialImpulseFromMomentumBalance:tangential,sideNormalN:read(l,'side').force};}finally{l.dispose();}
});
await check('Joint-supported weight is explicitly excluded when there is no contact',()=>{
 const suspended={...weight,position:[0,3,0]},l=lab({connections:[{id:'suspension',type:'fixed',a:'load',b:'pan'}]},[pan,suspended]);try{advance(l,3,120);near(l.find('load').body.translation().y,3,.001);near(read(l).force,0,1e-8);}finally{l.dispose();}
});
await check('A0.1s contact-load window matches independent momentum-flux impulses with fractional variable-dt overlap',()=>{
 const drop={id:'load',asset:'custom',parts:[{shape:'sphere',d:[.1],p:[0,0,0]}],mass:1,material:'rubber',position:[0,2,0],velocity:[0,-4,0],friction:0,restitution:0,linearDamping:0,angularDamping:0},l=lab({gravity:0},[pan,drop]),samples=[];let maxError=0,totalImpulse=0,peak=0;
 try{for(let i=0;i<100;i++){const dt=[.007,.011,.006][i%3],before=l.find('load').body.linvel().y,start=l.time;l.step(dt);const impulse=l.find('load').body.mass()*(l.find('load').body.linvel().y-before),end=l.time;samples.push({start,end,impulse});totalImpulse+=impulse;const cutoff=end-.1,expected=samples.reduce((sum,s)=>sum+s.impulse*Math.max(0,s.end-Math.max(s.start,cutoff))/(s.end-s.start),0)/Math.min(end,.1),measured=read(l);maxError=Math.max(maxError,Math.abs(measured.force-expected));peak=Math.max(peak,measured.force);assert.equal(measured.equivalentMass,null);}
  near(totalImpulse,4,.002,'Integrated collision impulse');assert.ok(peak>35&&peak<45);assert.ok(maxError<.003,'Window force must match independent ΔP,not an unweighted frame average');near(read(l).force,0,.001);return{totalImpulseNs:totalImpulse,peakAveragedN:peak,maxWindowErrorN:maxError};
 }finally{l.dispose();}
});
await check('Deleted or replaced sensor targets retire without binding silently to a new body',()=>{
 for(const replace of[false,true]){const l=lab();try{advance(l,.5,120);l.remove('pan');if(replace)l.addRigid(structuredClone(pan));l.step();const s=read(l);assert.equal(s.status,'retired');assert.equal(s.force,0);assert.equal(s.rawForce,0);assert.ok(!Object.hasOwn(modelReadouts(l),'normalLoadN'));}finally{l.dispose();}}
});
await check('The active-id selects a non-first cell and metadata includes its genuine measurement scope',()=>{
 const l=lab({contactSensors:[cell('side',[1,0,0]),cell('up')],contactSensorId:'up'});try{advance(l,3,120);const r=modelReadouts(l),stats=l.stats();near(r.normalLoadN,49.05,.05);near(r.normalLoadKg,5,.006);near(stats.readouts.normalLoadN,r.normalLoadN,0);near(read(l,'side').force,0,1e-8);const p=takeModelProvenance({settings:l.settings}),m=p.models.find(m=>m.id==='contact-load-cell');assert.ok(m);assert.equal(m.parameters.activeId,'up');assert.equal(m.parameters.gravity,9.81);assert.equal(m.parameters.sensors.length,2);assert.ok(m.limitations.some(s=>/joint forces/.test(s)));assert.ok(m.limitations.some(s=>/normal impulses/.test(s)));}finally{l.dispose();}
});
await check('Adding sensors leaves every physical pose,velocity,quaternion,sleep state and foreign load exactly unchanged',()=>{
 const objects=[pan,{...weight,position:[0,3,0],velocity:[.4,0,.1]}],a=lab({contactSensors:[],contactSensorId:undefined},objects),b=lab({},objects);try{
  for(let i=0;i<720;i++){const dt=i<360?1/120:1/240;a.step(dt);b.step(dt);for(const id of['load','pan']){const aa=a.find(id).body,bb=b.find(id).body;for(const key of['translation','linvel','angvel'])assert.deepEqual(arr(aa[key]()),arr(bb[key]()));assert.deepEqual(aa.rotation(),bb.rotation());assert.equal(aa.isSleeping(),bb.isSleeping());assert.deepEqual(aa.userForce(),bb.userForce());assert.deepEqual(aa.userTorque(),bb.userTorque());}}
 }finally{a.dispose();b.dispose();}
});
const directory=await mkdtemp(path.join(tmpdir(),'matter-contact-sensors-'));
try{await check('An actual capture exports selected normal-load readouts and contact-sensor provenance',async()=>{
 const project={version:1,height:720,series:false,objects:structuredClone([pan,weight]),edits:{},settings:settings({contactSensors:[cell('side',[1,0,0]),cell('up')],contactSensorId:'up',exportFps:60,cameraRig:{mode:'keys',interpolation:'linear',points:[{time:0,sourceTime:1,position:[4,4,7],target:[0,1.5,0],fov:45},{time:.5,sourceTime:1.5,position:[4,4,7],target:[0,1.5,0],fov:45}]},story:{enabled:true,autoTrim:false,cues:[{start:0,end:.5,text:'{normalLoadN} Н',label:'Эквивалент {normalLoadKg} кг',fade:0}]}})};validateProject(project);const data=await capture(project,path.join(directory,'sensor.json'));assert.equal(data.takes[0].frames.length,30);const m=data.modelProvenance.models.find(m=>m.id==='contact-load-cell');assert.ok(m);for(const f of data.takes[0].frames){near(f.stats.readouts.normalLoadN,49.05,.05);assert.match(f.editorial.caption,/49,\d Н/);assert.match(f.editorial.takeLabel,/5,00 кг/);}assert.equal(data.takes[0].modelProvenance.models.find(m=>m.id==='contact-load-cell').parameters.activeId,'up');
 });}finally{await rm(directory,{recursive:true,force:true});}
await check('Disposal clears passive sensor references before the underlying world is freed',()=>{
 const l=lab(),s=l.contactSensors;l.dispose();assert.deepEqual(s.snapshot(9.81),[]);
});
const result={passed:true,checks,report,domain:'Read-only outward-axis compressive normal-contact impulses averaged over physical time; friction/joint forces excluded; equivalent mass means N/positiveg,not total object mass in flight.'};
const output=process.argv.find(x=>x.startsWith('--report='))?.slice(9);if(output)await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
