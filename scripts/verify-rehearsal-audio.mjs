import {rehearsalAudioPlan as plan} from '../src/rehearsal-audio.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { settingsFor } from '../src/catalog.js';
import { createSoundtrack } from './soundtrack.mjs';
import { selectSoundEvents } from '../src/sound-design.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=await mkdtemp(path.join(tmpdir(),'matter-rehearsal-audio-'));
const environment={...process.env,MATTER_LAB_DEV:'0',MATTER_LAB_HOST:'127.0.0.1',MATTER_LAB_DATA_DIR:temporary,MATTER_LAB_CACHE_DIR:path.join(temporary,'cache'),MATTER_LAB_MEDIA_DIR:path.join(temporary,'videos'),MATTER_LAB_PROJECTS_DIR:path.join(temporary,'projects')};
delete environment.MATTER_LAB_RENDER_WORKER_URL;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,serverExit,serverLog='',httpChecks=0;
function scene(duration,material,height){
 return{version:1,name:'Rehearsal audio fixture',series:false,height:720,edits:{},
  settings:{...settingsFor('blank'),exportFps:30,audioPreset:'minimal',musicTrack:'minimal-3',simulationDuration:duration,story:{enabled:false,duration:5,autoTrim:false,heroId:'drop'},cameraRig:{mode:'keys',interpolation:'linear',points:[0,duration].map(time=>({time,sourceTime:time,position:[4,3,6],target:[0,.5,0],fov:40}))}},
  objects:[{id:'drop',asset:'ball',material,mass:1,scale:.3,position:[0,height,0]}]};
}
async function runPreview(project){
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts/preview-one.mjs')],{cwd:root,env:environment,stdio:['pipe','ignore','pipe']});let errors='';child.stdin.end(JSON.stringify(project));child.stderr.on('data',c=>errors+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(errors||`Preview exit ${code}`)));});
}
async function freePort(){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
try{
 const short=scene(2,'metal',1.3),long=scene(3.5,'rubber',1.8);
 await runPreview({...short,jobId:'audio-regression',film:{version:1,enabled:true,title:'Audio timing fixture',clips:[{id:'short',label:'Short',project:short},{id:'long',label:'Long',project:long}]}});
 const data=JSON.parse(await readFile(path.join(temporary,'cache/preview-session-audio-regression.json'),'utf8')),wav=await readFile(path.join(temporary,'cache/preview-session-audio-regression.wav'));
 assert.equal(data.duration,5.5);assert.deepEqual(data.takes.map(t=>t.start),[0,2]);assert.equal(data.audioUrl,'/api/preview-audio/audio-regression.wav');
 assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt32LE(24),32000);assert.equal(wav.readUInt16LE(22),2);assert.equal(wav.readUInt16LE(34),16);
 assert.equal(wav.byteLength,704044);assert.equal(data.audio.duration,data.duration);assert.equal(data.audio.clock,'movie');assert(wav.equals(createSoundtrack(data)),'Preview WAV must use the exact final soundtrack mix');
 let energy=0;for(let i=44;i<wav.length;i+=2)energy+=(wav.readInt16LE(i)/32768)**2;assert(Math.sqrt(energy/((wav.length-44)/2))>.01,'The selected music and contacts must produce a non-silent mix');
 const events=selectSoundEvents(data);assert(events.some(e=>e.takeIndex===1&&e.t>=2));assert(data.takes[1].impacts.every(e=>e.t>=2),'Second-clip contacts use the absolute movie clock');

 // The real clock helper imports directly, with no DOM or stylesheet loader.
 assert.equal(plan({time:1,duration:5.5,playing:true}).play,false,'Playback starts silent');
 for(const time of [1.99,2,2.01,3.5]){const state=plan({time,duration:5.5,playing:true,enabled:true,audioTime:time-.01});assert.equal(state.currentTime,time);assert.equal(state.play,true);assert.equal(state.seek,false);}
 const seek=plan({time:.7,duration:5.5,playing:false,enabled:true,audioTime:4.5,force:true});assert.equal(seek.currentTime,.7);assert.equal(seek.seek,true);assert.equal(seek.play,false);
 for(const rate of [.25,.5,1,2]){const state=plan({time:3,duration:5.5,rate,playing:true,enabled:true,audioTime:3.01});assert.equal(state.playbackRate,rate);assert.equal(state.play,true);assert.equal(state.seek,false);}
 assert.equal(plan({time:3,duration:5.5,audioTime:2.8}).seek,true);assert.equal(plan({time:3,duration:5.5,audioTime:2.96}).seek,false);

 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...environment,MATTER_LAB_PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c);serverExit=new Promise(resolve=>server.once('exit',resolve));
 const deadline=Date.now()+10000;for(;;){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}assert(server.exitCode===null&&Date.now()<deadline,serverLog||'Test server did not start');await sleep(50);}
 const url=base+data.audioUrl,request=(target=url,options={})=>fetch(target,{...options,signal:AbortSignal.timeout(3000)});
 const full=await request();assert.equal(full.status,200);for(const[k,v]of Object.entries({'content-type':'audio/wav','accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}))assert.equal(full.headers.get(k),v);assert(Buffer.from(await full.arrayBuffer()).equals(wav));httpChecks++;
 const head=await request(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),wav.length);assert.equal((await head.arrayBuffer()).byteLength,0);httpChecks++;
 for(const[range,start,end]of[['bytes=0-43',0,43],['bytes=44-99',44,99],['bytes=-32',wav.length-32,wav.length-1],[`bytes=${wav.length-1}-`,wav.length-1,wav.length-1]]){const r=await request(url,{headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/${wav.length}`);assert(Buffer.from(await r.arrayBuffer()).equals(wav.subarray(start,end+1)));httpChecks++;}
 for(const range of[`bytes=${wav.length}-`,'bytes=99-44','bytes=0-1,4-5','bytes=-']){const r=await request(url,{headers:{Range:range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),`bytes */${wav.length}`);await r.arrayBuffer();httpChecks++;}
 for(const suffix of['bad..id.wav','missing.wav']){assert.equal((await request(base+'/api/preview-audio/'+suffix)).status,404);httpChecks++;}
 assert.equal((await request(url,{method:'POST'})).status,405);httpChecks++;
 const link=path.join(temporary,'cache/preview-session-link.wav');await writeFile(path.join(temporary,'outside.txt'),'This is not rehearsal audio.\n'.repeat(4));await symlink(path.join(temporary,'outside.txt'),link);assert.equal((await request(base+'/api/preview-audio/link.wav')).status,404);await unlink(link);httpChecks++;
 console.log(`Rehearsal audio passed: exact 5.5 s stereo PCM mix, unequal clips/contact timing, silent start/pause/seek/rates/drift, ${httpChecks} HTTP/range/path checks.`);
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([serverExit,sleep(2000)]);if(server.exitCode===null){server.kill('SIGKILL');await serverExit;}}
 await rm(temporary,{recursive:true,force:true});
}
