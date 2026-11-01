import assert from 'node:assert/strict';
import {buildLayout,buildLayoutAssembly} from '../src/layouts.js';
import {snapshotAssemblyConnections} from '../src/composer.js';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';

const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<=e,`${a} != ${b} (tolerance ${e})`);
const dist=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const pos=e=>{const p=e.body.translation();return[p.x,p.y,p.z];};
const base={id:'assembly-test',pattern:'line',count:[3,1,1],step:[4,0,0],origin:[-4,2,0],rotation:[0,0,0],turn:[0,0,0],extent:[6,4,6],radius:3,turns:2,jitter:0,angleJitter:0,scaleJitter:0,seed:42,align:true};
const part=(sourceId,offset,fixed=false)=>({sourceId,asset:'ball',material:'metal',scale:.25,mass:1,offset,rotation:[0,0,0],fixed});
const report={cases:[],checks:0};
const R=await initializePhysics();

// A pendulum is a relationship, not a special asset. Count and physical
// invariants catch dropped anchors, cross-copy joints and invalid point maps.
const pendulum=[part('pivot',[0,2,0],true),part('bob',[.6,.8,0])];
const hinge=[{id:'hinge',type:'hinge',axis:'z',a:'pivot',b:'bob',point:[0,2,0]}];
const before=JSON.stringify({base,pendulum,hinge});
const pendulumCopy=buildLayoutAssembly(base,pendulum,hinge);
assert.equal(JSON.stringify({base,pendulum,hinge}),before);
assert.equal(pendulumCopy.objects.length,6);assert.equal(pendulumCopy.connections.length,3);
assert.equal(pendulumCopy.objects.filter(o=>o.fixed).length,3);assert.deepEqual(pendulumCopy.warnings,[]);
assert.equal(new Set(pendulumCopy.connections.map(c=>c.id)).size,3);
for(let i=0;i<3;i++)assert.deepEqual([pendulumCopy.connections[i].a,pendulumCopy.connections[i].b],[`${base.id}-${i}-0`,`${base.id}-${i}-1`]);
const pWorld=new LabWorld({...settingsFor('blank'),connections:pendulumCopy.connections},pendulumCopy.objects,{});
assert.equal(pWorld.connections.length,3);
const starts=pWorld.connections.map(c=>({a:pos(c.aEntity),length:dist(pos(c.aEntity),pos(c.bEntity))}));
for(let i=0;i<480;i++)pWorld.step();
for(const[i,c]of pWorld.connections.entries()){
 near(dist(pos(c.aEntity),starts[i].a),0,1e-7);
 near(dist(pos(c.aEntity),pos(c.bEntity)),starts[i].length,.012);
}
pWorld.dispose();
report.cases.push({name:'Маятник: 3 копии, закрепление и работающие шарниры',bodies:6,joints:3,physicsSeconds:4});report.checks+=17;

// Revolute axes are local to both bodies in Rapier. A common assembly rotation
// changes their world axes through each body's rotation; rewriting the string
// axis to a world direction would be wrong. Compare actual trajectories.
const straight=buildLayoutAssembly({...base,id:'straight',count:[1,1,1],origin:[0,0,0]},pendulum,hinge);
const quarterTurn=buildLayoutAssembly({...base,id:'quarter-turn',count:[1,1,1],origin:[0,0,0],rotation:[0,90,0]},pendulum,hinge);
const straightWorld=new LabWorld({...settingsFor('blank'),connections:straight.connections},straight.objects,{});
const turnedWorld=new LabWorld({...settingsFor('blank'),connections:quarterTurn.connections},quarterTurn.objects,{});
let maxRotatedError=0;
for(let i=0;i<480;i++){
 straightWorld.step();turnedWorld.step();
 const a=pos(straightWorld.find('straight-0-1')),b=pos(turnedWorld.find('quarter-turn-0-1'));
 maxRotatedError=Math.max(maxRotatedError,dist([a[2],a[1],-a[0]],b));
}
near(maxRotatedError,0,.003);
straightWorld.dispose();turnedWorld.dispose();
report.cases.push({name:'Шарнир после поворота сборки на 90°: совпадение реальных траекторий',maxPositionErrorMetres:maxRotatedError,physicsSeconds:4});report.checks++;

// A rigid pair copied with whole-assembly random transforms must retain its
// geometry. Every pair gets one scale factor and one orientation, not two.
const pair=[part('left',[-.75,0,0]),{...part('right',[.75,0,0]),asset:'brick',material:'ceramic',rotation:[0,0,.4]}];
const fixed=[{id:'rigid',type:'fixed',a:'left',b:'right',point:[0,0,0]}];
const varied={...base,id:'rigid-copy',origin:[-4,3,0],rotation:[15,30,10],turn:[0,30,0],jitter:.2,angleJitter:45,scaleJitter:.3};
const rigidCopy=buildLayoutAssembly(varied,pair,fixed);
assert.deepEqual(rigidCopy,buildLayoutAssembly(varied,pair,fixed),'same seed and template must rebuild the same graph');
for(let i=0;i<3;i++){
 const a=rigidCopy.objects[i*2],b=rigidCopy.objects[i*2+1],scale=a.scale/pair[0].scale;
 near(b.scale/pair[1].scale,scale);near(dist(a.position,b.position),1.5*scale);
 // The midpoint anchor must remain exactly between transformed centres.
 for(let axis=0;axis<3;axis++)near(rigidCopy.connections[i].point[axis],(a.position[axis]+b.position[axis])/2);
}
const rWorld=new LabWorld({...settingsFor('blank'),connections:rigidCopy.connections},rigidCopy.objects,{});
const rigidDistances=rWorld.connections.map(c=>dist(pos(c.aEntity),pos(c.bEntity)));
for(let i=0;i<480;i++)rWorld.step();
for(const[i,c]of rWorld.connections.entries())near(dist(pos(c.aEntity),pos(c.bEntity)),rigidDistances[i],.012);
const livePair=rWorld.connections[0],liveBodies=[livePair.aEntity,livePair.bEntity];
const currentCenter=pos(liveBodies[0]).map((v,i)=>(v+pos(liveBodies[1])[i])/2);
const posedSources=liveBodies.map(e=>({...e.spec,sourceId:e.id,offset:pos(e).map((v,i)=>v-currentCenter[i]),rotation:{...e.body.rotation()},scale:e.scale,mass:e.body.mass()}));
const posedConnections=snapshotAssemblyConnections(rWorld.connections,posedSources,currentCenter);
assert.equal(posedConnections.length,1);
const liveLocal=livePair.joint.anchor1(),liveAnchorRadius=Math.hypot(liveLocal.x,liveLocal.y,liveLocal.z);
const posedCopy=buildLayoutAssembly({...base,id:'paused-pose',count:[1,1,1],origin:[0,4,0]},posedSources,posedConnections);
near(dist(posedCopy.connections[0].point,posedCopy.objects[0].position),liveAnchorRadius,1e-6);
assert(!Object.hasOwn(posedConnections[0],'joint'));assert(!Object.hasOwn(posedConnections[0],'aEntity'));
rWorld.dispose();
report.cases.push({name:'Жёсткая пара: общий разброс/масштаб/поворот и сохранение расстояний',bodies:6,joints:3,physicsSeconds:4});report.checks+=20;
report.cases.push({name:'Снимок текущей позы: живой якорь после 4 с движения',bodies:2,joints:1});report.checks+=4;

// Independent mixed objects remain valid and do not acquire invented joints.
const loose=[part('a',[-1,0,0],true),{...part('b',[1,0,0]),asset:'banana',material:'wood'}];
const independent=buildLayoutAssembly({...base,id:'loose'},loose);
assert.equal(independent.objects.length,6);assert.equal(independent.connections.length,0);assert.equal(independent.objects.filter(o=>o.fixed).length,3);
for(const o of independent.objects)assert(!Object.hasOwn(o,'sourceId'));
for(const fixedMode of ['fixed','dynamic','preserve']){
 const result=buildLayoutAssembly({...base,fixedMode},loose);
 assert.equal(result.objects.filter(o=>o.fixed).length,fixedMode==='fixed'?6:fixedMode==='dynamic'?0:3);
 validateProject({version:1,settings:{...settingsFor('blank'),connections:result.connections},objects:result.objects,edits:{}});
}
assert.equal(buildLayout({...base,fixed:true},loose).filter(o=>o.fixed).length,6,'legacy explicit fixed override');
assert.equal(buildLayout({...base,fixed:false},loose).filter(o=>o.fixed).length,0,'legacy explicit dynamic override');
assert.equal(buildLayout({...base,fixed:false,fixedMode:'preserve'},loose).filter(o=>o.fixed).length,3,'new preserve mode wins over an obsolete boolean');
report.cases.push({name:'Независимые предметы: без выдуманных связей, три режима закрепления',bodies:6,joints:0});report.checks+=15;

// One analytically known transform verifies coordinate-space interpretation.
const rotated=buildLayoutAssembly({...base,id:'turned',count:[1,1,1],origin:[10,20,30],rotation:[0,90,0]},[part('a',[1,0,0]),part('b',[1,1,0])],[{id:'point',type:'ball',a:'a',b:'b',point:[1,.5,0]}]);
for(const[axis,expected]of [10,20.5,29].entries())near(rotated.connections[0].point[axis],expected);

// External relationships are explicit omissions. None may bind to an original.
const external=[...hinge,{id:'outside',a:'bob',b:'not-selected',type:'fixed'},{id:'world',a:'bob',b:'',type:'hinge',point:[0,2,0]}];
const omitted=buildLayoutAssembly(base,pendulum,external);
assert.equal(omitted.connections.length,3);assert.equal(omitted.warnings.length,2);
assert(omitted.warnings.some(w=>w.includes('outside')));assert(omitted.warnings.some(w=>w.includes('world')));
assert(omitted.connections.every(c=>c.a.startsWith(base.id)&&c.b.startsWith(base.id)));
const generator=JSON.parse(JSON.stringify({...varied,name:'Связанная сборка',sources:pair,sourceConnections:fixed}));
const rebuilt=buildLayoutAssembly(generator,generator.sources,generator.sourceConnections);
assert.deepEqual(rebuilt,rigidCopy,'saved generator roundtrip preserves graph and transformations');
const smaller=buildLayoutAssembly({...generator,count:[2,1,1]},generator.sources,generator.sourceConnections);
assert.equal(smaller.objects.length,4);assert.equal(smaller.connections.length,2);
assert.equal(new Set(smaller.objects.map(o=>o.id)).size,4);
const spring=buildLayoutAssembly({...base,count:[1,1,1],scaleJitter:.25},pair,[{id:'spring',type:'spring',a:'left',b:'right',length:1.5,stiffness:120,damping:8}]);
near(spring.connections[0].length,dist(spring.objects[0].position,spring.objects[1].position));
assert.throws(()=>buildLayoutAssembly({...base,count:[30,30,30],pattern:'grid'},pair,fixed),/150/);
assert.throws(()=>buildLayoutAssembly(base,[...pair,{...pair[0]}],fixed),/повторяется/);
report.checks+=17;

// Saved recipes enter through the same strict validator as scene imports.
const templateProject={version:1,settings:{...settingsFor('blank'),generators:[generator],connections:rigidCopy.connections},objects:rigidCopy.objects,edits:{}};
const templateJSON=JSON.stringify(templateProject),restored=JSON.parse(templateJSON);
assert.equal(validateProject(restored),restored);assert.equal(JSON.stringify(restored),templateJSON);
assert.deepEqual(buildLayoutAssembly(restored.settings.generators[0],restored.settings.generators[0].sources,restored.settings.generators[0].sourceConnections),rigidCopy);
const malformed=[
 g=>{g.sources=null;},g=>{delete g.step;},g=>{g.count=[0,1,1];},g=>{g.pattern='unknown';},
 g=>{g.fixedMode='sometimes';},g=>{g.sources[0].asset='missing';},
 g=>{g.sources[1].sourceId=g.sources[0].sourceId;},g=>{g.sourceConnections[0].point=[0,0];},
 g=>{g.sourceConnections[0].a=2;},g=>{g.id='x'.repeat(160);},
];
for(const corrupt of malformed){const p=structuredClone(restored);corrupt(p.settings.generators[0]);assert.throws(()=>validateProject(p),/Некорректный проект.*расстановка/);}
const oldFixed=structuredClone(restored);oldFixed.settings.generators[0].sources[0].fixed=true;oldFixed.settings.generators[0].sources[0].mass=0;
validateProject(oldFixed);
const externalSaved=structuredClone(restored);externalSaved.settings.generators[0].sourceConnections.push({id:'external',type:'hinge',a:'left',b:'outside'});
validateProject(externalSaved);
report.cases.push({name:'Импорт расстановки: malformed отклонён, roundtrip и старые fixed templates сохранены',malformedCases:malformed.length});report.checks+=malformed.length+5;

// A misspelled or deleted object is an error, never an implicit world anchor.
const body=[{id:'a',asset:'ball',scale:.5,mass:1,material:'metal',position:[0,3,0]}];
const live=new LabWorld(settingsFor('blank'),body,{}),bodyCount=live.entities.length;
assert.throws(()=>live.connect({id:'bad-b',a:'a',b:'deleted-b',type:'fixed'}),/второй предмет.*deleted-b.*не найден/);
assert.throws(()=>live.connect({id:'bad-a',a:'deleted-a',b:'a',type:'fixed'}),/первый предмет.*deleted-a.*не найден/);
assert.equal(live.entities.length,bodyCount);assert.equal(live.connections.length,0);live.dispose();
for(const b of [undefined,'','world']){
 const world=new LabWorld({...settingsFor('blank'),connections:[{id:'explicit-world',a:'a',b,type:'ball'}]},body,{});
 assert.equal(world.connections.length,1);assert.equal(world.connections[0].bEntity.id,'anchor-explicit-world');world.dispose();
}

// A failing constructor owns its allocated WASM resources, even before it can
// be returned to the caller. Verify real resource frees, not just an exception.
const worldFree=R.World.prototype.free,eventFree=R.EventQueue.prototype.free;
let freedWorlds=0,freedQueues=0;
try{
 R.World.prototype.free=function(...args){freedWorlds++;return worldFree.apply(this,args);};
 R.EventQueue.prototype.free=function(...args){freedQueues++;return eventFree.apply(this,args);};
 assert.throws(()=>new LabWorld({...settingsFor('blank'),connections:[{id:'invalid-import',a:'a',b:'missing',type:'fixed'}]},body,{}),/второй предмет.*missing.*не найден/);
}finally{R.World.prototype.free=worldFree;R.EventQueue.prototype.free=eventFree;}
assert.equal(freedWorlds,1);assert.equal(freedQueues,1);
const afterFailure=new LabWorld(settingsFor('blank'),body,{});afterFailure.step();afterFailure.dispose();afterFailure.dispose();
report.cases.push({name:'Отсутствующие endpoints: явная ошибка; мировая опора только явно; cleanup конструктора',freedWorlds,freedQueues});report.checks+=14;
report.scope='Graph/geometry and real Rapier CPU regressions; no browser UI or visual acceptance.';
console.log(JSON.stringify(report,null,2));
