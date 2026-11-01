import assert from 'node:assert/strict';
import {buildLayout,buildLayoutAssembly,rotate,quat} from '../src/layouts.js';
import {connectionAnchors} from '../src/connection-visuals.js';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
await initializePhysics();
const rho=1.2,g=9.81,r=.25,volume=4/3*Math.PI*r**3,mass=rho*volume*.7,area=Math.PI*r*r,center=[.08,0,.04],near=(a,b,tol,label)=>assert(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b}`),distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const config={id:'float-copies',pattern:'line',count:[3,1,1],step:[8,0,0],origin:[-8,4,0],rotation:[0,37,0],turn:[0,25,0],extent:[6,4,6],radius:3,turns:2,jitter:0,angleJitter:15,scaleJitter:.4,seed:47,align:true,fixedMode:'preserve'};
const balloon={sourceId:'balloon',asset:'custom',name:'Known closed sphere',parts:[{shape:'sphere',d:[r],p:center}],material:'rubber',scale:1,mass,offset:[0,2,0],rotation:[0,.2,0],linearDamping:0,angularDamping:0,buoyancy:{volume,center,dragCoefficient:0,referenceArea:area},appearance:{color:'#26B6AA',roughness:.3,metalness:0}};
// Give both bodies the same source yaw so the nonzero local X/Z anchors
// resolve to a vertical real rope before any whole-assembly rotation.
const localXZ=rotate(center,quat(balloon.rotation)),anchor={sourceId:'anchor',asset:'ball',scale:.1,mass:1,offset:[localXZ[0],0,localXZ[2]],rotation:balloon.rotation,fixed:true},rope={id:'tether',type:'rope',a:'balloon',b:'anchor',anchorA:[center[0],-r,center[2]],anchorB:[0,.05,0],length:1.7,visual:{enabled:true,color:'#D6C5A5',radius:.002}};
const sourceBefore=structuredClone({config,balloon,anchor,rope}),report={scales:[],freeFloats:[],tethers:[]};
for(const assembly of [false,true]){
 const result=assembly?buildLayoutAssembly(config,[balloon]):{objects:buildLayout(config,[balloon])};
 for(const object of result.objects){const s=object.scale/balloon.scale;near(object.mass/object.buoyancy.volume,mass/volume,1e-12,'Actual density survives copy scale');near(object.buoyancy.volume,4/3*Math.PI*(r*s)**3,1e-12,'Displaced volume agrees with scaled visible sphere');near(object.buoyancy.referenceArea,Math.PI*(r*s)**2,1e-12,'Reference area agrees with scaled sphere');object.buoyancy.center.forEach((v,i)=>near(v,center[i]*s,1e-12,'Local displacement center scales as length'));assert.deepEqual(object.appearance,balloon.appearance);near(object.buoyancy.dragCoefficient,balloon.buoyancy.dragCoefficient,0,'Cd is not scaled');report.scales.push({builder:assembly?'assembly':'independent',scale:s,massDensity:object.mass/object.buoyancy.volume});}
}
// Free-flight acceleration is independent of size when density is preserved.
// Drag is deliberately disabled for this similarity assertion.
{
 const copied=buildLayoutAssembly({...config,id:'free',origin:[-8,20,0],angleJitter:0},[balloon]),lab=new LabWorld({...settingsFor('blank'),atmosphere:{density:rho,wind:[0,0,0]}},copied.objects),expected=(1/.7-1)*g;
 try{for(let n=0;n<120;n++)lab.step();for(const e of lab.entities.filter(e=>e.id!=='ground')){near(e.body.linvel().y,expected,3e-5,'Scaled body has the same Archimedes/weight acceleration');const actualRatio=lab.atmosphere.buoyantForces.get(e.id)[1]/(e.body.mass()*g);near(actualRatio,1/.7,2e-7,'Force-to-weight ratio is size invariant');report.freeFloats.push({id:e.id,scale:e.scale,vy:e.body.linvel().y,forceWeightRatio:actualRatio});}}finally{lab.dispose();}
}
// Area matters dynamically: under quadratic drag each geometric scale has
// a different analytic terminal speed. Derive its expected forces from the
// physical sphere radius/mass, independently of saved buoyancy values.
{
 const source=structuredClone(balloon);source.buoyancy.dragCoefficient=.47;const copied=buildLayoutAssembly({...config,id:'drag',origin:[-8,20,0]},[source]),lab=new LabWorld({...settingsFor('blank'),atmosphere:{density:rho,wind:[0,0,0]}},copied.objects);
 try{for(let n=0;n<240;n++)lab.step();for(const e of lab.entities.filter(e=>e.id!=='ground')){const radius=r*e.scale,realV=4/3*Math.PI*radius**3,realA=Math.PI*radius**2,m=e.body.mass(),acceleration=(rho*realV/m-1)*g,b=.5*rho*.47*realA/m,terminal=Math.sqrt(acceleration/b),expected=terminal*Math.tanh(Math.sqrt(acceleration*b)*2);near(e.body.linvel().y,expected,.003,'Actual copied float matches geometry-derived drag/terminal-speed solution');}}finally{lab.dispose();}
}
// The copied rope must start at its ACTUAL scaled local endpoints and remain
// taut under lift. With no contacts/drag/damping, Newton's momentum balance
// independently infers the tensile impulse. There is no assumed Rapier getter.
{
 const copied=buildLayoutAssembly({...config,id:'tethered',angleJitter:0},[balloon,anchor],[rope]),project={version:1,settings:{...settingsFor('blank'),atmosphere:{density:rho,wind:[0,0,0]},connections:copied.connections},objects:copied.objects,edits:{}};validateProject(project);const lab=new LabWorld(project.settings,project.objects),totals=new Map();
 try{
  for(const c of lab.connections){const s=c.aEntity.scale,[a,b]=connectionAnchors(c);near(distance(a,b),rope.length*s,2e-6,'Physical rope endpoints and maximum length scale together');for(const[end,input]of [[c.localA,rope.anchorA],[c.localB,rope.anchorB]])end.forEach((v,i)=>near(v,input[i]*s,1e-12,'Stored rope local anchor scales'));totals.set(c.id,{impulse:0,time:0,maxStretch:0});}
  for(let n=0;n<480;n++){
   const previous=new Map(lab.connections.map(c=>[c.id,c.aEntity.body.linvel().y]));lab.step();
   for(const c of lab.connections){const e=c.aEntity,body=e.body,s=e.scale,[a,b]=connectionAnchors(c),total=totals.get(c.id),realV=4/3*Math.PI*(r*s)**3,external=(rho*realV-body.mass())*g,dt=1/120;total.maxStretch=Math.max(total.maxStretch,distance(a,b)-rope.length*s);if(n>=240){total.impulse+=body.mass()*(body.linvel().y-previous.get(c.id))-external*dt;total.time+=dt;}assert(distance(a,b)<=rope.length*s+.003*s,'Actual copied rope cannot silently detach');}
  }
  for(const c of lab.connections){const e=c.aEntity,m=e.body.mass(),realV=4/3*Math.PI*(r*e.scale)**3,expected=(rho*realV-m)*g,t=totals.get(c.id),inferred=-t.impulse/t.time;near(inferred/expected,1,.0005,'Inferred actual tether tension matches independent external-force balance');near(inferred/(m*g),1/.7-1,.0005,'Tension-to-weight ratio is preserved across scales');report.tethers.push({scale:e.scale,expectedTensionN:expected,inferredTensionN:inferred,tensionWeightRatio:inferred/(m*g),maxStretch:t.maxStretch});}
 }finally{lab.dispose();}
}
assert.deepEqual({config,balloon,anchor,rope},sourceBefore,'Building and simulating copies never mutates template data');
console.log(JSON.stringify({passed:true,...report,scope:'Real CPU rigid/rope/Archimedes/drag checks. Tension inferred by momentum balance for an isolated no-contact tether; not a fabricated joint-stress getter. No DOM/native acceptance.'},null,2));
