import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {editorialFrame,normalizedStory} from '../src/storyboard.js';
import {validateProject} from '../src/validation.js';
import {settingsFor} from '../src/catalog.js';
import {captureFilm} from './capture-film.mjs';
const long='При одинаковой скорости более тяжёлое тело передаёт больший импульс';
const story={enabled:true,theme:'minimal',metric:'speed',metricStart:1.5,hook:'Legacy hook',question:'Legacy question',labels:{action:'Legacy action',result:'Legacy result'},cues:[{start:.2,end:1,text:long,fade:.2},{start:1,end:2,text:'Наблюдаем {value} {unit}',label:'Авторские условия',hideMetric:true,fade:0}]};
const f=t=>editorialFrame({story,time:t,duration:3,hero:{speed:2.5}});
assert.equal(f(0).caption,'');assert.equal(f(0).captionOpacity,0);assert.equal(f(.2).caption,long);assert.equal(f(.3).caption,long);assert(Math.abs(f(.3).captionOpacity-.5)<1e-9);assert.equal(f(.5).captionOpacity,1);assert.equal(f(.5).hideMetric,true,'Unchecked hide must preserve global metricStart');assert.equal(f(1).caption,'Наблюдаем 2,5 м/с');assert.equal(f(1).takeLabel,'Авторские условия');assert.equal(f(1).hideMetric,true);assert.equal(f(2).caption,'');assert(!f(.5).caption.includes('…'));
assert.deepEqual(normalizedStory({cues:[null,{}]}).cues,[]);
const rig={mode:'keys',duration:3,points:[{time:0,sourceTime:0,position:[4,3,5],target:[0,1,0],fov:40},{time:3,sourceTime:1,position:[3,3,5],target:[0,1,0],fov:40}]};
const project={version:1,settings:{...settingsFor('blank'),gravity:0,exportFps:60,story,cameraRig:rig},objects:[{id:'ball',asset:'ball',position:[0,2,0],velocity:[1,0,0],mass:1}],edits:{},height:720};
validateProject(project);
assert.throws(()=>validateProject({...project,settings:{...project.settings,story:{cues:[{start:1,end:3,text:'A'},{start:2,end:4,text:'B'}]}}}));
assert.throws(()=>validateProject({...project,settings:{...project.settings,story:{cues:[{start:0,end:1,text:'A',fade:-1}]}}}));
const directory=await mkdtemp(path.join(tmpdir(),'matter-cues-'));
try{
 const baseline=structuredClone(project);delete baseline.settings.story.cues;const a=await captureFilm(baseline,path.join(directory,'baseline.json')),b=await captureFilm(JSON.parse(JSON.stringify(project)),path.join(directory,'timed.json'));
 const frames=b.takes[0].frames;assert.equal(frames.length,180);for(let i=0;i<frames.length;i++){assert.equal(frames[i].poses,a.takes[0].frames[i].poses);assert.deepEqual(frames[i].camera,a.takes[0].frames[i].camera);const at=i/60;assert.equal(frames[i].editorial.caption,at>=.2&&at<1?long:at>=1&&at<2?'Наблюдаем 1,0 м/с':'');}
 const observe=structuredClone(project);observe.settings.story={enabled:true,theme:'minimal',title:'',hook:'',question:'',takeaway:'',labels:{setup:'',action:'',result:''},cues:[],parameterLabel:'',metric:'none'};const c=await captureFilm(observe,path.join(directory,'observe.json'));assert(c.takes[0].frames.every(frame=>!frame.editorial.caption&&!frame.editorial.hook&&!frame.editorial.question));
 console.log('Timed captions passed: exact cue boundaries/fades, complete authored copy, measured variables, empty intervals, validation/persistence, unchanged simulation/camera and empty authored text track in 540 real captured frames.');
}finally{await rm(directory,{recursive:true,force:true});}
