// Explicit integration test: requires local ffmpeg/ffprobe; not a common suite.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finalAudioPlan} from '../src/final-audio.js';
function run(binary,args){const r=spawnSync(binary,args,{encoding:null,maxBuffer:64*1024*1024});if(r.status!==0)throw Error(`${binary}: ${r.error||r.stderr?.toString()}`);return r.stdout;}
function wav(duration,active){const rate=32000,n=duration*rate,b=Buffer.alloc(44+n*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);if(active)for(let i=0;i<n;i++){const value=Math.round(Math.sin(2*Math.PI*440*i/rate)*3276);b.writeInt16LE(value,44+i*4);b.writeInt16LE(value,46+i*4);}return b;}
const folder=await mkdtemp(path.join(tmpdir(),'matter-final-audio-')),results=[];
try{
 for(const [duration,active] of [[1,false],[2,false],[1,true],[45,true]]){
  const key=`${duration}-${active?'active':'silent'}`,soundtrack=wav(duration,active),before=Buffer.from(soundtrack),plan=finalAudioPlan(soundtrack),input=path.join(folder,key+'.wav'),video=path.join(folder,key+'-silent.mp4'),output=path.join(folder,key+'.mp4');
  assert.deepEqual(soundtrack,before);assert.equal(plan.duration,duration);assert.equal(plan.filterArgs.length>0,duration>=3&&active);
  await writeFile(input,soundtrack);
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=black:s=16x16:r=10:d=${duration}`,'-c:v','libx264','-preset','ultrafast','-an','-y',video]);
  run('ffmpeg',['-hide_banner','-loglevel','error','-i',video,'-i',input,'-c:v','copy',...plan.filterArgs,'-ar','48000','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','-y',output]);
  const probe=JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',output]).toString());assert(Math.abs(Number(probe.format.duration)-duration)<.12);
  const pcm=run('ffmpeg',['-hide_banner','-loglevel','error','-i',output,'-map','0:a:0','-f','f32le','-acodec','pcm_f32le','-']);let peak=0,sum=0;
  for(let i=0;i<pcm.length;i+=4){const value=pcm.readFloatLE(i);assert(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));sum+=value*value;}
  const rms=Math.sqrt(sum/(pcm.length/4));if(!active)assert.equal(peak,0);else{assert(peak>0&&peak<=1.01);if(duration<3)assert(Math.abs(rms-.1/Math.SQRT2)<.01,'A short active mix keeps its original gain');}
  results.push({duration,active,normalization:plan.reason,outputDuration:Number(probe.format.duration),finiteSamples:pcm.length/4,peak,rms});
 }
 console.log(JSON.stringify({checks:'Actual FFmpeg mux/decode; no GPU, no NaN/Inf, preserved short/silent gain and duration',results},null,2));
}finally{await rm(folder,{recursive:true,force:true});}
