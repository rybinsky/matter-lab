// Editing a simulation never changes it. These mappings select cached moments
// so a contact can open the film, then be shown in its full causal context.
const clamp=x=>Math.max(0,Math.min(1,x));
const lerp=(a,b,t)=>a+(b-a)*clamp(t);
// Frame budgets are integers so a comparison stays exactly on its delivery
// duration. A negative control is still observed for the full physical window;
// only its screen time is reduced. Domain-specific motion is never classified
// from a flat scalar metric (a circular orbit is a useful counterexample).
export function allocateTakeFrames({duration=60,fps=30,takes=[],autoTrim=true}){
 const total=Math.round(duration*fps),count=takes.length;
 if(!count)return{frames:[],shortened:false};
 const equal=Array.from({length:count},(_,i)=>Math.floor(total/count)+(i<total%count?1:0));
 if(!autoTrim||count<2)return{frames:equal,shortened:false};
 const controls=takes.map(t=>t.isControl===true);
 if(!controls.some(Boolean))return{frames:equal,shortened:false};
 const frames=equal.map((n,i)=>controls[i]?Math.min(n,Math.round((i===count-1?6:3.2)*fps)):0);
 const active=controls.flatMap((c,i)=>c?[]:[i]);
 if(!active.length)return{frames,shortened:frames.reduce((a,b)=>a+b,0)<total};
 const remaining=total-frames.reduce((a,b)=>a+b,0);
 active.forEach((index,i)=>frames[index]=Math.floor(remaining/active.length)+(i<remaining%active.length?1:0));
 return{frames,shortened:false};
}

export function montagePlan({duration=15,maxTime=7.5,eventTime=1,opening='event',tempo='fast',resultHold}){
 const hook=opening==='event'?Math.min(1.15,duration*.09):0;
 const setup=hook+Math.min(1.0,duration*.07),end=duration-Math.min(resultHold??2.6,duration*(resultHold? .45:.20));
 const event=Math.max(.12,Math.min(maxTime-.2,eventTime)),slow=tempo==='calm'?2.0:1.25;
 const eventMovie=setup+(end-setup)*Math.max(.18,Math.min(.78,event/maxTime));
 const half=Math.min(slow/2,(eventMovie-setup)*.7,(end-eventMovie)*.7);
 const points=[[setup,0],[eventMovie-half,Math.max(0,event-.16)],[eventMovie+half,Math.min(maxTime,event+.16)],[end,maxTime]];
 function at(time){
  if(time<hook)return{source:lerp(Math.max(0,event-.12),Math.min(maxTime,event+.10),time/hook),beat:'hook',cut:time===0};
  if(time<setup)return{source:lerp(0,Math.min(.12,event*.15),(time-hook)/(setup-hook)),beat:'context',cut:time-hook<.05};
  if(time>=end)return{source:maxTime,beat:'result',cut:false};
  for(let i=1;i<points.length;i++)if(time<=points[i][0]){const [a,b]=[points[i-1],points[i]];const source=lerp(a[1],b[1],(time-a[0])/(b[0]-a[0]));return{source,beat:Math.abs(source-event)<.22?'impact':source<event?'anticipation':'follow',cut:time-setup<.05};}
  return{source:maxTime,beat:'result',cut:false};
 }
 function timesFor(source){
  const result=[];if(source>=event-.12&&source<=event+.10&&hook)result.push(hook*(source-event+.12)/.22);
  for(let i=1;i<points.length;i++){const [a,b]=[points[i-1],points[i]];if(source>=a[1]&&source<b[1]){result.push(lerp(a[0],b[0],(source-a[1])/(b[1]-a[1])));break;}}
  return result;
 }
 return{at,timesFor,eventMovie,hook,setup,end};
}
