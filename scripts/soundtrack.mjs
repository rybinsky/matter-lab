import {getTrack} from '../src/tracks.js';
import {loadRecordedTrack} from './recorded-audio.mjs';
import {normalizeSoundDesign,selectSoundEvents,soundActivitySegments,soundTakeTimings} from '../src/sound-design.js';

// Bundled recordings or the original procedural score, plus sparse dry contact
// cues. No automatic gain-up of quiet passages or unrequested scene-wide hiss.
const SR=32000,TAU=Math.PI*2,SCORE_LEVEL=4;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const smooth=t=>{const x=clamp(t,0,1);return x*x*(3-2*x);};
const timbres={
 wood:{frequency:185,decay:.037,ratios:[1,1.57,2.23],weights:[1,.42,.2],tail:.18},
 metal:{frequency:510,decay:.10,ratios:[1,2.73,4.91],weights:[1,.36,.13],tail:.34},
 ceramic:{frequency:1120,decay:.054,ratios:[1,1.51,2.07,2.79],weights:[1,.34,.18,.08],tail:.24},
 rubber:{frequency:112,decay:.045,ratios:[1,2.03,3.02],weights:[1,.22,.07],tail:.22},
 soft:{frequency:71,decay:.028,ratios:[1,1.92],weights:[1,.12],tail:.14},
};

export function createSoundtrack(data={}, {loadRecording=loadRecordedTrack}={}){
 const duration=clamp(finite(data.duration),0,600),n=Math.ceil(duration*SR);
 const musicL=new Float32Array(n),musicR=new Float32Array(n),effectL=new Float32Array(n),effectR=new Float32Array(n);
 const design=normalizeSoundDesign(data.soundDesign||data.story?.soundDesign||data.story?.audio),track=getTrack(data.musicTrack);
 const kind=data.audioPreset==='none'?'none':track?.mood||(data.audioPreset==='auto'||!data.audioPreset?(data.experiment==='orbit'?'space':data.experiment==='mechanism'?'pulse':'minimal'):data.audioPreset);
 const events=selectSoundEvents(data,design),timings=soundTakeTimings(data);
 let seed=track?.seed||87231;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 function voice(at,length,frequency,amplitude,pan=0,type='pluck'){
  if(at>=duration||length<=0||amplitude<=0)return;
  const start=Math.max(0,Math.floor(at*SR)),end=Math.min(n,Math.ceil((at+length)*SR)),l=Math.cos((pan+1)*Math.PI/4),r=Math.sin((pan+1)*Math.PI/4);
  for(let i=start;i<end;i++){
   const t=i/SR-at,remaining=(end-i)/SR;if(t<0)continue;let sample=0;
   if(type==='pad')sample=(Math.sin(TAU*frequency*t)+.16*Math.sin(TAU*frequency*2.001*t))*smooth(t/.5)*smooth(remaining/.65)*.7;
   else if(type==='kick'){const phase=TAU*(frequency*t+2.9*(1-Math.exp(-t*32)));sample=Math.sin(phase)*Math.exp(-t*23)*smooth(t/.001)*smooth(remaining/.009);}
   else if(type==='rim')sample=(Math.sin(TAU*frequency*t)+.28*Math.sin(TAU*frequency*1.61*t))*Math.exp(-t*75)*smooth(t/.001)*smooth(remaining/.006);
   else{const envelope=smooth(t/.003)*Math.exp(-t/(length*.19))*smooth(remaining/.035);sample=(Math.sin(TAU*frequency*t)+.15*Math.sin(TAU*frequency*2*t)+.035*Math.sin(TAU*frequency*3*t))*envelope;}
   musicL[i]+=sample*amplitude*l;musicR[i]+=sample*amplitude*r;
  }
 }
 if(kind!=='none'&&design.musicGain>0&&track?.recording){
  const recording=loadRecording(track.id);
  if(recording.sampleRate!==SR||!(recording.left instanceof Float32Array)||!(recording.right instanceof Float32Array)||!Number.isInteger(recording.frames)||recording.frames<1||recording.left.length!==recording.frames||recording.right.length!==recording.frames)throw new Error('Запись музыки имеет неподдерживаемый формат PCM.');
  const end=Math.min(n,recording.frames),short=recording.frames<n;
  // The score bus has a fixed ×4 calibration for synthesis. Recorded masters
  // already have their own level: compensate before the shared bus, preserving
  // gain, fades, contact ducking and absolute movie time without a clip restart.
  for(let i=0;i<end;i++){const tail=short?smooth((recording.frames-i)/SR/.26):1;musicL[i]=recording.left[i]*tail/SCORE_LEVEL;musicR[i]=recording.right[i]*tail/SCORE_LEVEL;}
 }else if(kind!=='none'&&design.musicGain>0){
  const transpose=2**((track?.key||0)/12),chords=[[130.813,164.814,195.998,293.665],[146.832,195.998,220,293.665],[164.814,220,261.626,329.628],[130.813,195.998,261.626,329.628]].map(c=>c.map(f=>f*transpose));
  const bpm=track?.bpm||(kind==='pulse'?108:kind==='space'?88:96),beat=60/bpm,barLength=beat*4,pattern=track?.pattern||0;
  const arpeggios=[[0,null,2,1,null,3,1,null],[0,1,null,3,2,null,1,null],[2,null,0,3,null,1,3,null],[0,3,2,null,1,null,2,null]];
  for(let bar=0;bar*barLength<duration;bar++){
   const at=bar*barLength,chord=chords[(Math.floor(bar/2)+pattern)%4];
   if(kind==='space'||kind==='ambient')for(let j=0;j<3;j++)voice(at,barLength*1.15,chord[j],kind==='space'?.025:.018,(j-1)*.5,'pad');
   for(let slot=0;slot<8;slot++){
    const when=at+slot*beat*.5,note=arpeggios[pattern][slot];
    if(note!==null&&!(bar%4===3&&slot>4))voice(when+.035,kind==='ambient'?1.3:kind==='space'?1.0:.62,chord[note]*(slot===6?2:1),kind==='pulse'?.105:kind==='minimal'?.09:.055,Math.sin((bar*8+slot)*1.7)*.34);
   }
   if(kind==='pulse'||kind==='minimal'){
    voice(at,.25,49,kind==='pulse'?.135:.075,0,'kick');
    if(kind==='pulse')voice(at+beat*2,.24,49,.105,0,'kick');
    voice(at+beat*2,.065,kind==='pulse'?320:220,kind==='pulse'?.052:.025,.1,'rim');
    if(kind==='pulse'&&bar%2===0)voice(at+beat*3.5,.035,1250,.009,-.14,'rim');
    voice(at+.025,barLength*.78,chord[0]/2,kind==='pulse'?.065:.038,0);
   }
  }
 }
 // Timbres use damped modes, not broadband hiss. Pan follows supplied geometry;
 // there are no random left/right jumps unrelated to the picture.
 if(design.effectsGain>0)for(const[eventIndex,event]of events.entries()){
  const timbre=timbres[event.material]||timbres.wood,strength=Math.sqrt(event.strength),pitch=.94+.12*((eventIndex*17+7)%29)/28;
  const frequency=timbre.frequency*pitch*(.9+.15*strength),length=timbre.tail,start=Math.max(0,Math.floor(event.t*SR)),end=Math.min(n,Math.ceil((event.t+length)*SR));
  const gain=(.07+.36*strength)*design.effectsGain,l=Math.cos((event.pan+1)*Math.PI/4),r=Math.sin((event.pan+1)*Math.PI/4);
  for(let i=start;i<end;i++){
   const t=i/SR-event.t;if(t<0)continue;let value=0;
   for(let k=0;k<timbre.ratios.length;k++){
    const decay=timbre.decay/(1+k*.65),phase=event.material==='rubber'?TAU*frequency*(t+.012*(1-Math.exp(-t*55))):TAU*frequency*t;
    value+=Math.sin(phase*timbre.ratios[k])*timbre.weights[k]*Math.exp(-t/decay);
   }
   value*=smooth(t/.0015)*smooth((end-i)/SR/.015)*gain;effectL[i]+=value*l;effectR[i]+=value*r;
  }
 }
 // Ambience is opt-in and requires an explicit physical activity envelope.
 // It is low, band-limited, gated to motion and below the score.
 for(const segment of soundActivitySegments(data,design)){
  const start=Math.max(0,Math.floor(segment.start*SR)),end=Math.min(n,Math.ceil(segment.end*SR)),length=segment.end-segment.start;let lp1=0,lp2=0,lp3=0;
  for(let i=start;i<end;i++){
   const t=i/SR-segment.start,k=Math.min(segment.levels.length-1,Math.floor(t*segment.fps)),level=segment.levels[k]||0,envelope=smooth(t/.035)*smooth((length-t)/.055)*level*design.ambienceGain;let value=0;
   if(segment.kind==='motor')value=(Math.sin(TAU*62*t)+.2*Math.sin(TAU*124*t))*.014*envelope;
   else{lp1+=.075*((random()*2-1)-lp1);lp2+=.075*(lp1-lp2);lp3+=.075*(lp2-lp3);const bubble=Math.sin(TAU*(segment.kind==='boil'?260:185)*t+1.6*Math.sin(TAU*3.1*t));value=(lp3*.045+bubble*.007)*envelope;}
   effectL[i]+=value*.72;effectR[i]+=value*.66;
  }
 }
 // Contacts briefly open a pocket in the score. The effects bus is never
 // compressed upward, so silence stays digital silence.
 const duck=new Float32Array(n);duck.fill(1);
 if(kind!=='none'&&design.ducking>0)for(const event of events){
  const start=Math.max(0,Math.floor((event.t-.035)*SR)),end=Math.min(n,Math.ceil((event.t+.34)*SR));
  for(let i=start;i<end;i++){const t=i/SR-event.t,envelope=t<0?smooth((t+.035)/.035):1-smooth(t/.34),gain=1-design.ducking*Math.sqrt(event.strength)*envelope;duck[i]=Math.min(duck[i],gain);}
 }
 const left=new Float32Array(n),right=new Float32Array(n);let peak=0;
 for(let i=0;i<n;i++){
  const t=i/SR,fade=smooth(t/.08)*smooth((duration-t)/.26);let breath=1;
  for(let j=1;j<timings.length;j++){const d=t-timings[j].start;if(d>-.075&&d<.045)breath=Math.min(breath,d<0?smooth(-d/.075):smooth(d/.045));}
  // Fixed score calibration leaves the export normalizer only a few dB to do;
  // it is not a peak-driven gain-up of effects or quiet/no-event scenes.
  const musicGain=SCORE_LEVEL*design.musicGain*duck[i]*fade*breath;left[i]=musicL[i]*musicGain+effectL[i];right[i]=musicR[i]*musicGain+effectR[i];peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
 }
 const gain=peak>.88?.88/peak:1;
 const bytes=Buffer.alloc(44+n*4);bytes.write('RIFF',0);bytes.writeUInt32LE(36+n*4,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(SR,24);bytes.writeUInt32LE(SR*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(n*4,40);
 for(let i=0;i<n;i++){bytes.writeInt16LE(Math.round(clamp(left[i]*gain,-1,1)*32767),44+i*4);bytes.writeInt16LE(Math.round(clamp(right[i]*gain,-1,1)*32767),46+i*4);}
 return bytes;
}
