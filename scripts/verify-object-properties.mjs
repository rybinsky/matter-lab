import assert from 'node:assert/strict';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor,MATERIALS} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
import {assetParts} from '../src/catalog.js';
import {objectVisual} from '../src/visuals.js';
import {capture} from './capture.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
await initializePhysics();
const settings={...settingsFor('blank'),gravity:0};
const project={version:1,settings,objects:[{id:'ring',asset:'torus',position:[0,3,0],mass:2}],edits:{ring:{mass:4,scale:1.5,friction:.12,restitution:.73,velocity:[2,1,0],angularVelocity:[0,3,0],rotation:[0,.2,0]}}};
// Use a built-in torus shape so every compound-ring collider must honor contact overrides.
project.objects[0]={id:'ring',parts:[{shape:'torus',d:[.5,.1],p:[0,0,0],color:'#cc8844'}],position:[0,3,0],mass:2};
validateProject(project);
const restored=JSON.parse(JSON.stringify(project)),lab=new LabWorld(restored.settings,restored.objects,restored.edits),e=lab.find('ring');
assert.equal(e.scale,1.5);assert(Math.abs(e.body.mass()-4)<1e-5);assert.equal(e.colliders.length,16);
for(const c of e.colliders){assert(Math.abs(c.friction()-.12)<1e-5);assert(Math.abs(c.restitution()-.73)<1e-5);}
assert.equal(e.body.linvel().x,2);assert.equal(e.body.angvel().y,3);
const before=e.body.translation();lab.step();assert(e.body.translation().x>before.x,'Initial velocity moves the body');
lab.setMaterial('ring','ice');assert.equal(e.parts[0].color,'#cc8844','Physical material retains authored colors');assert(Math.abs(e.colliders[0].friction()-.12)<1e-5,'Explicit contact survives material changes');
lab.dispose();
const thermal=new LabWorld(settingsFor('thermal'),[],{'hot-ball':{mass:8}});
assert.equal(thermal.thermal.mass,8);assert(Math.abs(thermal.thermal.r-Math.cbrt(24/(4*Math.PI*7850)))<1e-9);thermal.dispose();
assert.throws(()=>validateProject({...project,edits:{ring:{angularVelocity:[0,NaN,0]}}}));
const visualBase={id:'visual-isolation',asset:'cube',position:[0,3,0],velocity:[1,0,0],mass:2};
const plain=new LabWorld(settings,[visualBase]),detailed=new LabWorld(settings,[{...visualBase,visualParts:[{shape:'sphere',d:[1],p:[0,0,0],color:'#335577',roughness:.4,metalness:.8}]}]);
assert.equal(detailed.find(visualBase.id).colliders.length,plain.find(visualBase.id).colliders.length);
assert.equal(detailed.find(visualBase.id).visualParts[0].shape,'sphere');
for(let step=0;step<30;step++){plain.step();detailed.step();assert.deepEqual(plain.find(visualBase.id).body.translation(),detailed.find(visualBase.id).body.translation());}
plain.dispose();detailed.dispose();
// Damping is authorable dissipation, not a force or an altered collision.
const dampedProject={version:1,settings,objects:[
 {id:'free',asset:'ball',position:[-20,3,0],velocity:[3,0,0],angularVelocity:[0,4,0],linearDamping:2,angularDamping:2},
 {id:'damped',asset:'ball',position:[20,3,0],velocity:[3,0,0],angularVelocity:[0,4,0],linearDamping:4,angularDamping:4},
 {id:'default',asset:'ball',position:[0,10,0]},
],edits:{free:{linearDamping:0,angularDamping:0}}};
validateProject(dampedProject);
const dampingLab=new LabWorld(settings,JSON.parse(JSON.stringify(dampedProject.objects)),JSON.parse(JSON.stringify(dampedProject.edits)));
assert(Math.abs(dampingLab.find('default').body.linearDamping()-.055)<1e-7);
assert(Math.abs(dampingLab.find('default').body.angularDamping()-.12)<1e-7);
assert.equal(dampingLab.find('free').body.linearDamping(),0);assert.equal(dampingLab.find('free').body.angularDamping(),0);
for(let i=0;i<360;i++)dampingLab.step();
assert(Math.abs(dampingLab.find('free').body.linvel().x-3)<1e-5,'Zero linear damping conserves unforced translation');
assert(Math.abs(dampingLab.find('free').body.angvel().y-4)<.01,'Zero angular damping conserves spherical free spin within solver precision');
assert(dampingLab.find('damped').body.linvel().x<.001,'Positive linear damping actually dissipates velocity');
assert(dampingLab.find('damped').body.angvel().y<.001,'Positive angular damping actually dissipates spin');
dampingLab.setDamping('damped',{linearDamping:0});
assert.equal(dampingLab.find('damped').body.linearDamping(),0);assert.equal(dampingLab.find('damped').body.angularDamping(),4);
assert.equal(dampingLab.find('damped').spec.linearDamping,0);
assert.throws(()=>dampingLab.setDamping('damped',{linearDamping:1,angularDamping:-1}),/Затухание/);
assert.equal(dampingLab.find('damped').body.linearDamping(),0,'Invalid paired update must not partially change the body');
dampingLab.dispose();
for(const key of ['linearDamping','angularDamping'])for(const value of [-1,101,NaN,Infinity,'0'])assert.throws(()=>validateProject({...project,edits:{ring:{[key]:value}}}),/Некорректный проект/);
// Appearance never mutates the physical compound or authored per-part colours.
const multicolor={id:'painted',asset:'custom',position:[0,3,0],mass:3,friction:.4,restitution:.2,angularVelocity:[0,1,.2],parts:[
 {shape:'box',d:[.7,.5,.4],p:[-.3,0,0],color:'#cc5544'},
 {shape:'sphere',d:[.25],p:[.4,0,0],color:'#44aa88'},
]};
const appearance={color:'#2468ff',roughness:0,metalness:0};
const mechanics=new LabWorld(settingsFor('blank'),[structuredClone(multicolor)]);
const art=new LabWorld(settingsFor('blank'),[structuredClone(multicolor)],{painted:{appearance}});
const original=mechanics.find('painted'),painted=art.find('painted');
assert.deepEqual(painted.parts,multicolor.parts);assert.deepEqual(painted.appearance,appearance);
assert.deepEqual(painted.body.principalInertia(),original.body.principalInertia());assert.equal(painted.body.mass(),original.body.mass());
for(const[i,c]of painted.colliders.entries()){assert.equal(c.mass(),original.colliders[i].mass());assert.equal(c.friction(),original.colliders[i].friction());assert.equal(c.restitution(),original.colliders[i].restitution());}
for(let i=0;i<240;i++){
 if(i===60)art.setAppearance('painted',{color:'#ff3d70',roughness:.8,metalness:.9});
 mechanics.step();art.step();assert.deepEqual(painted.body.translation(),original.body.translation());assert.deepEqual(painted.body.rotation(),original.body.rotation());
}
art.setAppearance('painted',appearance);art.setMaterial('painted','ice');
assert.deepEqual(painted.appearance,appearance);assert.deepEqual(painted.parts,multicolor.parts,'Changing physical material preserves the authored part palette');
const styled=objectVisual(painted.parts,painted.material,painted.color,painted.asset,painted.appearance);
for(const mesh of styled.children){assert.equal(mesh.material.color.getHexString(),'2468ff');assert.equal(mesh.material.roughness,0);assert.equal(mesh.material.metalness,0);}
const persisted=JSON.parse(JSON.stringify(painted.spec)),copy=art.addRigid({...persisted,id:'duplicate',position:[4,3,0]});
assert.deepEqual(copy.appearance,appearance);art.setAppearance('duplicate',{roughness:.9});assert.deepEqual(painted.appearance,appearance);
const scalarOnly=objectVisual(copy.parts,copy.material,copy.color,copy.asset,copy.appearance);
assert.deepEqual(scalarOnly.children.map(m=>m.material.color.getHexString()),['cc5544','44aa88']);
art.setAppearance('painted',null);
const reset=objectVisual(painted.parts,painted.material,painted.color,painted.asset,painted.appearance);
assert.deepEqual(reset.children.map(m=>m.material.color.getHexString()),['cc5544','44aa88']);
assert.deepEqual(painted.parts,multicolor.parts);assert.equal(painted.appearance,null);
const restoredArt=new LabWorld(settingsFor('blank'),[persisted]);assert.deepEqual(restoredArt.find('painted').appearance,appearance);restoredArt.dispose();
const clearedArt=new LabWorld(settingsFor('blank'),[persisted],{painted:{appearance:null}});assert.equal(clearedArt.find('painted').appearance,null);assert.deepEqual(clearedArt.find('painted').parts,multicolor.parts);clearedArt.dispose();
const banana=objectVisual(assetParts('banana'),'wood',undefined,'banana',appearance);
for(const mesh of banana.children){assert.equal(mesh.material.color.getHexString(),'2468ff');assert.equal(mesh.material.roughness,0);assert.equal(mesh.material.metalness,0);}
mechanics.dispose();art.dispose();
for(const bad of [{color:'blue'},{color:'#fff'},{roughness:-.1},{metalness:1.1},{metalness:NaN},{unknown:true},[]])assert.throws(()=>validateProject({...project,edits:{ring:{appearance:bad}}}));
validateProject({...project,edits:{ring:{appearance:null}}});
// Capture sends the same override for ordinary parts, continuous skins and soft meshes.
const exportProject={version:1,settings:{...settingsFor('blank'),gravity:0,story:{enabled:false,duration:.2},cameraRig:{mode:'keys',points:[{time:0,sourceTime:0,position:[5,4,7],target:[0,2,0],fov:40},{time:.2,sourceTime:.1,position:[5,4,7],target:[0,2,0],fov:40}]}},objects:[
 {...multicolor,appearance},
 {id:'skin',asset:'banana',position:[3,3,0],appearance},
 {id:'soft-look',asset:'softcube',material:'jelly',scale:.3,position:[-3,3,0],appearance},
],edits:{},preview:true,previewFps:24,series:false};
validateProject(exportProject);
const exportTemporary=await mkdtemp(path.join(tmpdir(),'matter-appearance-'));
try{
 const recorded=await capture(exportProject,path.join(exportTemporary,'capture.json'));
 const entities=recorded.takes[0].entities;
 assert.deepEqual(entities.find(e=>e.id==='painted').appearance,appearance);assert.deepEqual(entities.find(e=>e.id==='painted').parts,multicolor.parts);
 assert.deepEqual(entities.find(e=>e.id==='skin').appearance,appearance);assert.equal(entities.find(e=>e.id==='skin').surface,'banana');
 const soft=recorded.takes[0].meshes.find(e=>e.id==='soft-look');assert.equal(soft.color,appearance.color);assert.equal(soft.appearance.roughness,0);assert.equal(soft.appearance.metalness,0);
}finally{await rm(exportTemporary,{recursive:true,force:true});}
console.log('Object properties: compound mechanics, damping, appearance isolation/decay/bounds/reset/persistence/duplicate, continuous skins and soft/native capture metadata passed.');
