// Mix controls and event selection are independent of any particular scene.
// Gains are linear. "none" in audioPreset disables music, not contact effects.
const finite=(value,fallback)=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function normalizeSoundDesign(input={}){
 const s=input&&typeof input==='object'?input:{};
 return{
  musicGain:clamp(finite(s.musicGain,.85),0,1.5),effectsGain:clamp(finite(s.effectsGain,.9),0,1.5),
  ambience:s.ambience==='activity'?'activity':'off',ambienceGain:clamp(finite(s.ambienceGain,.12),0,.4),
  ducking:clamp(finite(s.ducking,.55),0,.9),minStrength:clamp(finite(s.minStrength,.035),0,1),
  minEventGap:clamp(finite(s.minEventGap,.12),.06,.5),sameContactGap:clamp(finite(s.sameContactGap,.48),.12,1.5),
  maxEventsPerSecond:clamp(Math.floor(finite(s.maxEventsPerSecond,4)),1,12),vacuum:s.vacuum===true,
 };
}
export function materialTimbre(material){
 const key=String(material||'').toLowerCase();
 if(['metal','steel','aluminium','aluminum'].includes(key))return'metal';
 if(['ceramic','glass','ice','stone'].includes(key))return'ceramic';
 if(key==='rubber')return'rubber';
 if(['jelly','foam','clay','soft','water','oil','honey'].includes(key))return'soft';
 return'wood';
}
export function soundTakeTimings(data){
 const takes=data.takes||[],fps=finite(data.fps,24)>0?finite(data.fps,24):24;let offset=0;
 return takes.map(take=>{const length=Array.isArray(take.frames)&&take.frames.length?take.frames.length/fps:Math.max(0,finite(take.duration,finite(data.duration,0)/Math.max(1,takes.length)));const start=Number.isFinite(take.start)?take.start:offset;offset=start+length;return{take,start,length,fps};});
}
function frameAt(timing,time){const frames=timing.take.frames||[];return frames[clamp(Math.floor((time-timing.start)*timing.fps),0,Math.max(0,frames.length-1))];}
function inferredMaterial(impact,timing,frame){
 if(impact.targetMaterial||impact.material)return materialTimbre(impact.targetMaterial||impact.material);
 const participants=impact.participants||frame?.event?.participants||[],materials=participants.map(id=>timing.take.entities?.find(e=>e.id===id)?.material).filter(Boolean);
 // Designed material cues, not a computed acoustic solution.
 if(materials.some(m=>['wood','cork'].includes(m)))return'wood';
 if(materials.some(m=>['ceramic','glass','ice'].includes(m)))return'ceramic';
 if(materials.some(m=>m==='rubber'))return'rubber';
 return materialTimbre(materials[0]||timing.take.settings?.material);
}
/** Impact t is already on the absolute movie clock. localTime is opt-in. */
export function selectSoundEvents(data,settings=normalizeSoundDesign(data.soundDesign)){
 if(settings.vacuum||data.experiment==='orbit')return[];
 const duration=Math.max(0,finite(data.duration,0)),buckets=new Map();
 for(const[takeIndex,timing]of soundTakeTimings(data).entries())for(const impact of timing.take.impacts||[]){
  const t=Number.isFinite(impact.localTime)?timing.start+impact.localTime:Number(impact.t),strength=clamp(finite(impact.strength,.1),0,1);
  if(!Number.isFinite(t)||t<0||t>=duration||strength<settings.minStrength)continue;
  const frame=frameAt(timing,t);if(frame?.editorial?.summary?.length)continue;
  if(frame?.stats?.moving===0&&Number.isFinite(frame.stats.energy)&&frame.stats.energy<.003)continue;
  const participants=Array.isArray(impact.participants)?impact.participants.map(String).sort():[];
  const contact=participants.length?`${takeIndex}:${participants.join('|')}`:`${takeIndex}:unknown`;
  const event={t,strength,material:inferredMaterial(impact,timing,frame),pan:clamp(finite(impact.pan,0),-1,1),contact,takeIndex};
  // Solver contacts arrive at 120 Hz. Retain one onset per contact window.
  const key=contact+':'+Math.floor(t/.065),previous=buckets.get(key);
  if(!previous||event.strength>previous.strength)buckets.set(key,event);
 }
 const events=[],lastByContact=new Map();
 for(const event of [...buckets.values()].sort((a,b)=>a.t-b.t||b.strength-a.strength)){
  const last=events.at(-1),same=lastByContact.get(event.contact);
  if(last&&event.t-last.t<settings.minEventGap)continue;
  if(same&&event.t-same.t<settings.sameContactGap)continue;
  if(events.filter(e=>event.t-e.t<1).length>=settings.maxEventsPerSecond)continue;
  events.push(event);lastByContact.set(event.contact,event);
 }
 return events;
}
/** Optional ambience requires explicit measured activity, never a scene name.
 * frame.audioActivity = {kind:'flow'|'boil'|'motor',level:0..1}.
 * Frozen/reversed source frames and comparison cards are silent.
 */
export function soundActivitySegments(data,settings=normalizeSoundDesign(data.soundDesign)){
 if(settings.ambience!=='activity'||settings.vacuum||data.experiment==='orbit')return[];
 const segments=[];
 for(const timing of soundTakeTimings(data)){
  let previousSource=-Infinity,segment=null;
  for(const[index,frame]of(timing.take.frames||[]).entries()){
   const activity=frame.audioActivity||frame.stats?.audioActivity,source=Number.isFinite(frame.sourceTime)?frame.sourceTime:frame.stats?.time;
   const advances=!Number.isFinite(source)||source>previousSource+1e-8;previousSource=Number.isFinite(source)?source:previousSource;
   const level=activity&&['flow','boil','motor'].includes(activity.kind)?clamp(finite(activity.level,0),0,1):0,start=timing.start+index/timing.fps;
   if(!advances||level<=0||frame.editorial?.summary?.length||frame.beat==='result'){segment=null;continue;}
   if(!segment||segment.kind!==activity.kind||Math.abs(segment.end-start)>1e-7){segment={start,end:start,kind:activity.kind,levels:[],fps:timing.fps};segments.push(segment);}
   segment.levels.push(level);segment.end=start+1/timing.fps;
  }
 }
 return segments;
}
