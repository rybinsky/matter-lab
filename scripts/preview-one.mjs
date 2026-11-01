import {captureFilm as capture} from './capture-film.mjs';
import {cacheDir} from '../runtime-paths.mjs';
import path from 'node:path';
import {normalizedStory} from '../src/storyboard.js';
import {comparisonVariants} from '../src/comparison.js';
import {EXPERIMENTS} from '../src/catalog.js';
import {createSoundtrack} from './soundtrack.mjs';
import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
let text='';for await(const chunk of process.stdin)text+=chunk;
const p=JSON.parse(text),id=String(p.jobId||Date.now()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||Date.now().toString(36);await mkdir(cacheDir,{recursive:true});
const story=normalizedStory(p.settings.story),count=p.series?(comparisonVariants(p.settings.comparison).length||EXPERIMENTS.find(e=>e.id===p.settings.experiment)?.variants.length||1):1,duration=story.duration/count;
const jsonPath=path.join(cacheDir,`preview-session-${id}.json`),wavPath=path.join(cacheDir,`preview-session-${id}.wav`);
const data=await capture({...p,preview:true,previewDuration:duration,height:720},jsonPath,(progress,message)=>console.log(JSON.stringify({progress:Math.min(90,progress/14*90),message})));
console.log(JSON.stringify({progress:92,message:'Собираем звуковую дорожку'}));
const temporary=wavPath+'.tmp-'+process.pid;
try{
 const wav=createSoundtrack(data);await writeFile(temporary,wav,{flag:'wx'});await rename(temporary,wavPath);
 data.audioUrl='/api/preview-audio/'+encodeURIComponent(id)+'.wav';
 const sampleRate=wav.readUInt32LE(24),channels=wav.readUInt16LE(22),bitsPerSample=wav.readUInt16LE(34);
 data.audio={format:'wav',codec:'pcm',sampleRate,channels,bitsPerSample,duration:wav.readUInt32LE(40)/(sampleRate*channels*bitsPerSample/8),clock:'movie',mix:'createSoundtrack'};
}catch(error){data.audioError='Не удалось подготовить звук репетиции.';console.error('Preview audio:',error?.message||error);}
finally{await unlink(temporary).catch(()=>{});}
const jsonTemporary=jsonPath+'.tmp-'+process.pid;await writeFile(jsonTemporary,JSON.stringify(data));await rename(jsonTemporary,jsonPath);
console.log(JSON.stringify({progress:100,message:data.audioUrl?'Репетиция готова':'Репетиция готова без звука',dataUrl:'/api/previews/'+id,audioUrl:data.audioUrl}));
