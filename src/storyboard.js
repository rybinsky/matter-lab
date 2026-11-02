import {READOUT_VARIABLES} from './measurement-readouts.js';
import {normalizeGraphicsStyle,normalizeCueGraphics,resolveGraphicsStyle,graphicsStyleTokens,CUE_ENTRANCES} from './graphics-style.js';
// Editorial metadata is independent of the phenomenon and the renderer.
// It labels observations supplied by the simulation; it never invents a result.
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const clean=(text,max=120)=>String(text??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0,max);
const choose=(value,values,fallback)=>values.includes(value)?value:fallback;
const vector=value=>Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value):[value?.x,value?.y,value?.z];
const magnitude=value=>{const a=vector(value);return a.length>=3&&a.every(Number.isFinite)?Math.hypot(...a):null;};
const humanNumber=(value,precision)=>Number(value).toLocaleString('ru-RU',{minimumFractionDigits:precision,maximumFractionDigits:precision});

export const STORY_THEMES=[
 {id:'contrast',name:'Контраст',description:'Крупный вопрос, яркий акцент',background:'#071218',foreground:'#F7FAF6'},
 {id:'editorial',name:'Журнал',description:'Типографика и измерения',background:'#EDEDE5',foreground:'#14242A'},
 {id:'minimal',name:'Чистый кадр',description:'Меньше текста, больше действия',background:'#14212C',foreground:'#F7FAF6'},
];
export const STORY_ACCENTS=['#D8FF5F','#FF6B4A','#66D9EF','#D9B2FF','#FFBD59'];
export const STORY_METRICS=[
 {id:'auto',name:'По доступным данным'},
 {id:'speed',name:'Скорость главного предмета'},
 {id:'distance',name:'Перемещение от старта'},
 {id:'height',name:'Высота главного предмета'},
 {id:'energy',name:'Энергия движения сцены'},
 {id:'moved',name:'Сколько предметов сместилось'},
 {id:'none',name:'Без числового показателя'},
];

export function normalizedStory(input={}){
 const s=input&&typeof input==='object'?input:{};
 const movementThreshold=s.movementThreshold===null||s.movementThreshold==='' ? .2 : finite(s.movementThreshold,.2);
 return{
  version:1,enabled:s.enabled!==false,
  title:clean(s.title,76),
  hook:clean(s.hook,80),
  question:clean(s.question,80),
  parameterLabel:typeof s.parameterLabel==='string'?clean(s.parameterLabel,120):undefined,
  takeaway:clean(s.takeaway,96),
  heroId:clean(s.heroId||s.focusId,120),
  theme:choose(s.theme,STORY_THEMES.map(t=>t.id),'contrast'),
  accent:/^#[\da-f]{6}$/i.test(s.accent||'')?s.accent:'#D8FF5F',
  graphics:normalizeGraphicsStyle(s.graphics),
  camera:choose(s.camera,['auto','follow','context','manual'],'auto'),
  duration:clamp(finite(s.duration,60),5,120),
  tempo:choose(s.tempo,['fast','normal','calm'],'fast'),
  opening:choose(s.opening,['event','question'],'event'),
  metric:choose(s.metric,STORY_METRICS.map(m=>m.id),'auto'),
  metricStart:clamp(finite(s.metricStart,0),0,120),
  captionMode:'authored',
  cues:(Array.isArray(s.cues)?s.cues:[]).filter(c=>c&&typeof c==='object').slice(0,24).map(c=>({start:clamp(finite(c.start),0,120),end:clamp(finite(c.end),0,120),text:clean(c.text,96),...(typeof c.label==='string'?{label:clean(c.label,120)}:{}),...(typeof c.hideMetric==='boolean'?{hideMetric:c.hideMetric}:{}),...(c.graphics&&typeof c.graphics==='object'&&!Array.isArray(c.graphics)?{graphics:normalizeCueGraphics(c.graphics)}:{}),...(CUE_ENTRANCES.includes(c.entrance)?{entrance:c.entrance}:{}),fade:clamp(finite(c.fade,.15),0,1)})).filter(c=>c.end>c.start&&c.text).sort((a,b)=>a.start-b.start),
  autoTrim:s.autoTrim!==false,
  movementThreshold:clamp(movementThreshold,.01,2),
  labels:{setup:clean(s.labels?.setup,58),action:clean(s.labels?.action,58),result:clean(s.labels?.result,58)},
  effects:{slowMotion:s.effects?.slowMotion!==false,heroOutline:s.effects?.heroOutline!==false,eventPulse:s.effects?.eventPulse!==false,trail:s.effects?.trail===true,reference:s.effects?.reference!==false},
 };
}

function observedMetric(story,stats,hero){
 if(story.metric==='none')return null;
 const explicit=stats.metric;
 if(story.metric==='auto'&&explicit&&typeof explicit==='object'&&explicit.value!==null&&explicit.value!==''&&Number.isFinite(Number(explicit.value))){return{value:Number(explicit.value),label:clean(explicit.label||'Измерение',42),unit:clean(explicit.unit,12),precision:clamp(Math.floor(finite(explicit.precision,1)),0,3)};}
 const speed=Number.isFinite(hero?.speed)?hero.speed:Number.isFinite(stats.heroSpeed)?stats.heroSpeed:magnitude(hero?.velocity);
 const displacement=Number.isFinite(hero?.distance)?hero.distance:Number.isFinite(stats.displacement)?stats.displacement:(hero?.position&&hero?.initialPosition?magnitude(vector(hero.position).map((v,i)=>v-vector(hero.initialPosition)[i])):null);
 const height=Number.isFinite(hero?.altitude)?hero.altitude:Number.isFinite(stats.heroHeight)?stats.heroHeight:vector(hero?.position)[1];
 const metrics={
  speed:speed===null?null:{value:speed,label:'Скорость предмета',unit:'м/с',precision:1},
  distance:displacement===null?null:{value:displacement,label:'От точки старта',unit:'м',precision:2},
  height:Number.isFinite(height)?{value:height,label:'Высота предмета',unit:'м',precision:2}:null,
  energy:Number.isFinite(stats.energy)?{value:stats.energy,label:'Энергия движения сцены',unit:'Дж',precision:1}:null,
  moved:Number.isFinite(stats.movedObjects)?{value:stats.movedObjects,label:`Хотя бы раз >${Math.round(story.movementThreshold*100)} см`,unit:'предметов',precision:0}:null,
 };
 return story.metric==='auto'?(metrics.speed||metrics.distance||metrics.moved||null):metrics[story.metric];
}

const eventLabels={impact:'Момент контакта',contact:'Момент контакта',launch:'Начинается движение',release:'Отпускаем предмет',break:'Меняется форма',settle:'Движение затихает',turn:'Меняется направление'};
function expand(template,values){return clean(template).replace(/\{([a-zA-Z]+)\}/g,(_,key)=>values[key]??'—');}

/**
 * time/duration use movie seconds, local to the current take.
 * Event time must also be in movie seconds (event.movieTime takes precedence).
 * stats.metric is the escape hatch for any measured domain-specific value:
 * {value: 42, unit: 'см', label: 'Глубина проникновения', precision: 1}.
 * Returned slowMotion/hold are editorial hints, not changes to simulated time.
 */
export function editorialFrame({story:input={},time=0,duration,stats={},hero={},event=null,takeIndex=0,takeCount=1,takeLabel=''}={}){
 const story=normalizedStory(input),length=Math.max(1,finite(duration,story.duration)),t=clamp(finite(time),0,length),p=t/length;
 const tempo={fast:{hook:.9,setup:.13,end:.89},normal:{hook:1.25,setup:.19,end:.86},calm:{hook:1.6,setup:.23,end:.84}}[story.tempo];
 const hookEnd=Math.min(tempo.hook,length*.13),setupEnd=Math.max(hookEnd,Math.min(3,length*tempo.setup));
 const resultStart=length*(story.takeaway?.length?tempo.end-.11:tempo.end),takeawayStart=length*tempo.end;
 let phase=t<hookEnd?'hook':t<setupEnd?'setup':t<resultStart?'action':story.takeaway&&t>=takeawayStart?'takeaway':'result';
 const eventAt=finite(event?.movieTime??event?.time,NaN),eventDistance=Math.abs(t-eventAt);
 const nearEvent=!!event&&Number.isFinite(eventAt)&&eventDistance<(story.tempo==='calm'?.6:.38);
 if(nearEvent&&phase!=='hook'&&phase!=='takeaway')phase='event';
 const measured=observedMetric(story,stats,hero);
 const metric=measured?humanNumber(measured.value,measured.precision):'';
 const readouts=Object.fromEntries(READOUT_VARIABLES.filter(v=>Number.isFinite(stats.readouts?.[v.id])).map(v=>[v.id,humanNumber(stats.readouts[v.id],v.precision)]));
 const values={...readouts,hero:clean(hero.name||'Предмет',44),take:clean(takeLabel,120),value:metric,unit:measured?.unit||'',label:measured?.label||'',speed:Number.isFinite(stats.heroSpeed)?humanNumber(stats.heroSpeed,1):'',height:Number.isFinite(stats.heroHeight)?humanNumber(stats.heroHeight,2):'',distance:Number.isFinite(stats.displacement)?humanNumber(stats.displacement,2):''};
 let caption=story.labels[phase]||story.labels.action;
 if(phase==='hook')caption=story.hook;
 else if(phase==='setup')caption=story.question||story.labels.setup;
 else if(phase==='event')caption=story.labels.action;
 else if(phase==='takeaway')caption=story.takeaway;
 else if(phase==='result')caption=story.labels.result;
 const eventPhase={impact:'КОНТАКТ',contact:'КОНТАКТ',launch:'ЗАПУСК',release:'ОСВОБОЖДЕНИЕ',break:'ДЕФОРМАЦИЯ',settle:'ПОКОЙ',turn:'ПОВОРОТ'};
 const phaseNames={hook:'',setup:'УСЛОВИЯ',action:'',event:eventPhase[event?.type]||'СОБЫТИЕ',result:'РЕЗУЛЬТАТ',takeaway:'ВЫВОД'};
 const metadata={
  version:1,enabled:story.enabled,phase,phaseLabel:'',theme:story.theme,accent:story.accent,graphics:story.graphics,graphicsLayout:graphicsStyleTokens(story.graphics),
  title:expand(story.title,values),hook:expand(story.hook,values),question:expand(story.question,values),takeaway:expand(story.takeaway,values),
  caption:expand(caption,values),metric,metricUnit:measured?.unit||'',metricLabel:measured?.label||'',metricValue:measured?.value??null,hideMetric:t<story.metricStart,
  heroId:story.heroId||hero.id||'',heroName:values.hero,takeLabel:values.take,takeIndex:Math.max(0,Math.floor(finite(takeIndex))),takeCount:Math.max(1,Math.floor(finite(takeCount,1))),
  progress:p,camera:story.camera,tempo:story.tempo,teaser:phase==='hook'&&story.opening==='event',allowAction:true,
  // Action starts immediately. A teaser may use an observed event frame; the
  // capture/editor chooses that frame rather than waiting for the event.
  hold:(phase==='result'||phase==='takeaway') ? .35 : 0,
  slowMotion:(story.effects.slowMotion&&nearEvent) ? .35 : 1,
  effects:{heroOutline:story.effects.heroOutline,eventPulse:story.effects.eventPulse&&nearEvent?Math.max(0,1-eventDistance/.38):0,trail:story.effects.trail,reference:story.effects.reference&&(phase==='result'||phase==='takeaway')},
  textBudget:{captionWords:6,metricLabelWords:5,titleLines:2,captionLines:2},
  safeArea:{top:.075,right:.075,bottom:.12,left:.075},
 };
 if(story.cues.length){
  const cue=story.cues.find(c=>t>=c.start&&t<c.end),fade=cue?Math.min(cue.fade,(cue.end-cue.start)/2):0;
  const entrance=cue?.entrance||'fade',opacity=!cue?0:entrance==='cut'?1:fade>0?Math.max(0,Math.min(1,(t-cue.start)/fade,(cue.end-t)/fade)):1;
  const graphics=resolveGraphicsStyle(story.graphics,cue?.graphics),graphicsLayout=graphicsStyleTokens(graphics);
  // Reserve the incoming rise at the bottom edge; the complete moving block
  // stays in the same 1080×1920 safe region as the settled caption.
  if(entrance==='rise'&&graphics.position==='bottom')graphicsLayout.anchorY-=32;
  const entry=cue&&fade>0?clamp((t-cue.start)/fade,0,1):1,captionOffsetY=cue&&entrance==='rise'?32*(1-entry)**3:0;
  return{...metadata,graphics,graphicsLayout,phase:'action',phaseLabel:'',hook:'',question:'',takeaway:'',caption:cue?expand(cue.text,values):'',cue:!!cue,captionOpacity:opacity,captionOffsetY,captionEntrance:entrance,...(cue?.label!==undefined?{takeLabel:expand(cue.label,values)}:{}),...(cue?.hideMetric!==undefined?{hideMetric:cue.hideMetric}:{})};
 }
 return metadata;
}
