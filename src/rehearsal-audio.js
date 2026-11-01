// Audio timing is independent of DOM, styles and the rendering backend.
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
export function rehearsalAudioPlan({time=0,duration=0,rate=1,audioTime=0,playing=false,enabled=false,force=false}={}){
 const end=Math.max(0,finite(duration));
 const currentTime=clamp(finite(time),0,Math.max(0,end-.001)),playbackRate=clamp(finite(rate,1),.25,4);
 return{currentTime,playbackRate,muted:!enabled,play:!!playing&&!!enabled&&end>0,seek:!!force||!Number.isFinite(audioTime)||Math.abs(audioTime-currentTime)>.075};
}
