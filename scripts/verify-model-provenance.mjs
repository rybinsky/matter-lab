import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {takeModelProvenance,captureModelProvenance} from '../src/model-provenance.js';
import {settingsFor} from '../src/catalog.js';
import {captureFilm} from './capture-film.mjs';

const ids=p=>p.models.map(m=>m.id),find=(p,id)=>p.models.find(m=>m.id===id);
assert.deepEqual(captureModelProvenance([{settings:{experiment:'blank'}}]).models,['Rapier 0.21']);
assert(!ids(takeModelProvenance({settings:{experiment:'blank',atmosphere:{enabled:false}}})).includes('atmosphere'));
const configured={settings:{experiment:'blank',atmosphere:{enabled:true,density:1.1},penetration:{parameters:{projectile:{mass:999}},axis:[0,-1,0]},assemblies:[{id:'a',bonds:[{id:'ab',a:'a',b:'b',breakForceN:50}]}]}},original=structuredClone(configured);
const described=takeModelProvenance(configured,{penetration:{parameters:{projectile:{mass:2},gravity:1.62}},softBodies:[{id:'fruit',solver:'fem',parameters:{young:1500}}]});
assert.deepEqual(configured,original);assert.equal(find(described,'penetration').parameters.parameters.projectile.mass,2);
assert.equal(find(described,'penetration').parameters.parameters.gravity,1.62);
assert(ids(described).includes('atmosphere')&&ids(described).includes('breakables')&&ids(described).includes('soft-fem'));
assert(find(described,'breakables').limitations.some(s=>s.includes('not calibrated')));
assert(!ids(described).includes('soft-constraints'));
assert(ids(takeModelProvenance({settings:{experiment:'soft'}})).includes('soft-constraints'));
assert(ids(takeModelProvenance({settings:{experiment:'blank'},meshes:[{id:'legacy'}]})).includes('soft-unspecified'));
assert.deepEqual(ids(takeModelProvenance({settings:{experiment:'blank'},meshes:[{id:'connection'}]},{softBodies:[]})),['rigid']);
const a={clipId:'air-a',settings:{experiment:'blank',atmosphere:{density:1.1}}},b={clipId:'air-b',settings:{experiment:'blank',atmosphere:{density:.3}}},aggregate=captureModelProvenance([a,b]);
assert.equal(aggregate.models.filter(s=>s.includes('Archimedes')).length,1);
assert.deepEqual(aggregate.modelProvenance.models.find(m=>m.id==='atmosphere').takeIndices,[0,1]);
assert.equal(find(aggregate.modelProvenance.takes[0],'atmosphere').parameters.density,1.1);
assert.equal(find(aggregate.modelProvenance.takes[1],'atmosphere').parameters.density,.3);
assert.equal(aggregate.modelProvenance.takes[1].clipId,'air-b');

const point=(time,sourceTime)=>({time,sourceTime,position:[4,3,5],target:[0,1,0],fov:40});
const scene=objects=>({version:1,name:'Metadata fixture',series:false,height:720,settings:{...settingsFor('blank'),gravity:0,autoLaunch:false,exportFps:30,cameraRig:{mode:'keys',points:[point(0,0),point(.2,.15)]},story:{enabled:false,metric:'none',autoTrim:false}},objects,edits:{}});
const air=scene([{id:'lift',asset:'cube',position:[0,2,0],mass:2,buoyancy:{volume:.25,dragCoefficient:.5,referenceArea:.3}}]);air.settings.atmosphere={enabled:true,density:1.2};
const soft=scene([{id:'soft',asset:'ball',position:[0,2,0],mass:.3,material:'jelly',deformable:{cellSize:.2,young:1500}}]);
const axial=scene([{id:'shot',asset:'cylinder',position:[0,1.2,0],mass:2,material:'metal'},{id:'sample',asset:'cube',position:[0,.75,-.175],scale:.7,fixed:true,material:'ice'}]);
axial.settings.penetration={projectileId:'shot',targetId:'sample',axis:[0,-1,0],entry:[0,1.1,0],parameters:{projectile:{mass:999,radius:.02,length:.1,temperature:1000},target:{thickness:.7},gravity:999,initialSpeed:1},clock:[{time:0,elapsed:0},{time:.2,elapsed:.2}]};
const project={...scene([]),film:{version:1,enabled:true,title:'Mixed blank models',clips:[{id:'air',project:air},{id:'soft',project:soft},{id:'axial',project:axial}]}},before=JSON.stringify(project),directory=await mkdtemp(path.join(tmpdir(),'matter-model-provenance-'));
try{
 const data=await captureFilm(project,path.join(directory,'film.json'));assert.equal(JSON.stringify(project),before);
 assert(data.takes.every(t=>t.settings.experiment==='blank'),'The fixture must expose the original blank-scene attribution bug');
 const airModel=find(data.takes[0].modelProvenance,'atmosphere');assert.equal(airModel.parameters.volumes[0].mass,2);assert.equal(airModel.parameters.volumes[0].volume,.25);
 const softModel=find(data.takes[1].modelProvenance,'soft-fem');assert(softModel.parameters.bodies[0].particles>0);assert.equal(softModel.parameters.bodies[0].parameters.young,1500);
 const penetration=find(data.takes[2].modelProvenance,'penetration');assert(Math.abs(penetration.parameters.parameters.projectile.mass-2)<1e-6);assert.equal(penetration.parameters.parameters.gravity,0);
 assert.notEqual(penetration.parameters.parameters.projectile.mass,999,'Authored mass must not override actual solver mass in provenance');
 for(const id of ['rigid','atmosphere','soft-fem','penetration'])assert(data.modelProvenance.models.some(m=>m.id===id));
 const stored=JSON.parse(await readFile(path.join(directory,'film.json'),'utf8'));assert.deepEqual(stored.modelProvenance,data.modelProvenance);
 for(const clip of data.film.clips){const child=JSON.parse(await readFile(path.join(directory,clip.sourceCache),'utf8'));assert(child.models.length>1);assert.deepEqual(child.modelProvenance.takes[0].models,data.takes[clip.takeStart].modelProvenance.models);}
 const compared=structuredClone(soft);delete compared.objects[0].deformable.young;compared.series=true;compared.settings.comparison={enabled:true,field:'material',targetId:'soft',values:['wood','rubber','metal','cork']};
 const variants=await captureFilm(compared,path.join(directory,'material-change.json'));
 for(const take of variants.takes){const body=find(take.modelProvenance,'soft-fem').parameters.bodies[0];assert.equal(body.parameters.young,2200,'Record the actual changed material, not stale mesher metadata (initial jelly was1400)');assert.notEqual(body.materialPreset,'jelly');}
}finally{await rm(directory,{recursive:true,force:true});}
console.log('Model provenance passed: disabled models, solver distinction, approximation limits, per-take parameters and actual mixed blank-scene single/film captures, including effective penetration mass/gravity.');
