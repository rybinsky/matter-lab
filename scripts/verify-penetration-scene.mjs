import assert from 'node:assert/strict';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
import {capture} from './capture.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PenetrationScene,physicalTimeAt,validatePenetrationScene,PENETRATION_CAVITY_BINS} from '../src/penetration-scene.js';
await initializePhysics();
const spec={projectileId:'shot',targetId:'sample',axis:[0,-1,0],entry:[0,1.1,0],leadDistance:.05,parameters:{projectile:{mass:.01,radius:.004,length:.025,specificHeat:500,temperature:1000},target:{thickness:.7},initialSpeed:150},clock:[{time:0,elapsed:0},{time:3,elapsed:.006},{time:5,elapsed:.02},{time:20,elapsed:600}]};
const objects=[{id:'shot',asset:'cylinder',position:[0,1.2,0],mass:.01,material:'metal'},{id:'sample',asset:'cube',position:[0,.75,-.175],scale:.7,fixed:true,material:'ice'}];
const near=(a,b,tolerance,message)=>assert(Math.abs(a-b)<=tolerance,`${message}: ${a} versus ${b}`);
function profileCheck(controller){
 const s=controller.snapshot(),p=controller.sideMeltProfile(),parameters=controller.model.parameters,r=parameters.projectile.radius,rho=parameters.target.density;
 assert.equal(p.bins.length,PENETRATION_CAVITY_BINS);assert(p.bins.every(b=>b.sideMeltedMass>=0&&Number.isFinite(b.radius)&&b.radius>=r));
 near(p.sideMeltedMass,s.sideMeltedMass,1e-12,'Local bins conserve model side mass');
 // Independently integrate annular volumes, rather than reading the adapter's
 // total or reusing its deposition weights.
 const geometricMass=p.bins.reduce((mass,b)=>mass+Math.PI*(b.radius*b.radius-r*r)*Math.max(0,Math.min(b.end,s.frontDepth)-b.start)*rho,0);
 near(geometricMass,s.sideMeltedMass,1e-12,'Annular bin volume conserves side mass');
 near(p.renderClippedSideMass,0,1e-12,'This specimen fits within display bounds');return p;
}
function signedVolume(geometry){let volume=0;const v=geometry.vertices,ids=geometry.indices;for(let i=0;i<ids.length;i+=3){const a=ids[i]*3,b=ids[i+1]*3,c=ids[i+2]*3;volume+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])+v[a+1]*(v[b+2]*v[c]-v[b]*v[c+2])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6;}return volume;}
function fixture(config=spec){const lab=new LabWorld({...settingsFor('blank'),autoLaunch:false},structuredClone(objects));return{lab,controller:new PenetrationScene(lab,structuredClone(config))};}
const lab=new LabWorld({...settingsFor('blank'),autoLaunch:false},objects);
try{
 const controller=new PenetrationScene(lab,spec);assert.equal(lab.find('sample').renderHidden,true);assert(lab.find('shot').body.isKinematic());assert(lab.find('shot').colliders.every(c=>!c.isEnabled()));
 assert(controller.snapshot().tipDepth<0);assert.equal(controller.snapshot().phase,'flight');
 const initial=controller.surface.geometry(),count=initial.vertices.length,indices=initial.indices.slice();
 assert(lab.find('shot').visualParts.every(p=>p.shape!=='cylinder'||p.d[0]<=controller.model.parameters.projectile.radius),'Decorative rings must fit the stated bore');
 controller.update(3);const hit=controller.snapshot();assert(hit.depth>0);assert(hit.energies.mechanicalResidual<1e-6);
 controller.update(20);const final=controller.snapshot(),geometry=controller.surface.geometry();assert.equal(final.elapsed,600);assert(final.depth>=hit.depth);assert(final.depth<=.7);assert(final.temperature<1000);assert.equal(geometry.vertices.length,count);assert.deepEqual(geometry.indices,indices);assert(geometry.vertices.every(Number.isFinite));assert(geometry.indices.every(i=>i<geometry.vertices.length/3));
 const profile=profileCheck(controller),expectedRemoved=.5*(Math.PI*spec.parameters.projectile.radius**2*final.frontDepth+final.sideMeltedMass/controller.model.parameters.target.density),polygonAreaFactor=20*Math.sin(Math.PI/20)/Math.PI,meshRemoved=signedVolume(initial)-signedVolume(geometry);
 near(meshRemoved,expectedRemoved*polygonAreaFactor,3e-8,'Actual indexed half-mesh has the expected cavity volume, including polygon tessellation');
 const entrySideMass=profile.bins.filter(b=>b.end<final.mechanicalDepth/2).reduce((m,b)=>m+b.sideMeltedMass,0);assert(entrySideMass<profile.sideMeltedMass*.001,'Old entry sections keep only their tiny millisecond impact heat, rather than a uniform share of later heat');
 assert.match(final.cavityGeometryApproximation,/приближение/);assert.match(controller.surface.geometryApproximation,/3D/);
 const nose=lab.find('shot').body.translation().y-controller.model.parameters.projectile.length/2;assert(Math.abs(nose-(spec.entry[1]-final.depth))<1e-6);
 assert(Math.abs(controller.model.parameters.projectile.mass-.01)<1e-8);assert.equal(controller.model.parameters.gravity,9.81);
 assert.throws(()=>controller.update(1),/Перемотка/);
 assert(Math.abs(physicalTimeAt(spec.clock,4)-.013)<1e-12);
 for(const bad of [{...spec,axis:[0,0,0]},{...spec,targetId:'shot'},{...spec,clock:[{time:0,elapsed:0},{time:1,elapsed:-1}]}])assert.throws(()=>validatePenetrationScene(bad));
 console.log(JSON.stringify({checks:'Penetration scene adapter: explicit two clocks, actual mass, gravity projection, flight, immutable mesh topology, aligned nose and validated clock passed',impactDepth:hit.depth,finalDepth:final.depth,temperature:final.temperature,mechanicalResidual:final.energies.mechanicalResidual,thermalResidual:final.energies.thermalResidual}));
}finally{lab.dispose();}

// A fresh direct jump and a 2400-update replay must deposit the same heat
// locally to numerical accuracy, rather than assigning all 600 s at the final
// projectile position. This is a convergence check, not experimental validation.
{
 const a=fixture(),b=fixture();try{
  a.controller.update(20);for(let i=1;i<=2400;i++)b.controller.update(20*i/2400);
  const pa=profileCheck(a.controller),pb=profileCheck(b.controller),sa=a.controller.snapshot(),sb=b.controller.snapshot();
  const l1=pa.bins.reduce((s,bin,i)=>s+Math.abs(bin.sideMeltedMass-pb.bins[i].sideMeltedMass),0);
  near(sa.depth,sb.depth,2e-7,'Direct/fine depth');near(sa.temperature,sb.temperature,2e-4,'Direct/fine temperature');
  assert(l1/sa.sideMeltedMass<1e-5,`Direct/fine local side profile differs by ${l1/sa.sideMeltedMass}`);
  console.log(JSON.stringify({checks:'Direct-jump/fine-update local profile convergence',binCount:pa.binCount,profileRelativeL1:l1/sa.sideMeltedMass,depthDifference:sa.depth-sb.depth,temperatureDifference:sa.temperature-sb.temperature,vertices:a.controller.surface.geometry().vertices.length/3}));
 }finally{a.lab.dispose();b.lab.dispose();}
}

// Incremental heat after the mechanical phase can only reach bins intersecting
// the actual swept wetted cylinder, not the old entry channel or future ice.
{
 const f=fixture();try{
  f.controller.update(5);const before=f.controller.snapshot(),previous=profileCheck(f.controller);f.controller.update(5.1);const after=f.controller.snapshot(),next=profileCheck(f.controller),lo=Math.max(0,before.depth-spec.parameters.projectile.length),hi=after.depth;
  assert(after.sideMeltedMass>before.sideMeltedMass);
  for(let i=0;i<next.bins.length;i++){const bin=next.bins[i],delta=bin.sideMeltedMass-previous.bins[i].sideMeltedMass;assert(delta>=-1e-15);if(bin.end<=lo||bin.start>=hi)near(delta,0,1e-15,'Incremental side mass stays within swept contact');}
 }finally{f.lab.dispose();}
}

// Cold controls carve only the unchanged mechanical bore: no side mass or
// radius growth. Mesh storage/indices remain fixed at zero, bin boundaries,
// a partial front and an actual breakthrough, including a rotated axis.
for(const temperature of [0,1000]){
 const config=structuredClone(spec);config.parameters.projectile.temperature=temperature;const f=fixture(config);try{
  const first=f.controller.surface.geometry(),indices=first.indices.slice();
  for(const t of [0,1,3,5,5.1,10,20]){f.controller.update(t);const g=f.controller.surface.geometry();assert.equal(g.vertices.length,first.vertices.length);assert.deepEqual(g.indices,indices);assert(g.vertices.every(Number.isFinite));const p=profileCheck(f.controller);if(temperature===0){assert.equal(p.sideMeltedMass,0);assert(p.bins.every(b=>b.radius===config.parameters.projectile.radius));}}
 }finally{f.lab.dispose();}
}
{
 const config=structuredClone(spec);config.parameters.target.thickness=.05;config.clock=[{time:0,elapsed:0},{time:20,elapsed:1}];config.axis=[1,0,0];const f=fixture(config);try{
  const first=f.controller.surface.geometry(),indices=first.indices.slice();f.controller.update(20);assert(f.controller.snapshot().passed);const g=f.controller.surface.geometry();assert.equal(g.vertices.length,first.vertices.length);assert.deepEqual(g.indices,indices);assert(g.vertices.every(Number.isFinite));profileCheck(f.controller);
  const full=.05**3/2,profile=f.controller.sideMeltProfile(),removed=.5*profile.bins.reduce((v,b)=>v+Math.PI*b.radius*b.radius*b.openLength,0),expected=(full-removed*20*Math.sin(Math.PI/20)/Math.PI);near(signedVolume(g),expected,3e-9,'Breakthrough mesh has an open exit, not a duplicate front cap');
 }finally{f.lab.dispose();}
}
{
 const config=structuredClone(spec);config.leadDistance=0;config.axis=[1,0,0];config.parameters={projectile:{...config.parameters.projectile,temperature:0},target:{thickness:1,strength:0,drag:0,heatTransfer:0,sideHeatTransfer:0},initialSpeed:1};config.clock=[{time:0,elapsed:0},{time:20,elapsed:1}];const f=fixture(config);try{
  const first=f.controller.surface.geometry(),indices=first.indices.slice();
  for(const time of [0,2.5-1e-8,2.5,2.5+1e-8,10,20]){f.controller.update(time);const s=f.controller.snapshot(),g=f.controller.surface.geometry();assert.equal(g.vertices.length,first.vertices.length);assert.deepEqual(g.indices,indices);assert(g.vertices.every(Number.isFinite));profileCheck(f.controller);const expectedRemoved=Math.PI*.004**2*s.frontDepth/2*20*Math.sin(Math.PI/20)/Math.PI;near(signedVolume(first)-signedVolume(g),expectedRemoved,3e-8,'No jump/double cap at an exact axial-bin boundary');}
 }finally{f.lab.dispose();}
}
console.log('Local cavity geometry passed: side-mass/annular-volume conservation, swept-contact locality, cold zero-growth, finite indexed mesh, exact bin boundaries, open breakthrough, flush bands and explicit approximation metadata. This validates an equivalent-volume 1D visualization, not real 3D damage or heat flow.');

const project={version:1,name:'Integration',settings:{...settingsFor('blank'),autoLaunch:false,penetration:structuredClone(spec),exportFps:60,cameraRig:{mode:'keys',points:[{time:0,sourceTime:0,position:[0,1,2],target:[0,.75,0],fov:40},{time:.2,sourceTime:20,position:[0,1,2],target:[0,.75,0],fov:40}]},story:{enabled:true,duration:5,captionMode:'authored',metric:'none',cues:[{start:0,end:.2,text:'Глубина {depthCm} см · {temperature} °C',label:'{physicalSeconds} с физического времени',fade:0}]}},objects:structuredClone(objects),edits:{}};
validateProject(project);const integrated=new LabWorld(project.settings,project.objects,project.edits);
try{assert(integrated.penetration);for(let i=0;i<2400;i++)integrated.step();assert(Math.abs(integrated.penetration.snapshot().depth-.484072063565)<1e-5);}finally{integrated.dispose();}
for(const change of [{connections:[{a:'shot',b:'sample',type:'fixed'}]},{penetration:{...spec,targetId:'missing'}}])assert.throws(()=>validateProject({...project,settings:{...project.settings,...change}}));
const temp=await mkdtemp(path.join(tmpdir(),'matter-penetration-'));
try{const data=await capture(project,path.join(temp,'capture.json'));assert(!data.takes[0].entities.some(e=>e.id==='sample'),'The original ice cube must not cover the calculated cutaway');assert.equal(data.takes[0].meshes.find(m=>m.id==='sample').kind,'penetration-cutaway');assert(data.takes[0].frames.at(-1).penetration.depth>0);assert(data.takes[0].frames.every(f=>Number.isFinite(f.penetration.temperature)));for(const frame of data.takes[0].frames){assert(frame.editorial.takeLabel.includes(frame.penetration.elapsed.toLocaleString('ru-RU',{maximumFractionDigits:2})));assert(frame.editorial.caption.includes((frame.penetration.depth*100).toLocaleString('ru-RU',{maximumFractionDigits:1})));}assert.match(data.takes[0].frames.at(-1).penetration.cavityGeometryApproximation,/приближение/);assert.equal(data.takes[0].entities.find(e=>e.id==='shot').parts[0].d[0],.004);console.log('LabWorld and capture integration: controller advances automatically; hidden target, cutaway, true projectile size, clock and frame measurements preserved.');}finally{await rm(temp,{recursive:true,force:true});}
