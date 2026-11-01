import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSoundtrack } from './soundtrack.mjs';
import { decodeRecordingWav, loadRecordedTrack } from './recorded-audio.mjs';
import { TRACKS } from '../src/tracks.js';

const SR=32000,recordings=TRACKS.filter(t=>t.recording),temp=mkdtempSync(path.join(tmpdir(),'matter-recorded-audio-'));
const smooth=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
function fixture(seconds=1.6,variant=0){
 const n=Math.round(seconds*SR),b=Buffer.alloc(44+n*4);b.write('RIFF');b.writeUInt32LE(36+n*4,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(SR,24);b.writeUInt32LE(SR*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);
 for(let i=0;i<n;i++){const section=Math.floor(i/(SR*.2));b.writeInt16LE(2400+section*650+variant*900,44+i*4);b.writeInt16LE(-1600-section*350-variant*700,46+i*4);}return b;
}
const decode=b=>({left:Float32Array.from({length:(b.length-44)/4},(_,i)=>b.readInt16LE(44+i*4)/32767),right:Float32Array.from({length:(b.length-44)/4},(_,i)=>b.readInt16LE(46+i*4)/32767)});
const sample=(pcm,t,channel='left')=>pcm[channel][Math.floor(t*SR)];
const base=(duration=1.5)=>({duration,fps:30,experiment:'blank',audioPreset:'pulse',musicTrack:recordings[0].id,soundDesign:{musicGain:.6,effectsGain:0,ambience:'off',ducking:0},takes:[{start:0,duration:.6,frames:[],impacts:[]},{start:.6,duration:duration-.6,frames:[],impacts:[]}]});
try{
 assert.equal(TRACKS.length,36);assert.equal(recordings.length,4);for(const t of recordings){assert.equal(t.artist,'Loyalty Freak Music');assert.equal(t.license,'CC0-1.0');assert.ok(t.source.startsWith('https://loyaltyfreakmusic.com/'));assert.equal(t.url,`/music/recordings/${t.id}.mp3`);assert.equal(t.recording.filename,`${t.id}.wav`);}
 const bytes=fixture(),audio=decodeRecordingWav(bytes);assert.equal(audio.frames,51200);assert.equal(audio.duration,1.6);assert.equal(audio.sampleRate,SR);
 const malformed=Buffer.from(bytes);malformed.writeUInt32LE(44100,24);assert.throws(()=>decodeRecordingWav(malformed),/32 кГц/);assert.throws(()=>decodeRecordingWav(bytes.subarray(0,bytes.length-1)),/неполный/);assert.throws(()=>loadRecordedTrack('../../outside.wav'),/библиотеки/);
 // Use the real loader in an isolated package, including production's dist-only
 // layout. No installed recording is replaced, and no codec executable is used.
 mkdirSync(path.join(temp,'src'),{recursive:true});mkdirSync(path.join(temp,'scripts'),{recursive:true});writeFileSync(path.join(temp,'package.json'),' {"type":"module"}');
 copyFileSync(new URL('../src/tracks.js',import.meta.url),path.join(temp,'src/tracks.js'));copyFileSync(new URL('./recorded-audio.mjs',import.meta.url),path.join(temp,'scripts/recorded-audio.mjs'));
 const sourceDir=path.join(temp,'public/music/recordings'),distDir=path.join(temp,'dist/music/recordings');mkdirSync(sourceDir,{recursive:true});mkdirSync(distDir,{recursive:true});
 const filename=recordings[0].recording.filename;writeFileSync(path.join(sourceDir,filename),bytes);writeFileSync(path.join(distDir,filename),fixture(1.6,1));
 const isolated=await import(pathToFileURL(path.join(temp,'scripts/recorded-audio.mjs')).href),loaded=isolated.loadRecordedTrack(recordings[0].id);assert.equal(loaded.left[16000],audio.left[16000]);assert.equal(isolated.loadRecordedTrack(recordings[0].id),loaded,'Decoded bundled PCM is cached');
 let loads=0;const mixer={loadRecording:id=>{assert.equal(id,recordings[0].id);loads++;return loaded;}};
 const data=base(),mixed=decode(createSoundtrack(data,mixer));assert.equal(loads,1);
 for(const t of [.24,.5,.85,1.1,1.49])for(const channel of ['left','right']){
  const i=Math.floor(t*SR),expected=loaded[channel][i]*.6*smooth(t/.08)*smooth((data.duration-t)/.26);assert.ok(Math.abs(mixed[channel][i]-expected)<1/32767,`The actual recording must match at movie time ${t}, channel ${channel}`);
 }
 assert.equal(sample(mixed,.6),0,'Shared take-boundary breath is retained');assert.ok(sample(mixed,.85)>sample(mixed,.24)*1.4,'The second take continues the recording rather than restarting at source time 0');
 assert.equal(mixed.left.at(-1),0);assert.equal(mixed.right.at(-1),0);assert.equal(mixed.left.length,48000);
 const quiet=decode(createSoundtrack({...data,soundDesign:{...data.soundDesign,musicGain:.15}},mixer));assert.ok(Math.abs(sample(quiet,.85)/sample(mixed,.85)-.25)<.001,'Recorded masters retain the selected gain and are not amplified by the synthesis ×4 calibration');
 // A different movie duration and unequal clip layout still use the same PCM
 // clock; a short recording ends in silence rather than a synthesized fallback.
 const long=base(2.2);long.takes=[{start:0,duration:.37,frames:[],impacts:[]},{start:.37,duration:1.83,frames:[],impacts:[]}];const extended=decode(createSoundtrack(long,mixer));assert.equal(extended.left.length,70400);assert.equal(sample(extended,.85),sample(mixed,.85));assert.equal(sample(extended,1.8),0);assert.equal(extended.left.at(-1),0);
 const duckData={...data,soundDesign:{...data.soundDesign,ducking:.7},takes:data.takes.map(t=>({...t,impacts:t.start===0?[{t:.9,strength:1,material:'metal'}]:[]}))},ducked=decode(createSoundtrack(duckData,mixer));assert.ok(Math.abs(sample(ducked,.93))<Math.abs(sample(mixed,.93))*.4,'Contact ducking also applies to recorded tracks');
 const muted=createSoundtrack({...data,audioPreset:'none'},{loadRecording:()=>{throw Error('Disabled music must not be loaded');}});assert.ok(muted.subarray(44).every(v=>v===0));
 assert.throws(()=>createSoundtrack(data,{loadRecording:()=>{throw Error('Missing curated PCM');}}),/Missing curated PCM/,'A missing recording must not become procedural music');
 rmSync(path.join(sourceDir,filename));const fromDist=isolated.loadRecordedTrack(recordings[0].id);assert.notEqual(fromDist.left[16000],loaded.left[16000]);assert.equal(fromDist.left[16000],decodeRecordingWav(fixture(1.6,1)).left[16000]);
 rmSync(path.join(distDir,filename));assert.throws(()=>isolated.loadRecordedTrack(recordings[0].id),/не найдена/);
 const assetHashes=new Set();
 for(const track of recordings){const actual=loadRecordedTrack(track.id);assert.ok(Math.abs(actual.duration-track.duration)<1/SR,'Registry duration matches decoded sample frames');const wav=createSoundtrack({duration:2,experiment:'blank',audioPreset:'pulse',musicTrack:track.id,soundDesign:{musicGain:.5,effectsGain:0,ducking:0},takes:[{start:0,duration:2,frames:[],impacts:[]}]}),pcm=decode(wav);for(const channel of ['left','right'])assert.ok(Math.abs(sample(pcm,1.2,channel)-actual[channel][Math.floor(1.2*SR)]*.5)<1/32767,'The production mixer uses bundled recorded samples');assert.ok(wav.subarray(44).some(v=>v!==0),'Bundled recording is audible');assetHashes.add(createHash('sha256').update(wav).digest('hex'));}assert.equal(assetHashes.size,4,'Each curated recording keeps its own sound');
 console.log('Recorded audio passed: 4 curated IDs + 32 preserved, actual stereo PCM, source/dist loading, continuous movie clock, gain/fades/ducking/cut breath, tail silence, missing-file failure, no FFmpeg.');
}finally{rmSync(temp,{recursive:true,force:true});}
