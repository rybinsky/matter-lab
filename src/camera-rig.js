// Camera takes are authoring data. Movie time and physical time are deliberately
// independent: an operator can pause physics and continue a camera move.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const vector=(v,d=[0,0,0])=>[0,1,2].map(i=>clamp(finite(v?.[i],d[i]),-1e8,1e8));
const lerp=(a,b,t)=>a+(b-a)*t;
const attentionIds=input=>[...new Set((Array.isArray(input)?input:[]).filter(id=>typeof id==='string'&&id.trim()).map(id=>id.slice(0,160)))];
const transition=value=>['smooth','linear','cut'].includes(value)?value:'smooth';
export const CAMERA_ATTENTION_LIMITS={ids:16,mix:32,mixIdReferences:64};
function normalizedMix(input){
 if(!Array.isArray(input))return[];
 const groups=new Map();
 for(const descriptor of input){
  if(!descriptor||typeof descriptor!=='object')continue;
  const weight=finite(descriptor.weight);if(weight<=0)continue;
  const ids=attentionIds(descriptor.ids).sort();
  if(ids.length>CAMERA_ATTENTION_LIMITS.ids)throw new Error('У цели камеры должно быть не больше 16 предметов.');
  const offset=vector(descriptor.offset),target=vector(descriptor.target),key=JSON.stringify(ids),previous=groups.get(key);
  if(previous){const total=previous.weight+weight;for(let k=0;k<3;k++){previous.offset[k]=(previous.offset[k]*previous.weight+offset[k]*weight)/total;previous.target[k]=(previous.target[k]*previous.weight+target[k]*weight)/total;}previous.weight=total;}
  else groups.set(key,{weight,ids,offset,target});
 }
 const result=[...groups.values()],references=result.reduce((sum,d)=>sum+d.ids.length,0);
 if(result.length>CAMERA_ATTENTION_LIMITS.mix||references>CAMERA_ATTENTION_LIMITS.mixIdReferences)throw new Error('Смесь целей камеры слишком сложная: допускается 32 группы и 64 ссылки на предметы.');
 const total=result.reduce((sum,d)=>sum+d.weight,0);
 return result.map(d=>({...d,weight:d.weight/total}));
}
function attentionFields(point){
 const ids=attentionIds(point.attentionIds),mix=normalizedMix(point.attentionMix);
 if(ids.length>CAMERA_ATTENTION_LIMITS.ids)throw new Error('У цели камеры должно быть не больше 16 предметов.');
 return{
  ...(Array.isArray(point.attentionIds)?{attentionIds:ids}:{}),
  ...(ids.length?{attentionOffset:vector(point.attentionOffset)}:{}),
  ...(ids.length||point.attentionTransition!==undefined?{attentionTransition:transition(point.attentionTransition)}:{}),
  ...(mix.length?{attentionMix:mix}:{}),
 };
}
const hasAttention=point=>point.attentionIds?.length||point.attentionMix?.length;
const pointMix=point=>point.attentionMix?.length?point.attentionMix:[{weight:1,ids:point.attentionIds||[],offset:point.attentionOffset||[0,0,0],target:point.target}];
export function normalizeCameraRig(input={}){
 const modes=['auto','static','recorded','keys'],mode=modes.includes(input.mode)?input.mode:'auto';
 const ordered=(Array.isArray(input.points)?input.points:[]).slice(0,3601).map((p,i)=>({
  time:clamp(finite(p.time,i),0,120),sourceTime:clamp(finite(p.sourceTime,p.time),0,20),
  position:vector(p.position,[6,4,8]),target:vector(p.target),fov:clamp(finite(p.fov,40),20,75),
  cut:p.cut===true,
  ...attentionFields(p),
 })).sort((a,b)=>a.time-b.time);
 const points=[];for(const p of ordered){if(points.length&&Math.abs(points.at(-1).time-p.time)<.0001)points[points.length-1]=p;else points.push(p);}
 return{version:1,mode,anchorId:String(input.anchorId||'').slice(0,160),
  interpolation:input.interpolation==='linear'?'linear':'smooth',
  duration:points.length?Math.max(.1,points.at(-1).time):Math.max(.1,finite(input.duration,20)),points};
}
function samplerForNormalizedRig(rig,{resolveTarget:defaultResolver}={}){
 const points=rig.points;
 if(!points.length)return()=>null;
 return(time,anchor=[0,0,0],context={})=>{
 const t=clamp(finite(time),points[0].time,points.at(-1).time);
 // Greatest segment-start key <= t. Unlike a forward cursor this also works
 // when an author seeks backwards or the source clock rewinds.
 let i=0,hi=Math.max(0,points.length-2);
 while(i<hi){const mid=Math.ceil((i+hi)/2);if(points[mid].time<=t)i=mid;else hi=mid-1;}
 const a=points[i],b=points[Math.min(i+1,points.length-1)],u=b.time>a.time?clamp((t-a.time)/(b.time-a.time),0,1):0;
 const atCut=b.cut&&u<1,blend=atCut?0:u;
 const curve=(key,axis)=>{
  if(rig.interpolation==='linear'||atCut||points.length<3)return lerp(a[key][axis],b[key][axis],blend);
  const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+2)],dt=b.time-a.time;
  const va=(b[key][axis]-before[key][axis])/Math.max(.001,b.time-before.time)*dt;
  const vb=(after[key][axis]-a[key][axis])/Math.max(.001,after.time-a.time)*dt;
  const s=u*u,s3=s*u,value=(2*s3-3*s+1)*a[key][axis]+(s3-2*s+u)*va+(-2*s3+3*s)*b[key][axis]+(s3-s)*vb;
  return clamp(value,Math.min(a[key][axis],b[key][axis]),Math.max(a[key][axis],b[key][axis]));
 };
 const origin=rig.anchorId?vector(anchor):[0,0,0];
 const sourceTime=lerp(a.sourceTime,b.sourceTime,u);
 let target=[0,1,2].map(k=>curve('target',k)+origin[k]),mix,missing=[];
 if(hasAttention(a)||hasAttention(b)){
  const method=transition(b.attentionTransition),weight=atCut||method==='cut'&&u<1?0:method==='linear'?u:u*u*(3-2*u);
  mix=normalizedMix([...pointMix(a).map(d=>({...d,weight:d.weight*(1-weight)})),...pointMix(b).map(d=>({...d,weight:d.weight*weight}))]);
  const resolver=context?.resolveTarget||defaultResolver;
  target=[0,0,0];
  for(const descriptor of mix){
   const positions=descriptor.ids.map(id=>{const p=typeof resolver==='function'?resolver(id,sourceTime):null;if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)){missing.push(id);return null;}return p;});
   const resolved=positions.length&&positions.every(Boolean)?[0,1,2].map(axis=>positions.reduce((sum,p)=>sum+p[axis],0)/positions.length+descriptor.offset[axis]):descriptor.target.map((value,axis)=>value+origin[axis]);
   for(let axis=0;axis<3;axis++)target[axis]+=descriptor.weight*resolved[axis];
  }
 }
 return{position:[0,1,2].map(k=>curve('position',k)+origin[k]),target,
  fov:lerp(a.fov,b.fov,blend),sourceTime,shot:'manual',
  ...(mix?{attentionMix:mix}:{}),...(missing.length?{attentionMissingIds:[...new Set(missing)]}:{}),
  hero:rig.anchorId||null,reason:rig.mode==='static'?'Ракурс автора':'Записанное движение камеры',manual:true};
 };
}
/** Snapshot the input once; recreate after authoring edits, not every frame. */
export function createCameraSampler(input={},options={}){
 return samplerForNormalizedRig(normalizeCameraRig(input),options);
}
/** Compatible one-shot API. Repeated playback should use a prepared sampler. */
export function sampleCameraRig(input,time,anchor=[0,0,0],context={}){
 return createCameraSampler(input)(time,anchor,context);
}
export function retimeCameraRig(input,duration){
 const rig=normalizeCameraRig(input),end=rig.points.at(-1)?.time||1,newEnd=clamp(finite(duration,end),.1,120);
 return normalizeCameraRig({...rig,points:rig.points.map(p=>({...p,time:p.time/end*newEnd}))});
}
export function simplifyCameraRig(input,count=12){
 if(!Number.isInteger(count)||count<2||count>3601)throw new Error('Для сокращения маршрута выберите от 2 до 3601 ключа.');
 const rig=normalizeCameraRig(input),points=rig.points;if(points.length<=count)return{...rig,mode:'keys'};
 // `count` is a soft target. Cuts and movie/source/attention boundaries take
 // precedence; sampling a cut on a uniform grid turns a change of shot into
 // an unintended camera flight. Keep original keys and interpolation instead.
 const retained=new Set([0,points.length-1]);
 const attentionSignature=point=>JSON.stringify(point.attentionMix?.length
  ?{groups:point.attentionMix.map(d=>d.ids.slice().sort()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),transition:transition(point.attentionTransition)}
  :{ids:(point.attentionIds||[]).slice().sort(),offset:point.attentionIds?.length?point.attentionOffset:null,transition:hasAttention(point)?transition(point.attentionTransition):null});
 let previousAttention=attentionSignature(points[0]);
 for(let i=1;i<points.length;i++){
  const nextAttention=attentionSignature(points[i]);
  if(points[i].cut||points[i].attentionTransition==='cut'||nextAttention!==previousAttention){retained.add(i-1);retained.add(i);}
  previousAttention=nextAttention;
  if(i<points.length-1){
   const a=points[i-1],b=points[i],c=points[i+1],expected=lerp(a.sourceTime,c.sourceTime,(b.time-a.time)/(c.time-a.time));
   if(Math.abs(b.sourceTime-expected)>1e-9)retained.add(i);
  }
 }
 const target=Math.max(count,retained.size);
 while(retained.size<target){
  const ordered=[...retained].sort((a,b)=>a-b);let gap=null;
  for(let i=1;i<ordered.length;i++){
   const left=ordered[i-1],right=ordered[i];if(right-left<2)continue;
   const duration=points[right].time-points[left].time;
   if(!gap||duration>gap.duration)gap={left,right,duration};
  }
  if(!gap)break;
  const middle=(points[gap.left].time+points[gap.right].time)/2;
  let lo=gap.left+1,hi=gap.right-1;
  while(lo<hi){const m=Math.floor((lo+hi)/2);if(points[m].time<middle)lo=m+1;else hi=m;}
  if(lo>gap.left+1&&Math.abs(points[lo-1].time-middle)<Math.abs(points[lo].time-middle))lo--;
  retained.add(lo);
 }
 // Smooth camera curves and baked attention mixtures between retained keys
 // remain an approximation. Source-clock corners and shot/target boundaries
 // retain their original times; all stored coordinates stay anchor-relative.
 return{...rig,mode:'keys',points:[...retained].sort((a,b)=>a-b).map(index=>points[index])};
}
export function cameraTrackPlan(input,duration){
 const rig=normalizeCameraRig(input),scale=rig.duration/Math.max(.01,duration),sampleAt=samplerForNormalizedRig(rig);
 const timesFor=source=>{
  const result=[];for(let i=1;i<rig.points.length;i++){
   const a=rig.points[i-1],b=rig.points[i],delta=b.sourceTime-a.sourceTime;
   // A rewind selects earlier cached pictures; it is not another physical
   // contact. Only forward playback can schedule a new sound onset.
   if(delta<=1e-8)continue;
   const u=(source-a.sourceTime)/delta;
   if(u>=0&&u<=1){let at=lerp(a.time,b.time,u);if(u<1e-8){let start=i-1;while(start>0&&Math.abs(rig.points[start-1].sourceTime-source)<1e-8)start--;at=rig.points[start].time;}const movie=at/scale;if(!result.some(t=>Math.abs(t-movie)<.0001))result.push(movie);}
  }return result;
 };
 return{at(time){const sample=sampleAt(time*scale);return{source:sample.sourceTime,beat:time<.8?'context':time>=duration-.6?'result':'follow',cut:false};},timesFor,eventMovie:null,hook:0,rigScale:scale};
}
