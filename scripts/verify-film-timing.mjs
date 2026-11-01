import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {settingsFor} from '../src/catalog.js';
import {setFilmClipTiming,filmClipTiming,filmDuration,validateFilm} from '../src/film.js';
import {captureFilm} from './capture-film.mjs';
const scene={version:1,settings:{...settingsFor('blank'),gravity:0,exportFps:60,story:{duration:8,metricStart:4,cues:[{start:2,end:6,text:"Measured interval",fade:.2}]},cameraRig:{mode:'keys',duration:8,interpolation:'linear',points:[{time:0,sourceTime:.2,position:[4,4,6],target:[0,1,0],fov:45},{time:4,sourceTime:.6,position:[3,3,5],target:[0,1,0],fov:40,cut:true},{time:8,sourceTime:1,position:[2,3,4],target:[0,1,0],fov:35}]}},objects:[{id:'subject',asset:'ball',position:[0,3,0],mass:1,velocity:[1,0,0]}],edits:{}};
const original=JSON.stringify(scene),retimed=setFilmClipTiming(scene,{duration:2,sourceStart:.4,sourceEnd:1.6});
assert.equal(JSON.stringify(scene),original);assert.deepEqual(filmClipTiming(retimed),{manual:true,duration:2,sourceStart:.4,sourceEnd:1.6});
assert.equal(retimed.settings.story.metricStart,1);assert.deepEqual(retimed.settings.story.cues[0],{start:.5,end:1.5,text:"Measured interval",fade:.05});assert.equal(retimed.settings.cameraRig.points[1].cut,true);assert.equal(retimed.settings.cameraRig.points[1].time,1);
for(let i=0;i<3;i++)assert.deepEqual(retimed.settings.cameraRig.points[i].position,scene.settings.cameraRig.points[i].position);
assert.throws(()=>setFilmClipTiming(scene,{sourceStart:2,sourceEnd:1}));assert.throws(()=>setFilmClipTiming(scene,{sourceEnd:21}));assert.throws(()=>setFilmClipTiming(scene,{duration:NaN}));
const auto=structuredClone(scene);auto.settings.cameraRig={mode:'auto',points:[]};assert.equal(filmClipTiming(setFilmClipTiming(auto,{duration:7})).duration,7);assert.throws(()=>setFilmClipTiming(auto,{sourceStart:1}));
const film={version:1,enabled:true,clips:[{id:'timed',project:retimed}]};validateFilm(film);assert.equal(filmDuration(film),2);
const directory=await mkdtemp(path.join(tmpdir(),'matter-timing-'));
try{const data=await captureFilm({...retimed,film,height:720},path.join(directory,'capture.json'));assert.equal(data.duration,2);assert.equal(data.takes[0].frames.length,120);const frames=data.takes[0].frames;assert(Math.abs(frames[0].sourceTime-.4)<1e-6);assert(frames.at(-1).sourceTime<=1.6&&1.6-frames.at(-1).sourceTime<.02);assert(frames.at(-1).heroPosition[0]>frames[0].heroPosition[0],'The selected interval must contain actual simulated movement');console.log('Film timing passed: independent clocks, unchanged poses/cuts, relative metric timing, validation, auto mode, exact 120-frame export and simulated source endpoints.');}finally{await rm(directory,{recursive:true,force:true});}
