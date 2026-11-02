import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeGraphicsStyle,normalizeCueGraphics,resolveGraphicsStyle,graphicsStyleTokens,graphicsStyleVariables} from '../src/graphics-style.js';
import {normalizedStory,editorialFrame} from '../src/storyboard.js';
import {validateProject} from '../src/validation.js';
import {settingsFor} from '../src/catalog.js';
import {capture} from './capture.mjs';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`);
let checks=0;async function check(label,fn){await fn();checks++;console.log(`PASS ${label}`);}
const global={preset:'poster',position:'top',align:'center',scale:1.1,labelScale:1.4,metricScale:1.15,tone:'dark',backdrop:'soft',showCounter:true,showProgress:true};
const make=(cues,graphics=global)=>({graphics,cues,metric:'speed',parameterLabel:'Общее условие'});
const frame=(story,time)=>editorialFrame({story,time,duration:3,stats:{heroSpeed:3.5,readouts:{azimuthSpeed:4.4}},takeLabel:'Общее условие'});

await check('Partial overrides retain inheritance and do not mutate author input',()=>{
 const input={position:'center',labelScale:1.6},before=structuredClone(input),partial=normalizeCueGraphics(input);assert.deepEqual(input,before);assert.deepEqual(partial,input);assert.deepEqual(normalizeCueGraphics({}),{});
 const merged=resolveGraphicsStyle(global,input);assert.equal(merged.preset,'poster');assert.equal(merged.position,'center');assert.equal(merged.scale,1.1);assert.equal(merged.labelScale,1.6);assert.equal(merged.tone,'dark');assert.equal(merged.showCounter,true);
 const reset=resolveGraphicsStyle(global,{labelScale:1});assert.equal(reset.labelScale,1);delete input.labelScale;assert.equal(resolveGraphicsStyle(global,input).labelScale,1.4);
 const s=normalizedStory(make([{start:0,end:1,text:'Условие меняется',graphics:{position:'bottom'}}]));assert.deepEqual(s.cues[0].graphics,{position:'bottom'});assert.ok(!Object.hasOwn(s.cues[0],'entrance'));assert.deepEqual(normalizedStory(JSON.parse(JSON.stringify(s))).cues,s.cues);
});
await check('Resolved frame tokens support independent readable conditions and measurements',()=>{
 const f=frame(make([{start:0,end:2,text:'{azimuthSpeed} м/с',label:'Скорость измерена',fade:0,graphics:{position:'bottom',scale:1.5,labelScale:1.6,metricScale:1.25}}]),1);
 assert.equal(f.caption,'4,40 м/с');assert.equal(f.takeLabel,'Скорость измерена');near(f.graphicsLayout.headlineSize,147);near(f.graphicsLayout.labelSize,86.4);near(f.graphicsLayout.metricSize,210);assert.equal(f.graphicsLayout.metricAnchor,0);assert.equal(f.graphicsLayout.metricAnchorY,144);
 assert.equal(f.graphics.scale,1.5);assert.equal(f.graphics.preset,'poster');assert.deepEqual(f.graphicsLayout,graphicsStyleTokens(f.graphics));
 const vars=graphicsStyleVariables(f.graphics,{light:true,layout:f.graphicsLayout});assert.equal(vars['--graphics-label-size'],'8cqw');assert.ok(!Object.values(vars).some(x=>/NaN|Infinity/.test(x)));
});
await check('Fade, cut and cubic rise share exact cue boundaries and leave metric tokens unchanged',()=>{
 for(const entrance of ['fade','cut','rise']){
  const story=make([{start:.2,end:1.2,text:'При той же массе',label:'Новое условие',fade:.2,entrance}]);
  assert.equal(frame(story,.1).captionOpacity,0);assert.equal(frame(story,1.2).captionOpacity,0);assert.equal(frame(story,1.2).captionOffsetY,0);
  near(frame(story,.2).captionOpacity,entrance==='cut'?1:0);near(frame(story,.3).captionOpacity,entrance==='cut'?1:.5);near(frame(story,1.1).captionOpacity,entrance==='cut'?1:.5);
  near(frame(story,.2).captionOffsetY,entrance==='rise'?32:0);near(frame(story,.3).captionOffsetY,entrance==='rise'?4:0);near(frame(story,.5).captionOffsetY,0);near(frame(story,1.1).captionOffsetY,0);
  assert.deepEqual(frame(story,.2).graphicsLayout,frame(story,.5).graphicsLayout,'Entrance cannot move or resize the metric layout');
 }
 const zero=frame(make([{start:0,end:1,text:'Без перехода',fade:0,entrance:'rise'}]),0);assert.equal(zero.captionOpacity,1);assert.equal(zero.captionOffsetY,0);
});
await check('Bottom rise reserves its complete incoming travel inside the safe edge',()=>{
 const story=make([{start:.2,end:1.2,text:'Большое число',entrance:'rise',fade:.2,graphics:{position:'bottom'}}]);
 for(const t of [.2,.21,.25,.3,.4,.7,1.1]){const f=frame(story,t);assert.equal(f.graphicsLayout.anchorY,1624);assert.ok(f.graphicsLayout.anchorY+f.captionOffsetY<=1656);const vars=graphicsStyleVariables(f.graphics,{layout:f.graphicsLayout});near(Number.parseFloat(vars['--graphics-y']),1624/19.2);}
});
await check('Legacy cues preserve captions, global formatting and their fade time',()=>{
 const story=make([{start:.2,end:1,text:'Прежний титр',label:'Прежнее условие',fade:.2}]);
 const f=frame(story,.3);assert.equal(f.caption,'Прежний титр');assert.equal(f.takeLabel,'Прежнее условие');near(f.captionOpacity,.5);assert.equal(f.captionOffsetY,0);assert.deepEqual(f.graphics,normalizeGraphicsStyle(global));
 const blank=frame(story,1);assert.equal(blank.caption,'');assert.equal(blank.captionOpacity,0);assert.deepEqual(blank.graphics,normalizeGraphicsStyle(global));
 const old=normalizeGraphicsStyle({scale:1.15});near(graphicsStyleTokens(old).labelSize,36*1.15);near(graphicsStyleTokens(old).metricSize,112*1.15);
});
await check('Validation rejects malformed, out-of-range and unknown presentation fields',()=>{
 const project={version:1,settings:{...settingsFor('blank'),story:make([{start:0,end:1,text:'Титр'}])},objects:[],edits:{}};validateProject(project);
 const invalid=(where,value)=>{const p=structuredClone(project);if(where==='global')p.settings.story.graphics=value;else if(where==='entrance')p.settings.story.cues[0].entrance=value;else p.settings.story.cues[0].graphics=value;assert.throws(()=>validateProject(p),/Некорректный проект/);};
 for(const [where,value]of [['global',{scale:1.51}],['global',{labelScale:.84}],['global',{metricScale:NaN}],['cue',{scale:.79}],['cue',{labelScale:1.61}],['cue',{metricScale:1.51}],['cue',{tone:'light'}],['cue',{position:'left'}],['cue',[]],['cue',null],['entrance','bounce']])invalid(where,value);
 const p=structuredClone(project);p.settings.story.graphics={scale:1.5,labelScale:.85,metricScale:.8};p.settings.story.cues[0].graphics={scale:.8,labelScale:1.6,metricScale:1.5};p.settings.story.cues[0].entrance='rise';validateProject(p);
});
const directory=await mkdtemp(path.join(tmpdir(),'matter-cue-presentation-'));
try{
 await check('Real capture changes typography per cue while every pose, camera and measurement stays identical',async()=>{
  const p={version:1,height:720,series:false,objects:[{id:'moving-subject',asset:'cube',position:[0,3,0],velocity:[1,0,0],mass:2,linearDamping:0}],edits:{},settings:{...settingsFor('blank'),gravity:0,autoLaunch:false,exportFps:60,focusId:'moving-subject',story:{enabled:true,autoTrim:false,metric:'speed',graphics:global,cues:[{start:0,end:.25,text:'То же движение',label:'Масса 2 кг',fade:.1},{start:.25,end:.5,text:'4,4 м/с',label:'Теперь крупнее',fade:.1},{start:.5,end:.75,text:'И другое положение',label:'Физика прежняя',fade:.1}]},cameraRig:{mode:'keys',interpolation:'linear',points:[{time:0,sourceTime:0,position:[4,5,7],target:[0,3,0],fov:45},{time:.75,sourceTime:.75,position:[4,5,7],target:[0,3,0],fov:45}]}}};
  const styled=structuredClone(p);Object.assign(styled.settings.story.cues[0],{entrance:'rise',graphics:{scale:1.4,labelScale:1.5}});Object.assign(styled.settings.story.cues[1],{entrance:'cut',graphics:{preset:'studio',position:'center',scale:1.5,labelScale:1.6,metricScale:1.2}});Object.assign(styled.settings.story.cues[2],{entrance:'fade',graphics:{position:'bottom',align:'left',labelScale:1.4}});
  const before=JSON.stringify(styled),a=await capture(p,path.join(directory,'base.json')),b=await capture(styled,path.join(directory,'styled.json'));assert.equal(JSON.stringify(styled),before);assert.equal(b.takes[0].frames.length,45);
  for(let i=0;i<45;i++){const aa=a.takes[0].frames[i],bb=b.takes[0].frames[i];assert.equal(aa.poses,bb.poses);assert.deepEqual(aa.camera,bb.camera);assert.deepEqual(aa.stats,bb.stats);assert.equal(aa.sourceTime,bb.sourceTime);assert.equal(aa.editorial.metricValue,bb.editorial.metricValue);}
  assert.equal(b.takes[0].frames[20].editorial.graphics.position,'center');assert.equal(b.takes[0].frames[20].editorial.captionEntrance,'cut');assert.equal(b.takes[0].frames[40].editorial.graphics.position,'bottom');
  if(process.env.MATTER_CUE_PRESENTATION_CAPTURE)await writeFile(process.env.MATTER_CUE_PRESENTATION_CAPTURE,JSON.stringify(b));
 });
}finally{await rm(directory,{recursive:true,force:true});}
console.log(`Cue presentation passed: ${checks} checks; exact inheritance/boundaries, readable sizes, opposite metric lane, safe bottom rise and45native captureframes with unchanged physics/camera.`);
