import {mkdir,writeFile,unlink,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {TRACKS} from '../src/tracks.js';
import {createSoundtrack} from './soundtrack.mjs';
await mkdir('public/music',{recursive:true});await mkdir('.cache/music',{recursive:true});
for(const track of TRACKS.filter(track=>!track.recording)){
 const target='public/music/'+track.id+'.mp3';try{const s=await stat(target);if(s.size>100000)continue;}catch{}
 const wav='.cache/music/'+track.id+'.wav';await writeFile(wav,createSoundtrack({duration:60,experiment:'music',audioPreset:track.mood,musicTrack:track.id,takes:[{frames:[],impacts:[]}]}));
 await new Promise((resolve,reject)=>{const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i',wav,'-codec:a','libmp3lame','-b:a','112k','-metadata',`title=${track.title}`,'-metadata','artist=Matter Lab Original','-y',target],{stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',c=>err+=c);p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error(err)));});
 await unlink(wav);console.log('TRACK',track.id,track.title);
}
await writeFile('public/music/catalog.json',JSON.stringify(TRACKS,null,2));console.log(`${TRACKS.length} tracks indexed; recorded assets retained.`);
