import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildTrack,trackParametersFromSpec,compileTrackDraft} from '../src/track-builder.js';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {modelReadouts} from '../src/measurement-readouts.js';
import {validateProject} from '../src/validation.js';
const base={profile:'rails',width:.3,endWidth:1.4,points:[[0,1],[4/3,1+.1/3],[8/3,1+.2/3],[4,1.1]],segments:32,thickness:.035,friction:.7};
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
for(const endWidth of[.08,.3,1.4,3])for(const reverse of[false,true]){
 const p={...base,endWidth,points:base.points.map(([x,y])=>[reverse?-x:x,y])},b=buildTrack(p);ok(b.parts.length===64,'Two real rails per segment without an invisible floor');
 for(const [i,part]of b.parts.entries()){
  ok(Array.isArray(part.r)&&part.r.length===3&&part.r.every(Number.isFinite),'Euler XYZ shared by Rapier/browser/native');
  const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.r)),direction=new THREE.Vector3(1,0,0).applyQuaternion(rotation),side=i%2?1:-1,expected=new THREE.Vector3((reverse?-1:1)*4/32,.1/32,side*(endWidth-.3)/64).normalize();ok(direction.distanceTo(expected)<1e-10,'Rendered and collider rails follow the same 3D edge');
 }
 const reopened=trackParametersFromSpec({...b,scale:2,position:[1,2,3]});ok(reopened.endWidth===2*endWidth&&reopened.width===.6,'Varying separation survives scaling');
}
assert.throws(()=>buildTrack({...base,profile:'unknown'}));assert.throws(()=>buildTrack({...base,endWidth:0}));checks+=2;
const project={version:1,name:'Rails',settings:settingsFor('blank'),objects:[],edits:{}},copy=structuredClone(project),added=compileTrackDraft(project,base);assert.deepEqual(project,copy);validateProject(added);checks+=2;
await initializePhysics();const results=[];
for(const hz of[120,240])for(const endWidth of[.3,1.4]){
 const x=.4,gap=.3+(endWidth-.3)*x/4,R=.58,H=.9,y=1+.1*x/4+R*(1-gap/(2*H))+.006;
 const rails=buildTrack({...base,endWidth},{id:'rails'}),cone={id:'roller',asset:'custom',mass:3,friction:.7,restitution:0,linearDamping:0,angularDamping:0,position:[x,y,0],parts:[{shape:'cone',d:[R,H],p:[0,0,H/2],r:[Math.PI/2,0,0]},{shape:'cone',d:[R,H],p:[0,0,-H/2],r:[-Math.PI/2,0,0]}]},settings={...settingsFor('blank'),gravity:9.81,autoLaunch:false,focusId:'roller'},w=new LabWorld(settings,[rails,cone]),body=w.find('roller').body,initial=body.worldCom();let earlyMax=initial.y;
 try{for(let i=0;i<2*hz;i++){w.step(1/hz);if(i<hz/4)earlyMax=Math.max(earlyMax,body.worldCom().y);}const end=body.worldCom(),r=modelReadouts(w);ok(earlyMax<=initial.y+.0001,'No initial depenetration kick');ok(end.y<initial.y,'Center of mass loses height under gravity');ok(endWidth===.3?end.x<x-.08:end.x>x+.35,'Widening changes direction on the same positive incline');ok(Math.abs(r.centerOfMassHeight-end.y)<1e-12&&Math.abs(r.centerOfMassX-end.x)<1e-12,'Measurements use solver world COM');results.push({hz,endWidth,x:end.x,y:end.y,earlyMax});}
 finally{w.dispose();}
}
console.log(JSON.stringify({checks,results,scope:'Geometry/contact authoring and actual COM; no prescribed motion.'}));
