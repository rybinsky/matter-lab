import assert from 'node:assert/strict';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
await initializePhysics();
const samples=[];
for(const damping of [0,8]){
 const p={version:1,settings:{...settingsFor('blank'),experiment:'blank',gravity:0,connections:[{id:'spring',name:'Пружина',a:'bob',b:'anchor',type:'spring',length:1,stiffness:60,damping}]},objects:[{id:'anchor',asset:'ball',mass:1,scale:.15,position:[0,3,0],fixed:true},{id:'bob',asset:'ball',mass:1,scale:.15,position:[2,3,0],linearDamping:0,angularDamping:0}],edits:{}};
 validateProject(JSON.parse(JSON.stringify(p)));
 const lab=new LabWorld(p.settings,p.objects,p.edits);let amplitude=0;
 try{for(let step=0;step<240;step++){lab.step();if(step>=180)amplitude=Math.max(amplitude,Math.abs(lab.find('bob').body.translation().x-1));}}
 finally{lab.dispose();}
 samples.push(amplitude);
}
assert(samples[0]>.5,`Zero-damping spring unexpectedly lost its oscillation: ${samples[0]}`);
assert(samples[1]<.1,`Damped spring did not settle: ${samples[1]}`);
assert(samples[0]>samples[1]*10,'An authored zero must reach Rapier, rather than falling back to damping8');
console.log(`Connections: zero damping retains ${samples[0].toFixed(3)}m oscillation; damping8 settles to ${samples[1].toFixed(4)}m.`);
