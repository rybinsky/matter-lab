import{spawn}from'node:child_process';import{rename,access}from'node:fs/promises';
import path from'node:path';
const jobs=[['showcase-1-thermal','review-showcase-1-thermal'],['showcase-2-soft','final-v3-soft'],['showcase-3-mechanism','final-v3-mechanism'],['showcase-4-orbit','final-v3-orbit'],['showcase-5-flow','final-v3-flow'],['blank-mvx43e8n','review-blank-mvx43e8n']];
const run=args=>new Promise((resolve,reject)=>{const p=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let error='';p.stderr.on('data',c=>error=(error+c).slice(-2000));p.on('exit',code=>code===0?resolve():reject(new Error(error)));p.on('error',reject);});
for(const[name,cache]of jobs){
 const video=path.resolve('../matter-lab-videos',name+'.mp4'),audio=path.resolve('.cache',cache+'.wav'),temp=path.resolve('.cache',name+'-audio-final.mp4');await access(audio);
 await run(['-hide_banner','-loglevel','error','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-ar','48000','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','-y',temp]);await rename(temp,video);
 if(name.startsWith('showcase')){const social=path.resolve('../matter-lab-videos',name+'-social.mp4'),proxy=path.resolve('.cache',name+'-social-audio-final.mp4');await run(['-hide_banner','-loglevel','error','-i',social,'-i',video,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart','-y',proxy]);await rename(proxy,social);}
 console.log('Normalized',name);
}
