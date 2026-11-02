import {normalizeCameraRig} from './camera-rig.js';
import {setFilmClipTiming} from './film.js';
/** Describe the authored physical source clock, never the motion of the body. */
export function clipTempo(project){
 const rig=normalizeCameraRig(project.settings?.cameraRig);
 if(!['keys','recorded'].includes(rig.mode)||rig.points.length<2)return{kind:'auto',label:'Автоматический монтаж'};
 const rates=[];let holds=false,reverse=false;
 for(let i=1;i<rig.points.length;i++){
  const a=rig.points[i-1],b=rig.points[i];if(b.cut)continue;
  const dt=b.time-a.time,ds=b.sourceTime-a.sourceTime;if(dt<=0)continue;
  if(Math.abs(ds)<1e-9)holds=true;else if(ds<0)reverse=true;else rates.push(ds/dt);
 }
 if(!rates.length&&!reverse)return{kind:'freeze',label:'Стоп-кадр'};
 if(reverse||holds||rates.some(r=>Math.abs(r-rates[0])>Math.max(1e-6,Math.abs(rates[0])*1e-5)))return{kind:'variable',label:'Переменная скорость'};
 const rate=rates[0],sourceSpan=rig.points.at(-1).sourceTime-rig.points[0].sourceTime;
 return{kind:'uniform',rate,sourceSpan,duration:rig.duration,label:Math.abs(rate-1)<1e-6?'Реальная скорость':`Темп ×${Number(rate.toFixed(2)).toLocaleString('ru-RU')}`};
}
export function setClipPlaybackSpeed(project,rate){
 if(!Number.isFinite(rate)||rate<.1||rate>8)throw Error('Темп клипа: выберите скорость от ×0,1 до ×8.');
 const tempo=clipTempo(project);if(tempo.kind!=='uniform')throw Error('У этого клипа переменная скорость или стоп-кадр. Измените ключи камеры вручную.');
 const duration=tempo.sourceSpan/rate;if(duration<.1||duration>120)throw Error('При этом темпе длительность выйдет за пределы 0,1–120 секунд.');
 return setFilmClipTiming(project,{duration});
}
