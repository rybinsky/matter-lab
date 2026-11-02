import assert from 'node:assert/strict';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {createRunnerActor} from '../src/motion-rig.js';
import {surfaceMotionForm,compileSurfaceMotion,surfaceMotionObjects,circularBalanceSpeed} from '../src/surface-motion-authoring.js';
import {validateProject} from '../src/validation.js';
import {modelReadouts} from '../src/measurement-readouts.js';
import {takeModelProvenance} from '../src/model-provenance.js';
const p={version:1,name:'Surface authoring',settings:{experiment:'blank',gravity:9.81,atmosphere:{enabled:false}},objects:[],edits:{},futureAuthorData:{preserve:42}};
const actor=createRunnerActor('runner'),form=surfaceMotionForm(p);form.body='runner';
const authored=compileSurfaceMotion(p,form,actor);assert.deepEqual(p.objects,[]);assert.deepEqual(authored.futureAuthorData,p.futureAuthorData);validateProject(authored);assert.equal(surfaceMotionObjects(authored).length,1);assert(Math.abs(circularBalanceSpeed(authored,form)-Math.sqrt(9.81*2/3*1.1))<1e-12);
const roundtrip=JSON.parse(JSON.stringify(authored));validateProject(roundtrip);
assert.throws(()=>compileSurfaceMotion({...p,settings:{...p.settings,experiment:'impact'}},form,actor));
const disable=compileSurfaceMotion(authored,{...form,enabled:false});assert.equal(disable.settings.surfaceMotion,undefined);assert.deepEqual(disable.objects,authored.objects);
assert.throws(()=>compileSurfaceMotion(authored,{...form,radius:'not-a-number'}));
const decorated=structuredClone(authored);decorated.objects[0].renderOnly=true;assert.throws(()=>validateProject(decorated));
await initializePhysics();const baseline=new LabWorld(roundtrip.settings,roundtrip.objects,roundtrip.edits),withDecoration=structuredClone(roundtrip);withDecoration.objects.push({id:'large-render-only',asset:'custom',renderOnly:true,parts:[{shape:'box',d:[100,100,100],p:[0,0,0],color:'#123456'}],position:[0,0,0],mass:1000});
validateProject(withDecoration);const decoratedLab=new LabWorld(withDecoration.settings,withDecoration.objects,withDecoration.edits);
try{assert.equal(decoratedLab.find('large-render-only').colliders.length,0);for(let i=0;i<340;i++){baseline.step();decoratedLab.step();const a=baseline.find('runner').body,b=decoratedLab.find('runner').body;assert.deepEqual(a.translation(),b.translation());assert.deepEqual(a.linvel(),b.linvel());}const r=modelReadouts(baseline);assert(Number.isFinite(r.azimuthSpeed));assert(Number.isFinite(r.surfaceHeight));assert.equal(baseline.surfaceMotion.config.mass,70);const provenance=takeModelProvenance({settings:roundtrip.settings},{surfaceMotion:{config:baseline.surfaceMotion.config,handoff:baseline.surfaceMotion.handoff}});assert(provenance.models.some(m=>m.id==='surface-motion'&&m.parameters.parametersSource==='effective-runtime'));}finally{baseline.dispose();decoratedLab.dispose();}
console.log('Surface authoring passed: draft isolation, actor, balance speed, JSON, invalid domains, readouts/provenance, collider-free decoration has exactly zero effect through handoff.');
