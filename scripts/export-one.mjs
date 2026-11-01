import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { captureFilm } from './capture-film.mjs';
import { createSoundtrack } from './soundtrack.mjs';
import { acquireRenderLock } from './render-lock.mjs';
import { createSocialDelivery } from './social-delivery.mjs';
import { downloadableProject, exportMetadata } from '../src/export-artifacts.js';
import { cacheDir, mediaDir as out, renderBinary as binary } from '../runtime-paths.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

await mkdir(cacheDir,{recursive:true});await mkdir(out,{recursive:true});
const progress=(p,m)=>process.stdout.write(JSON.stringify({progress:Math.round(p),message:m})+'\n');
let text='';for await(const c of process.stdin)text+=c;
const project=JSON.parse(text);const id=String(project.jobId||Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g,'');
const name=project.outputName||`${project.settings.experiment}-${id}`;
if(!/^[a-zA-Z0-9_-]{1,90}$/.test(name))throw new Error('Invalid output name');
const cache=path.join(cacheDir,id+'.json'),silent=path.join(cacheDir,id+'-silent.mp4'),wav=path.join(cacheDir,id+'.wav');
const video=path.join(out,name+'.mp4');
const children=new Set();let stopping=false;
process.once('SIGTERM',()=>{stopping=true;for(const child of children)child.kill('SIGTERM');});
const run=(command,args,options={})=>new Promise((resolve,reject)=>{if(stopping)return reject(new Error('Рендер остановлен.'));const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],...options});children.add(child);let stderr='';child.stderr.on('data',c=>{stderr=(stderr+c).slice(-6000);});child.stdout.on('data',c=>{const str=String(c);if(options.onLine)for(const line of str.split('\n'))options.onLine(line);});child.on('error',reject);child.on('exit',code=>{children.delete(child);return code===0?resolve():reject(new Error(`${command}: ${stderr}`));});});
const renderLock=await acquireRenderLock(progress);
try{
 progress(0,'Подготовка симуляции');
 // Native render source is small and compiling after a source edit keeps the worker reproducible.
 let compile=true;try{const {stat}=await import('node:fs/promises');const a=await stat(binary),b=await stat(path.join(root,'scripts/render-native.swift'));compile=b.mtimeMs>a.mtimeMs;}catch{}
 if(process.env.MATTER_LAB_RENDER_BINARY){await access(binary);compile=false;}
 if(compile)await run('swiftc',['-O','-module-cache-path',path.join(cacheDir,'swift-modules'),path.join(root,'scripts/render-native.swift'),'-o',binary]);
 const data=await captureFilm(project,cache,progress);
 progress(15,'Рендер 3D-кадров');
 const nativeProgress=line=>{const m=/FRAME (\d+)\/(\d+)/.exec(line);if(m)progress(15+Number(m[1])/Number(m[2])*79,`Рендер: ${Math.round(Number(m[1])/Number(m[2])*100)}%`);};
 try{await run(binary,[cache,silent],{onLine:nativeProgress});}catch(error){if(data.width<2160)throw error;progress(15,'Повторная сборка совместимым кодировщиком');await run(binary,[cache,silent],{env:{...process.env,MATTER_LAB_ENCODER:'software'},onLine:nativeProgress});}
 progress(95,'Звук и сборка MP4');
 await writeFile(wav,createSoundtrack(data));
 await run('ffmpeg',['-hide_banner','-loglevel','error','-i',silent,'-i',wav,'-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-ar','48000','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','-y',video]);
 await run('ffmpeg',['-hide_banner','-loglevel','error','-ss','1','-i',video,'-frames:v','1','-pix_fmt','yuvj420p','-q:v','3','-y',path.join(out,name+'.jpg')]);
 await writeFile(path.join(out,name+'.project.json'),JSON.stringify(downloadableProject(project,{title:data.title}),null,2));
 await writeFile(path.join(out,name+'.json'),JSON.stringify(exportMetadata(project,data,{id,name,created:new Date().toISOString()}),null,2));
 if(data.width>=2160){progress(98,'Готовим версию для публикации');await createSocialDelivery(video,JSON.parse(await readFile(path.join(out,name+'.json'),'utf8')));}
 progress(100,'Готово: '+video);
}catch(e){console.error(e.stack||e);process.exitCode=1;}finally{await renderLock.release();}

function audio(data){
 const sr=32000,n=Math.ceil(data.duration*sr),samples=new Float32Array(n);let seed=12345;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
 const events=data.takes.flatMap(t=>t.impacts);let prev=-1;
 for(const e of events){if(e.t-prev<.035)continue;prev=e.t;const start=Math.floor(e.t*sr),len=Math.floor(.23*sr);const pitch=75+(e.strength||.1)*160;
  for(let j=0;j<len&&start+j<n;j++){const t=j/sr;const envelope=Math.exp(-t/ .045);samples[start+j]+=(Math.sin(2*Math.PI*pitch*t)*.65+rand()*.35)*envelope*Math.min(.27,e.strength*.25+.015);}
 }
 if(data.experiment==='flow')for(let i=0;i<n;i++){const local=(i/sr)%15;const amp=local>1&&local<13?.025:0;samples[i]+=rand()*amp;}
 const bytes=Buffer.alloc(44+n*2);bytes.write('RIFF',0);bytes.writeUInt32LE(36+n*2,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(sr,24);bytes.writeUInt32LE(sr*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)bytes.writeInt16LE(Math.round(Math.tanh(samples[i])*.8*32767),44+i*2);return bytes;
}
