import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {axisymmetricSurfaceMesh,normalizeSurfaceMotionScene} from '../src/surface-motion-scene.js';

await initializePhysics();
const close=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`),arr=v=>[v.x,v.y,v.z];
const config=targetSpeed=>({body:'proxy',mass:999,gravity:123,origin:[0,0,0],surface:{kind:'cone',slope:2/3,minRadius:.05,rimRadius:4.2},initial:{radius:1.1,azimuth:0,upslopeSpeed:0,azimuthSpeed:Math.sqrt(9.81*(2/3)*1.1)},drive:{enabled:true,targetSpeed,response:.25,lateralDamping:1/.65,friction:.65,maxForce:280,maxPower:1400},render:{color:'#F0E5D1',apronWidth:3,segments:64,radialSegments:12}});
const actor={id:'proxy',asset:'custom',name:'Точечный привод',parts:[{shape:'sphere',d:[.1],p:[0,0,0]}],position:[0,2,0],mass:70,material:'metal',linearDamping:0,angularDamping:0,restitution:0};
function create(target=3,{objects=[structuredClone(actor)],edits={},settings={}}={}){return new LabWorld({...settingsFor('blank'),gravity:9.81,windSpeed:0,autoLaunch:false,atmosphere:{enabled:false},surfaceMotion:config(target),...settings},objects,edits);}
function check(label,fn){fn();console.log(`PASS ${label}`);}

check('Render settings validate and one static mesh really includes the flat exit apron',()=>{
  const cfg=config(3),mesh=axisymmetricSurfaceMesh(cfg);assert.equal(mesh.color,cfg.render.color);close(Math.max(...mesh.positions.filter((_,i)=>i%3===0)),7.2,1e-8);assert.equal(mesh.positions.length%3,0);assert.equal(mesh.indices.length%3,0);
  let apronFaces=0;for(let i=0;i<mesh.indices.length;i+=3){const p=mesh.indices.slice(i,i+3).map(n=>mesh.positions.slice(n*3,n*3+3));if(p.every(v=>Math.abs(v[1]-2.8)<1e-9)&&p.some(v=>Math.hypot(v[0],v[2])>4.21))apronFaces++;}assert.ok(apronFaces>=128);
  assert.throws(()=>normalizeSurfaceMotionScene({...cfg,render:{segments:7}}));assert.throws(()=>normalizeSurfaceMotionScene({...cfg,render:{apronWidth:-1}}));assert.throws(()=>normalizeSurfaceMotionScene({...cfg,render:{color:'red'}}));
});
check('Body mass and world gravity override stale authored model values',()=>{
  const lab=create(3,{edits:{proxy:{mass:25}},settings:{gravity:1.62}});try{const s=lab.surfaceMotion;close(s.config.mass,25,1e-5);close(s.config.gravity,1.62,1e-6);assert.equal(s.entity.body.bodyType(),RAPIER.RigidBodyType.KinematicPositionBased);assert.ok(s.entity.colliders.every(c=>!c.isEnabled()));assert.ok(s.surfaceEntity.renderSurface.positions.length>0);assert.equal(s.surfaceEntity.colliders.length,1);}finally{lab.dispose();}
});
check('Constrained mapping keeps the body envelope offset and measured pose in sync',()=>{
  const lab=create(4.4);try{for(let i=0;i<240;i++)lab.step(1/120);const scene=lab.surfaceMotion,s=scene.snapshot(),p=arr(scene.entity.body.translation());assert.equal(s.phase,'contact');close(p[0],scene.model.position()[0]);close(p[1],scene.model.position()[1]+.1);close(p[2],scene.model.position()[2]);close(p[1]-.1,s.height);assert.equal(lab.stats().surfaceMotion.phase,'contact');}finally{lab.dispose();}
});
check('Target must be an unconnected, ordinary, free rigid body in the declared domain',()=>{
  assert.throws(()=>create(3,{objects:[{...actor,fixed:true}]}),/free ordinary/);
  assert.throws(()=>create(3,{objects:[{...actor,kinematic:true}]}),/free ordinary/);
  assert.throws(()=>create(3,{objects:[]}),/free ordinary/);
  assert.throws(()=>create(3,{settings:{windSpeed:1}}),/disable wind/);
  assert.throws(()=>create(3,{settings:{atmosphere:{enabled:true}}}),/disable wind/);
  assert.throws(()=>create(3,{objects:[{...actor,angularVelocity:[0,1,0]}]}),/angular velocity/);
  assert.throws(()=>create(3,{settings:{connections:[{id:'bad',type:'rope',a:'proxy',b:'world',point:[0,3,0],length:2}]}}),/joints/);
});
check('Runtime mass, gravity or body-mode changes require an explicit scene rebuild',()=>{
  const mass=create();try{mass.setMass('proxy',30);assert.throws(()=>mass.step(1/120),/mass or gravity changed/);}finally{mass.dispose();}
  const gravity=create();try{gravity.world.gravity={x:0,y:-1.62,z:0};assert.throws(()=>gravity.step(1/120),/mass or gravity changed/);}finally{gravity.dispose();}
  const mode=create();try{mode.find('proxy').body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);assert.throws(()=>mode.step(1/120),/body mode changed/);}finally{mode.dispose();}
});
const regimes=[];
check('Three complete LabWorld cases reproduce distinct outcomes at 120 and 240 Hz',()=>{
  for(const target of[3,4.4,6.6])for(const hz of[120,240]){const lab=create(target);try{for(let i=0;i<Math.round(10*hz)&&!lab.surfaceMotion.released;i++)lab.step(1/hz);const scene=lab.surfaceMotion,s=scene.snapshot();if(target<6){assert.equal(s.phase,'contact');close(s.radius,target**2/(9.81*(2/3)),.0003);}else{assert.equal(s.phase,'dynamic');assert.equal(scene.entity.body.bodyType(),RAPIER.RigidBodyType.Dynamic);assert.ok(scene.entity.colliders.every(c=>c.isEnabled()));close(scene.entity.body.mass(),70,1e-5);assert.ok(s.release);assert.equal(s.energyResidual,null);}
    regimes.push({target,hz,phase:s.phase,radius:s.radius,height:s.height,release:s.release});
  }finally{lab.dispose();}}
});
check('Handoff uses the completed model step and does not apply gravity twice',()=>{
  const lab=create(6.6);try{while(!lab.surfaceMotion.released)lab.step(1/120);const scene=lab.surfaceMotion,model=scene.model.snapshot(),body=scene.entity.body;for(let i=0;i<3;i++){close(arr(body.translation())[i],model.position[i]+scene.poseOffset[i]);close(arr(body.linvel())[i],model.velocity[i]);}const q={...body.rotation()},before=arr(body.linvel());lab.step(1/120);const after=arr(body.linvel());close(after[1]-before[1],-9.81/120,1e-5);close(after[0],before[0]);close(after[2],before[2]);for(const key of['x','y','z','w'])close(body.rotation()[key],q[key]);assert.equal(scene.model.snapshot().time,model.time);
  }finally{lab.dispose();}
});
check('The fixed apron catches a real free dynamic body at the rendered rim height',()=>{
  const drop={...actor,id:'drop',position:[5.2,4,0]},lab=create(3,{objects:[structuredClone(actor),drop]});try{for(let i=0;i<360;i++)lab.step(1/120);const p=lab.find('drop').body.translation();close(p.y-.1,2.8,.015);close(p.x,5.2,.03);assert.equal(lab.find('drop').body.bodyType(),RAPIER.RigidBodyType.Dynamic);}finally{lab.dispose();}
});
check('The automatic motion-rig pipe animates helpers and leaves physical trajectories and counts unchanged',()=>{
  const physical={...actor,parts:[{shape:'box',d:[.34,1.71,.24],p:[0,.855,0]}]},withRig={...physical,visualRig:{type:'runner',height:1.71,orientation:'alongVelocity'}};
  const plain=create(6.6,{objects:[physical]}),visual=create(6.6,{objects:[withRig]});try{
    assert.equal(visual.motionRigs.length,1);const rig=visual.motionRigs[0];assert.equal(rig.helpers.length,11);assert.ok(rig.helpers.every(e=>e.internal&&e.renderOnly&&!e.colliders.length));assert.ok(rig.entity.renderHidden);assert.equal(visual.stats().objects,plain.stats().objects);assert.ok(rig.helpers.every(e=>!visual.measurementOrigins.has(e.id)));
    for(let i=0;i<360;i++){plain.step(1/120);visual.step(1/120);const a=plain.find('proxy').body,b=visual.find('proxy').body;for(const method of['translation','linvel','angvel'])for(const key of['x','y','z'])close(a[method]()[key],b[method]()[key],0);for(const key of['x','y','z','w'])close(a.rotation()[key],b.rotation()[key],0);}
    assert.ok(rig.snapshot().distance>1);assert.equal(rig.snapshot().phase,'dynamic');assert.equal(visual.surfaceMotion.released,true);assert.equal(visual.stats().objects,plain.stats().objects);
  }finally{plain.dispose();visual.dispose();}
});
console.log(JSON.stringify({regimes,assertions:'All nine adapter checks passed.'},null,2));
