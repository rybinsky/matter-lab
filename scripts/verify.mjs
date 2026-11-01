import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {initializePhysics,LabWorld,ParticleFluid,launchVector,quaternion} from '../src/physics.js';
import {PLANETS,CentralGravity,HeatPenetration} from '../src/phenomena.js';
import {CATALOG,assetParts,settingsFor} from '../src/catalog.js';
import {buildLayout,layoutPoints} from '../src/layouts.js';
import {normalizedStory,editorialFrame} from '../src/storyboard.js';

// Regression checks for physical outcomes and authoring bugs. No browser or GPU.
const began=performance.now();
let passed=0;
const near=(actual,expected,tolerance,label='value')=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual}; expected ${expected} ± ${tolerance}`);
const finiteVector=(v,label)=>assert.ok([v.x,v.y,v.z].every(Number.isFinite),`${label} must be finite`);
const length=v=>Math.hypot(v.x,v.y,v.z);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// Correctness must not depend on a particular workstation's speed. A separate
// performance job can explicitly opt into a wall-clock limit.
const budgetMs=Number(process.env.MATTER_LAB_MODEL_BUDGET_MS)||0;
const budget=()=>{if(budgetMs>0)assert.ok(performance.now()-began<budgetMs,`Model verification exceeded its ${budgetMs} ms budget`);};
const blank=(extra={})=>({...settingsFor('blank'),experiment:'blank',...extra});
function stepFor(lab,seconds){for(let i=0;i<Math.round(seconds*120);i++)lab.step(1/120);}
function withWorld(settings,run){const lab=new LabWorld(settings);try{return run(lab);}finally{lab.dispose();}}
function height(soft){const vertices=soft.meshVertices(0);let lo=Infinity,hi=-Infinity;for(let i=1;i<vertices.length;i+=3){lo=Math.min(lo,vertices[i]);hi=Math.max(hi,vertices[i]);}return hi-lo;}
function check(name,run){budget();const start=performance.now();const detail=run();passed++;console.log(`✓ ${name}${detail?' — '+detail:''} (${((performance.now()-start)/1000).toFixed(2)} s)`);}

await initializePhysics();

check('Every catalog asset creates finite physical geometry',()=>{
 assert.ok(CATALOG.length>=92,'The object library must retain at least 92 assets');
 assert.equal(new Set(CATALOG.map(a=>a.id)).size,CATALOG.length,'Asset identifiers must be unique');
 let colliders=0;
 withWorld(blank({gravity:0}),lab=>{
  for(const asset of CATALOG){
   assert.ok(asset.size.every(v=>Number.isFinite(v)&&v>0),`${asset.id}: invalid catalog dimensions`);
   if(asset.id!=='softcube')for(const part of assetParts(asset.id))assert.ok(part.d.every(v=>Number.isFinite(v)&&v>0),`${asset.id}: invalid part dimensions`);
   const e=lab.addAsset(asset.id,[0,5,0],{id:'catalog-check',material:asset.mat,mass:3});
   if(e.body){
    finiteVector(e.body.translation(),asset.id);assert.ok(e.body.mass()>0,`${asset.id}: missing mass`);
    const q=e.body.rotation();assert.ok([q.x,q.y,q.z,q.w].every(Number.isFinite),`${asset.id}: invalid orientation`);
    assert.ok(e.colliders.length>0,`${asset.id}: missing colliders`);
    for(const c of e.colliders){finiteVector(c.translation(),asset.id+' collider');assert.ok(Number.isFinite(c.mass())&&c.mass()>0,`${asset.id}: invalid collider mass`);colliders++;}
   }else assert.ok([...e.soft.meshVertices(0)].every(Number.isFinite),`${asset.id}: invalid deformable vertices`);
   lab.remove(e.id);
  }
 });
 return `${CATALOG.length} assets, ${colliders} colliders`;
});

check('Gravity changes the trajectory, including zero gravity',()=>{
 const results=[];
 for(const gravity of [9.81,1.62,0])withWorld(blank({gravity}),lab=>{
  const ball=lab.addAsset('ball',[0,10,0],{mass:1});ball.body.setLinearDamping(0);
  stepFor(lab,.5);const y=ball.body.translation().y;
  near(y,10-.5*gravity*.5**2,.025,'free fall position');near(ball.body.linvel().y,-gravity*.5,.025,'free fall velocity');results.push(y);
 });
 assert.ok(results[0]<results[1]&&results[1]<results[2]);
 return 'Earth / Moon / 0 g';
});

check('Launch direction and saved quaternion transforms survive scene construction',()=>{
 const east=launchVector(10,90,0),back=launchVector(10,180,0),up=launchVector(10,30,30);
 near(east.x,10,1e-10);near(east.z,0,1e-10);near(back.z,-10,1e-10);near(up.y,5,1e-10);near(length(up),10,1e-10);
 const q=quaternion([.35,.7,-.4]),saved=JSON.parse(JSON.stringify(q));
 withWorld(blank({gravity:0}),lab=>{
  const brick=lab.addAsset('brick',[0,3,0],{rotation:saved,mass:2});stepFor(lab,.1);
  const actual=brick.body.rotation(),dot=q.x*actual.x+q.y*actual.y+q.z*actual.z+q.w*actual.w;
  assert.ok(Math.abs(dot)>1-1e-6,'A saved quaternion must preserve orientation, not create NaN');finiteVector(brick.body.translation(),'rotated brick');
 });
 assert.throws(()=>quaternion({x:NaN,y:0,z:0,w:1}),/поворот/);
});

check('A world suspension keeps its real anchor and removes stale references',()=>withWorld(blank(),lab=>{
 const body=lab.addAsset('cube',[0,4,0],{id:'pendulum',scale:.4,mass:1});
 lab.connect({id:'suspension',a:body.id,b:'world',type:'ball'});
 const anchor=lab.find('anchor-suspension').body.translation(),radius=distance(body.body.translation(),anchor);
 near(radius,1.8,1e-5,'suspension length');body.body.setLinvel({x:3,y:0,z:0},true);
 let maximumError=0;
 for(let i=0;i<144;i++){lab.step();maximumError=Math.max(maximumError,Math.abs(distance(body.body.translation(),anchor)-radius));}
 assert.ok(maximumError<.035,`Suspension rotated around the wrong point: ${maximumError} m error`);
 lab.remove(body.id);assert.equal(lab.connections.length,0,'Removed bodies must not leave live connection references');
 stepFor(lab,.1);return `maximum length error ${maximumError.toFixed(4)} m`;
}));

check('Emitters release the requested count at the requested times',()=>withWorld(blank({gravity:0,emitters:[{id:'release',asset:'ball',count:5,delay:.1,interval:.2,position:[0,5,0],speed:4,azimuth:90,elevation:0,scale:.2,mass:1}]}),lab=>{
 const bodies=lab.entities.filter(e=>e.id.startsWith('release-'));
 assert.equal(bodies.length,5);assert.equal(bodies.filter(e=>e.body.isEnabled()).length,0);
 stepFor(lab,.55);assert.equal(bodies.filter(e=>e.body.isEnabled()).length,3);
 stepFor(lab,.55);assert.equal(bodies.filter(e=>e.body.isEnabled()).length,5);
 assert.ok(bodies.every(e=>Number.isFinite(e.body.translation().x)&&e.body.translation().y>4.5));
}));

check('Elastic recovery and permanent deformation give different measured outcomes',()=>{
 const results={};
 for(const material of ['jelly','clay'])withWorld({...settingsFor('soft'),material,depth:1.15},lab=>{
  const soft=lab.softs[0].soft,initial=height(soft);let minimum=initial;
  for(let i=0;i<900;i++){lab.step();if(i%12===0)minimum=Math.min(minimum,height(soft));}
  const final=height(soft);assert.ok(minimum<initial*.7,`${material}: the press did not meaningfully compress the body`);
  assert.ok([...soft.meshVertices(0)].every(Number.isFinite),`${material}: non-finite deformation`);results[material]={initial,final,minimum};
 });
 assert.ok(results.jelly.final>results.jelly.initial*.93,'Elastic material should recover after unloading');
 assert.ok(results.clay.final<results.clay.initial*.85,'Plastic material should retain deformation');
 assert.ok(results.jelly.final-results.clay.final>.25,'The material presets must have distinguishable behavior');
 return `jelly ${(results.jelly.final/results.jelly.initial*100).toFixed(0)}%; clay ${(results.clay.final/results.clay.initial*100).toFixed(0)}% of initial height`;
});

check('Lunar orbit agrees with the circular-speed benchmark and conserves energy',()=>{
 // NASA/JPL lunar μ=4.902800118e12 m³/s², radius=1737400 m.
 // At 100 km: circular speed=1633.504 m/s, period=7067.460 s.
 const planet=PLANETS.moon,r=planet.radius+100_000,vc=Math.sqrt(planet.mu/r),period=2*Math.PI*Math.sqrt(r**3/planet.mu);
 near(vc,1633.504,.001,'100 km circular speed');near(period,7067.460,.002,'100 km orbital period');
 const circle=new CentralGravity({planet:'moon',altitude:100_000,speed:vc,timeScale:1});
 const energy=model=>.5*model.v.reduce((s,x)=>s+x*x,0)-planet.mu/Math.hypot(...model.p);
 const initialEnergy=energy(circle);let radiusError=0;
 for(let i=0;i<Math.ceil(period/2);i++){circle.step(2);radiusError=Math.max(radiusError,Math.abs(Math.hypot(...circle.p)-r)/r);}
 assert.ok(radiusError<2e-5,`Circular-orbit radial drift: ${radiusError}`);
 assert.ok(Math.abs((energy(circle)-initialEnergy)/initialEnergy)<1e-6,'Circular-orbit energy drift');assert.equal(circle.status,'flight');
 const falling=new CentralGravity({planet:'moon',altitude:100_000,speed:1200,timeScale:90});for(let i=0;i<900;i++)falling.step(1/120);
 assert.equal(falling.status,'impact');assert.ok(falling.elapsed>500&&falling.elapsed<600,'Impact must occur near the independently integrated 545-second result');near(Math.hypot(...falling.p),planet.radius,1,'impact surface');
 const escaping=new CentralGravity({planet:'moon',altitude:100_000,speed:2500,timeScale:1600});for(let i=0;i<900;i++)escaping.step(1/120);
 assert.ok(energy(escaping)>0,'Above-escape launch must retain positive specific energy');assert.ok(Math.hypot(...escaping.p)>r*3,'Escape must visibly depart rather than trace a short arc');
 return `speed ${vc.toFixed(3)} m/s, radial drift ${(radiusError*r).toFixed(2)} m`;
});

check('Heat transfer respects the finite initial energy and monotonic cooling',()=>{
 const depths=[];
 for(const mass of [.25,1,8]){
  const thermal=new HeatPenetration({...settingsFor('thermal'),mass}),initial=mass*600*1000;let previousDepth=0,previousTemperature=1000;
  for(let i=0;i<900;i++){
   thermal.step(1/120);
   assert.ok(thermal.depth>=previousDepth-1e-8,'Melt penetration cannot reverse in this model');assert.ok(thermal.temperature<=previousTemperature+1e-8,'A cooling sphere cannot gain heat without a source');
   previousDepth=thermal.depth;previousTemperature=thermal.temperature;
  }
  near(thermal.energy+thermal.loss+mass*600*thermal.temperature,initial,initial*1e-9,'thermal energy balance');
  assert.ok(thermal.energy>=0&&thermal.loss>=0&&thermal.energy+thermal.loss<=initial*(1+1e-10));
  assert.ok([...thermal.geometry().vertices].every(Number.isFinite),'Cutaway geometry must remain finite');depths.push(thermal.snapshot().depth);
 }
 assert.ok(depths[0]<depths[1]&&depths[1]<depths[2],'Larger hot spheres must transfer enough energy for greater penetration in these presets');
 return 'transferred + lost + remaining energy = initial energy';
});

check('Layouts preserve group geometry, rotated axes and reproducible variation',()=>{
 const base={id:'verify-layout',pattern:'grid',count:[2,3,2],step:[2,3,4],origin:[1,2,3],rotation:[0,90,0],turn:[0,0,0],extent:[6,4,8],radius:3,turns:2,seed:42,jitter:0,angleJitter:0,scaleJitter:0};
 const sources=[{asset:'brick',rotation:[0,.2,0],offset:[-.5,0,0],scale:1,mass:2},{asset:'apple',rotation:[0,0,0],offset:[.5,0,0],scale:1,mass:.3}];
 const objects=buildLayout(base,sources);assert.equal(objects.length,24);assert.equal(new Set(objects.map(o=>o.id)).size,24);
 for(let i=0;i<objects.length;i+=2)near(Math.hypot(...objects[i].position.map((v,k)=>v-objects[i+1].position[k])),1,1e-9,'group separation');
 near(objects[2].position[0]-objects[0].position[0],0,1e-9,'rotated X displacement');near(objects[2].position[2]-objects[0].position[2],-2,1e-9,'rotated Z displacement');
 const ring=layoutPoints({...base,pattern:'ring',count:[12,1,1]});assert.equal(ring.length,12);for(const p of ring)near(Math.hypot(p.p[0],p.p[2]),3,1e-9,'ring radius');
 const scatter={...base,pattern:'scatter',count:[24,1,1],rotation:[0,0,0],jitter:.1,angleJitter:90,scaleJitter:.2};
 assert.deepEqual(buildLayout(scatter,sources),buildLayout(scatter,sources),'The same seed must reproduce an editable scene');assert.notDeepEqual(buildLayout({...scatter,seed:43},sources),buildLayout(scatter,sources));
 assert.equal(buildLayout({...base,count:[5,5,6]},sources.slice(0,1)).length,150);
 assert.throws(()=>buildLayout({...base,count:[10,10,1]},sources),/150/,'Oversized groups must fail rather than silently truncate');
 assert.throws(()=>buildLayout({...base,count:[30,30,30]},sources.slice(0,1)),/150/);
 // The serialized output must also be usable by the actual physics constructor.
 withWorld(blank({gravity:0}),lab=>{const e=lab.addRigid(JSON.parse(JSON.stringify(objects[0])));stepFor(lab,.1);finiteVector(e.body.translation(),'generated group member');const q=e.body.rotation();assert.ok([q.x,q.y,q.z,q.w].every(Number.isFinite));});
});

check('Authored captions retain their copy and measurements never invent missing values',()=>{
 const story=normalizedStory({hook:'Что изменится?',duration:60,labels:{action:'Эта чрезмерно длинная подпись должна быть ограничена в кадре для читаемости'}});
 const first=editorialFrame({story,time:0,duration:15});assert.equal(first.teaser,true);assert.equal(first.allowAction,true,'Opening must not wait several seconds for action');assert.equal(first.metricValue,null);
 const action=editorialFrame({story,time:4,duration:15,hero:{velocity:[3,4,0]}});assert.equal(action.metricValue,5);assert.equal(action.caption,story.labels.action);assert(!action.caption.includes("…"));assert.ok(action.metricLabel.split(/\s+/).length<=5);
 const impact=editorialFrame({story,time:5,duration:15,event:{type:'impact',movieTime:5},stats:{metric:{value:42.35,unit:'см',label:'Глубина проникновения',precision:1}}});assert.equal(impact.phase,'event');assert.equal(impact.metric,'42,4');assert.equal(impact.slowMotion,.35);
 for(const missing of [null,undefined,'',NaN,Infinity])assert.equal(editorialFrame({stats:{metric:{value:missing}}}).metricValue,null);
 const final=editorialFrame({story:{takeaway:'Проверяем вывод по измерению'},time:14.9,duration:15});assert.equal(final.phase,'takeaway');assert.equal(final.caption,'Проверяем вывод по измерению');
});

check('Particle flows remain bounded and viscosity changes arrival at 7.5 seconds',()=>{
 const collected={};
 for(const material of ['water','oil','honey']){
  const fluid=new ParticleFluid({...settingsFor('flow'),material,slope:18});
  for(let i=1;i<=900;i++){
   fluid.step(1/120,i/120);if(i%120===0)budget();
  }
  assert.equal(fluid.particles.length,840,'Each material must receive the same emitted volume');
  let count=0;
  for(const p of fluid.particles){
   assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite),`${material}: non-finite particle`);
   assert.ok(Math.abs(p.x)<=2.31&&p.y>=.09&&p.y<6&&p.z>=-5.4&&p.z<4,`${material}: particle escaped the prepared flow scene`);
   assert.ok(Math.hypot(p.vx,p.vy,p.vz)<7,`${material}: unstable particle speed`);
   if(p.z< -2.55)count++;
  }
  collected[material]=count;
 }
 assert.ok(collected.water>600,'Low-viscosity flow must reach the reservoir');
 assert.ok(collected.water>collected.oil&&collected.oil>collected.honey,'Equal-time arrival must distinguish water / oil / syrup');
 return `arrived: water ${collected.water}, oil ${collected.oil}, syrup ${collected.honey} / 840`;
});

budget();
console.log(`\n${passed} model and authoring checks passed in ${((performance.now()-began)/1000).toFixed(2)} s.`);
