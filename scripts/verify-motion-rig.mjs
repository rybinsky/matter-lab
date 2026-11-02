import assert from 'node:assert/strict';
import * as THREE from 'three';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {DEFAULT_SETTINGS} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
import {createMotionRig,createRunnerActor,MOTION_RIG_PREFIX} from '../src/motion-rig.js';
await initializePhysics();
const actor=createRunnerActor('runner',{position:[0,3,0],velocity:[1,0,.3],angularVelocity:[.2,.1,.3],linearDamping:0,angularDamping:0});
validateProject({version:1,name:'Runner rig',settings:{...DEFAULT_SETTINGS,experiment:'blank',connections:[],emitters:[]},objects:[actor],edits:{}});
assert.equal(actor.mass,70);assert.equal(actor.parts[0].p[1],.875);assert.equal(actor.visualRig.height,1.75);
assert.equal(createRunnerActor('other',{height:1.8,visualRig:{height:3}}).visualRig.height,1.8,'Factory physical and visual heights remain consistent');
const plain=structuredClone(actor);delete plain.visualRig;
const settings={...DEFAULT_SETTINGS,experiment:'blank',connections:[],emitters:[],gravity:9.81,windSpeed:0};
const baseline=new LabWorld(settings,[plain],{}),styled=new LabWorld(settings,[plain],{}),root=styled.find('runner'),rig=createMotionRig(styled,root,actor.visualRig),beforeCount=2;
assert.equal(rig.helpers.length,11);assert.equal(styled.entities.length,beforeCount+11);assert.equal(root.renderHidden,true);
assert(rig.helpers.every(e=>e.internal&&e.renderOnly&&e.editable===false&&e.selectable===false&&e.id.startsWith(MOTION_RIG_PREFIX)&&e.body.numColliders()===0&&e.body.mass()===0&&e.kinematic));
assert.equal(root.body.mass(),70);assert.equal(root.colliders.length,1);
assert.throws(()=>createMotionRig(styled,root,actor.visualRig),/уже создана/);assert.equal(styled.entities.length,beforeCount+11);
let maximumPhysicalDifference=0;
function bodyState(body){const p=body.translation(),q=body.rotation(),v=body.linvel(),w=body.angvel();return[p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,w.x,w.y,w.z,body.mass()];}
for(let step=0;step<240;step++){
 baseline.step();styled.step();const p=root.body.translation(),v=root.body.linvel();rig.update(1/120,{phase:'dynamic',bodyPosition:[p.x,p.y,p.z],bodyVelocity:[v.x,v.y,v.z]});
 const a=bodyState(baseline.find('runner').body),b=bodyState(root.body);maximumPhysicalDifference=Math.max(maximumPhysicalDifference,...a.map((x,i)=>Math.abs(x-b[i])));
}
assert.equal(maximumPhysicalDifference,0,'Render helpers cannot alter falling/ground-contact physical dynamics');
const rootState=bodyState(root.body);
rig.update(0,{phase:'contact',bodyPosition:[4,1,3],bodyVelocity:[0,0,-3],normal:[0,1,0],position:[4,1,3]});
assert.deepEqual(bodyState(root.body),rootState,'Snapshot presentation never writes the actual root body pose or velocity');
const core=rig.helpers.find(e=>e.id.endsWith('torso-head')),facing=new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion(...Object.values(core.body.rotation())));assert(facing.z<-.98,'Initial dt0 contact heading faces the supplied negative-Z velocity immediately');
rig.update(.1,{phase:'contact',bodyPosition:[4.2,1,3],bodyVelocity:[2,0,0],normal:[-.5,.866,0],position:[4.2,1,3]});
assert(Math.abs(rig.snapshot().distance-.2)<1e-9);assert(rig.snapshot().gaitPhase>0);assert(rig.helpers.every(e=>{const p=e.body.translation(),q=e.body.rotation();return[p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite);}));
rig.update(0,{phase:'contact',bodyPosition:[0,3,0],bodyVelocity:[0,0,0],normal:[0,1,0],position:[0,3,0]});
const contactBody=root.body.rotation(),contactCore=core.body.rotation(),offset=new THREE.Quaternion(contactBody.x,contactBody.y,contactBody.z,contactBody.w).invert().multiply(new THREE.Quaternion(contactCore.x,contactCore.y,contactCore.z,contactCore.w)),fallQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
root.body.setRotation({x:fallQ.x,y:fallQ.y,z:fallQ.z,w:fallQ.w},false);const actual=root.body.rotation();rig.update(0,{phase:'dynamic',bodyPosition:[0,3,0],bodyVelocity:[0,-2,0]});
const rendered=core.body.rotation(),expected=new THREE.Quaternion(actual.x,actual.y,actual.z,actual.w).multiply(offset);assert(expected.angleTo(new THREE.Quaternion(rendered.x,rendered.y,rendered.z,rendered.w))<.001,'After release the visual body follows actual body quaternion, not an upright presentation pose');
const fallen=core.body.translation();assert(Math.abs(fallen.y-(3+.875))>.2,'Falling figure does not remain standing above the root');
rig.dispose();rig.dispose();assert.equal(styled.entities.length,beforeCount);assert.equal(root.renderHidden,undefined);assert.equal(root.visualParts,undefined);assert.equal(root.colliders.length,1);
baseline.dispose();styled.dispose();
console.log('Motion rig passed: 11 internal zero-collider helpers; physical root delta0 for240steps including ground contacts; feet-origin factory; dt0 initial heading; distance gait; sloped visual stance; real release quaternion; idempotent cleanup.');
