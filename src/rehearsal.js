import {rehearsalAudioPlan} from './rehearsal-audio.js';
export {rehearsalAudioPlan} from './rehearsal-audio.js';
import './rehearsal.css';
import {fitGraphicsHeadline} from './caption-layout.js';
import {normalizeGraphicsStyle,graphicsStyleTokens,graphicsStyleVariables,graphicsPalette} from './graphics-style.js';
import './graphics-style.css';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim();
const concise=(value,budget)=>{const parts=clean(value).split(/\s+/).filter(Boolean);return parts.length>budget?parts.slice(0,budget).join(' ')+'…':parts.join(' ');};
const movieTime=t=>{const seconds=Math.max(0,finite(t));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')}`;};
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;

// Presentation-only copy: an older capture may still carry hero/event effects
// on its comparison card. Do not mutate the cached frame or its physical data.
export function frameForRehearsal(frame){
 const summary=frame?.editorial?.summary;
 if(!Array.isArray(summary)||!summary.some(row=>row&&typeof row==='object'))return frame;
 return{...frame,camera:frame.camera?{...frame.camera,marker:false,label:''}:frame.camera,editorial:{...frame.editorial,effects:{...frame.editorial.effects,heroOutline:false,eventPulse:0}}};
}

// Audio follows the absolute movie clock, including cuts and replayed source
// time. It never supplies the clock, so a blocked/buffering player cannot stop
// the visual rehearsal. A seek is corrected only when drift exceeds 75 ms.

/**
 * Plays the actual captured scene in the existing viewport. It does not edit the
 * project or run a second simulation. onLoadTake/onFrame consume capture data.
 * Prefer synchronous scene callbacks; asynchronous onLoadTake is also supported.
 */
export function mountRehearsal({getProject,onLoadTake,onFrame,onStop=()=>{},notify=()=>{},icons=()=>{}}){
 if(typeof getProject!=='function'||typeof onLoadTake!=='function'||typeof onFrame!=='function')throw new Error('Rehearsal needs project and recorded-scene callbacks');
 const $=id=>document.getElementById(id),wrap=$('viewport-wrap'),viewport=$('viewport');
 if(!wrap||!viewport)throw new Error('Rehearsal needs the laboratory viewport');
 if($('rehearsal-toolbar'))throw new Error('Rehearsal is already mounted');
 const film=document.createElement('div');film.className='film-frame';film.id='film-frame';viewport.before(film);film.appendChild(viewport);
 film.insertAdjacentHTML('beforeend',`<div class="rehearsal-overlay" id="rehearsal-overlay" hidden data-theme="contrast"><div class="graphics-scrim graphics-title-scrim"></div><div class="graphics-scrim graphics-metric-scrim"></div><div class="rehearsal-take-number graphics-counter" id="rehearsal-take-number"></div><div class="rehearsal-phase" id="rehearsal-phase"></div><div class="rehearsal-title-block graphics-title"><div class="graphics-rule" aria-hidden="true"></div><div class="rehearsal-headline graphics-headline" id="rehearsal-headline"></div><div class="rehearsal-take-label graphics-condition" id="rehearsal-take-label"></div></div><div class="rehearsal-summary" id="rehearsal-summary" hidden></div><div class="rehearsal-measurement graphics-measurement" id="rehearsal-measurement"><div class="rehearsal-metric-label graphics-metric-label" id="rehearsal-metric-label"></div><div class="rehearsal-value-row graphics-value-row"><span id="rehearsal-metric"></span><small id="rehearsal-metric-unit"></small></div></div><div class="rehearsal-caption" id="rehearsal-caption" hidden></div><div class="rehearsal-film-bottom"><div class="rehearsal-film-progress" id="rehearsal-film-progress"></div><div class="rehearsal-film-time"><span id="rehearsal-movie-time"></span><span id="rehearsal-movie-duration"></span></div></div><div class="rehearsal-pulse" id="rehearsal-pulse"></div></div>`);
 wrap.insertAdjacentHTML('beforeend',`<div class="rehearsal-toolbar" id="rehearsal-toolbar" hidden><span class="rehearsal-status-tag">РЕПЕТИЦИЯ</span><button class="toolbar-button rehearsal-report-button" id="rehearsal-report-button">${icon('scan-eye')}Проверка кадра</button><button class="toolbar-button rehearsal-close" id="rehearsal-close" aria-label="Выйти из репетиции">${icon('x')}</button></div><div class="rehearsal-loading" id="rehearsal-loading" hidden><div class="rehearsal-loading-card"><div class="rehearsal-loading-icon">${icon('clapperboard')}</div><h3 id="rehearsal-loading-title">Собираем репетицию</h3><p id="rehearsal-loading-copy">Рассчитываем движение, камеру и подписи. Сцена в проекте остаётся без изменений.</p><div class="rehearsal-loading-progress" id="rehearsal-loading-progress"><div id="rehearsal-loading-bar"></div></div><div class="rehearsal-loading-detail" id="rehearsal-loading-detail" aria-live="polite">Подготовка…</div><button class="toolbar-button" id="rehearsal-retry" hidden>${icon('rotate-ccw')}Попробовать ещё раз</button></div></div><aside class="rehearsal-report" id="rehearsal-report" hidden><div class="rehearsal-report-header"><strong>Проверка монтажа</strong><button id="rehearsal-report-close" aria-label="Закрыть проверку кадра">${icon('x')}</button></div><p class="rehearsal-report-intro">Это проверка читаемости и кадрирования. Оцените сам сюжет и интерес к нему при просмотре.</p><ul id="rehearsal-report-items"></ul><div class="rehearsal-report-empty" id="rehearsal-report-empty" hidden></div></aside>`);
 const controls={play:$('play'),reset:$('reset'),step:$('step'),timeline:$('timeline'),speed:$('playback-speed'),sound:$('sound'),time:$('time')};
 let active=false,playing=false,documentData=null,totalFrames=0,fps=12,duration=0,currentTime=0,currentTake=-1,displayedFrame=-1,offsets=[],raf=null,pollTimer=null,requestAbort=null,session=0,startedAt=0,baseTime=0,applying=false,pendingFrame=null,savedControls=null,lastOpenOptions={},playbackError=null,summarySignature='';
 let rehearsalAudio=null,soundWanted=false,audioUnavailable=false,audioPlayPending=false,audioGeneration=0,audioPlaySerial=0,audioNoticeShown=false,playbackRate=1;

 function fit(){if(!active)return;const width=wrap.clientWidth,height=wrap.clientHeight,filmWidth=Math.min(width,height*9/16);film.style.width=filmWidth+'px';film.style.height=filmWidth*16/9+'px';}
 const resizeObserver=new ResizeObserver(fit);resizeObserver.observe(wrap);
 function controlsSnapshot(){return{timeline:controls.timeline?{max:controls.timeline.max,step:controls.timeline.step,value:controls.timeline.value,disabled:controls.timeline.disabled}:null,play:controls.play?{html:controls.play.innerHTML,label:controls.play.getAttribute('aria-label'),title:controls.play.title}:null,sound:controls.sound?{html:controls.sound.innerHTML,label:controls.sound.getAttribute('aria-label'),pressed:controls.sound.getAttribute('aria-pressed'),state:controls.sound.dataset.rehearsalAudio,disabled:controls.sound.disabled,title:controls.sound.title}:null,speed:controls.speed?{value:controls.speed.value,disabled:controls.speed.disabled}:null,time:controls.time?.textContent};}
 function setPlayIcon(){if(!controls.play)return;controls.play.innerHTML=icon(playing?'pause':'play');controls.play.setAttribute('aria-label',playing?'Пауза репетиции':'Смотреть репетицию');icons();}
 function setSoundIcon(){
  if(!controls.sound)return;const available=!!rehearsalAudio&&!audioUnavailable;
  controls.sound.disabled=!available;controls.sound.innerHTML=icon(soundWanted?'volume-2':'volume-x');
  controls.sound.setAttribute('aria-label',soundWanted?'Выключить звук репетиции':'Включить звук репетиции');controls.sound.setAttribute('aria-pressed',String(soundWanted));
  controls.sound.title=available?(soundWanted?'Звук репетиции включён':'Включить музыку и звуки репетиции'):documentData?'Для этой репетиции звук недоступен':'Звук готовится вместе с репетицией';
  controls.sound.dataset.rehearsalAudio=!available?'unavailable':soundWanted?(playing?'playing':'enabled'):'muted';icons();
 }
 function clearAudio(){
  audioGeneration++;audioPlaySerial++;audioPlayPending=false;soundWanted=false;audioUnavailable=false;const previous=rehearsalAudio;rehearsalAudio=null;
  if(previous){previous.onloadedmetadata=null;previous.oncanplay=null;previous.onerror=null;previous.onended=null;previous.pause();previous.muted=true;previous.removeAttribute('src');previous.load();}
 }
 function audioFailure(error,media,generation){
  if(!active||media!==rehearsalAudio||generation!==audioGeneration)return;
  if(error?.name==='AbortError')return;
  const wasWanted=soundWanted;soundWanted=false;audioPlaySerial++;audioPlayPending=false;media.pause();media.muted=true;
  audioUnavailable=error?.name!=='NotAllowedError';setSoundIcon();
  if(wasWanted&&!audioNoticeShown){audioNoticeShown=true;notify(error?.name==='NotAllowedError'?'Браузер не включил звук. Нажмите кнопку звука ещё раз.':'Звук не загрузился. Репетиция продолжает воспроизводиться без него.');}
 }
 function playAudio(){
  const media=rehearsalAudio,generation=audioGeneration;if(!media||audioPlayPending||!active||!playing||!soundWanted||audioUnavailable)return;
  audioPlayPending=true;const serial=++audioPlaySerial;
  try{Promise.resolve(media.play()).then(()=>{if(media!==rehearsalAudio||generation!==audioGeneration||!active||!playing||!soundWanted){media.pause();return;}if(serial===audioPlaySerial)audioPlayPending=false;}).catch(error=>{if(serial!==audioPlaySerial)return;if(media===rehearsalAudio&&generation===audioGeneration)audioPlayPending=false;audioFailure(error,media,generation);});}
  catch(error){if(serial===audioPlaySerial){audioPlayPending=false;audioFailure(error,media,generation);}}
 }
 function syncAudio(force=false){
  const media=rehearsalAudio;if(!media||audioUnavailable)return;
  const plan=rehearsalAudioPlan({time:currentTime,duration,rate:playbackRate,audioTime:media.currentTime,playing,enabled:soundWanted,force});
  media.muted=plan.muted;
  try{if(media.playbackRate!==plan.playbackRate)media.playbackRate=plan.playbackRate;}
  catch{soundWanted=false;audioPlaySerial++;audioPlayPending=false;media.pause();media.muted=true;setSoundIcon();if(!audioNoticeShown){audioNoticeShown=true;notify('Браузер не воспроизводит звук на этой скорости. Можно изменить скорость или продолжить без звука.');}return;}
  try{if((force||soundWanted)&&plan.seek&&media.readyState>0&&(force||!media.seeking))media.currentTime=plan.currentTime;}catch{}
  if(plan.play){if(media.paused)playAudio();}else{if(!media.paused||audioPlayPending){audioPlaySerial++;media.pause();}audioPlayPending=false;}
 }
 function prepareAudio(data){
  clearAudio();audioNoticeShown=false;
  if(typeof data.audioUrl!=='string'){setSoundIcon();return;}
  try{
   const url=new URL(data.audioUrl,window.location.href);
   if(url.origin!==window.location.origin||!/^\/api\/preview-audio\/[a-zA-Z0-9_-]{1,80}\.wav$/.test(url.pathname)||url.search||url.hash)throw new Error('Invalid rehearsal audio URL');
   const media=new Audio();rehearsalAudio=media;const generation=audioGeneration;
   media.preload='auto';media.defaultMuted=true;media.muted=true;if('preservesPitch' in media)media.preservesPitch=true;
   media.onloadedmetadata=()=>{if(media===rehearsalAudio&&generation===audioGeneration)syncAudio(true);};
   media.oncanplay=()=>{if(media===rehearsalAudio&&generation===audioGeneration)syncAudio();};
   media.onerror=()=>audioFailure(new Error('Audio unavailable'),media,generation);
   media.onended=()=>{if(media!==rehearsalAudio||generation!==audioGeneration||!active||!soundWanted)return;currentTime=Math.max(0,duration-1/fps);setPlaying(false);void showFrame(totalFrames-1);};
   media.src=url.href;media.load();
  }catch{audioUnavailable=true;}
  setSoundIcon();
 }
 function advanceClock(now=performance.now()){if(playing)currentTime=clamp(baseTime+(now-startedAt)/1000*playbackRate,0,Math.max(0,duration-1/fps));}
 function setPlaying(value){const next=!!value&&!!documentData;if(playing&&!next)advanceClock();playing=next;if(playing){baseTime=currentTime;startedAt=performance.now();}syncAudio(true);setPlayIcon();setSoundIcon();}
 function showLoading(message='Подготовка…',progress=0){$('rehearsal-loading').hidden=false;$('rehearsal-loading-title').textContent='Собираем репетицию';$('rehearsal-loading-copy').textContent='Рассчитываем движение, камеру и подписи. Сцена в проекте остаётся без изменений.';$('rehearsal-loading-detail').textContent=clean(message);$('rehearsal-loading-bar').style.width=clamp(finite(progress),0,100)+'%';$('rehearsal-loading-progress').hidden=false;$('rehearsal-retry').hidden=true;}
 function failure(error,token){if(!active||token!==session)return;playbackError=error;setPlaying(false);clearTimeout(pollTimer);pollTimer=null;$('rehearsal-loading').hidden=false;$('rehearsal-loading-title').textContent='Репетиция не собралась';$('rehearsal-loading-copy').textContent='Можно повторить расчёт или вернуться к сцене.';$('rehearsal-loading-detail').textContent=clean(error?.message||error||'Не удалось подготовить просмотр.');$('rehearsal-loading-progress').hidden=true;$('rehearsal-retry').hidden=false;}
 function warningsFrom(data){
  const input=data?.analysis;let list=[];
  if(Array.isArray(input))list=input;
  else if(input&&typeof input==='object'){
   for(const key of ['warnings','findings','issues'])if(Array.isArray(input[key]))list.push(...input[key]);
   if(!list.length&&Array.isArray(input.takes))for(const take of input.takes)for(const key of ['warnings','findings','issues'])if(Array.isArray(take?.[key]))list.push(...take[key]);
  }
  const seen=new Set();return list.map(item=>typeof item==='string'?{message:item,severity:'warning'}:{message:item?.message||item?.text||item?.title,severity:item?.severity||item?.level||'warning'}).filter(item=>{item.message=clean(item.message);if(!item.message||seen.has(item.message))return false;seen.add(item.message);return true;});
 }
 function renderReport(){
  const warnings=warningsFrom(documentData),list=$('rehearsal-report-items');list.replaceChildren();
  for(const warning of warnings){const li=document.createElement('li');li.textContent=warning.message;li.dataset.severity=['error','warning'].includes(warning.severity)?warning.severity:'info';list.appendChild(li);}
  $('rehearsal-report-empty').hidden=warnings.length>0;$('rehearsal-report-empty').textContent='Автоматическая проверка не нашла замечаний. Просмотрите действие, подписи и результат перед экспортом.';
  const button=$('rehearsal-report-button');button.dataset.warning=warnings.length>0;button.replaceChildren();const label=document.createElement('span');label.textContent=warnings.length?`${warnings.length} замечаний`:'Проверка кадра';button.appendChild(label);
 }
 function updateOverlay(frame,take,takeIndex,localFrame){
  const meta=frame.editorial||{},overlay=$('rehearsal-overlay');overlay.hidden=false;
  if(meta.enabled===false){overlay.hidden=true;return;}
  overlay.dataset.theme=['contrast','editorial','minimal'].includes(meta.theme)?meta.theme:'contrast';overlay.dataset.light=String(documentData.environment?.id==='gallery');overlay.style.setProperty('--film-accent',/^#[\da-f]{6}$/i.test(meta.accent||'')?meta.accent:'#d8ff5f');
  const graphics=normalizeGraphicsStyle(meta.graphics||documentData.story?.graphics),tokens=meta.graphicsLayout||graphicsStyleTokens(graphics),light=documentData.environment?.id==='gallery'||meta.theme==='editorial',palette=graphicsPalette(graphics,{light});for(const[k,v]of Object.entries(graphicsStyleVariables(graphics,{light,layout:tokens})))overlay.style.setProperty(k,v);overlay.style.setProperty('--graphics-cue-opacity',String(clamp(finite(meta.captionOpacity,1),0,1)));overlay.style.setProperty('--graphics-cue-offset',finite(meta.captionOffsetY)/10.8+'cqw');Object.assign(overlay.dataset,{graphics:graphics.preset,graphicsPosition:graphics.position,graphicsMetricPosition:tokens.metricAnchor===0?'top':'bottom',graphicsAlign:graphics.align,graphicsCounter:String(graphics.showCounter),graphicsProgress:String(graphics.showProgress),graphicsBackdrop:palette.backdrop});
  // Match native editorialOverlay(): the phase determines the large headline.
  const phase=meta.phase||'action',headline=phase==='hook'?meta.hook:phase==='setup'?meta.question:meta.caption;
  overlay.dataset.phase=phase;$('rehearsal-headline').textContent=clean(headline);$('rehearsal-headline').style.opacity='';$('rehearsal-phase').textContent=clean(meta.phaseLabel);
  fitGraphicsHeadline($('rehearsal-headline'),overlay,tokens);
  $('rehearsal-take-label').textContent=clean(meta.takeLabel||'');$('rehearsal-take-label').hidden=!$('rehearsal-take-label').textContent;$('rehearsal-take-number').textContent=`${String(takeIndex+1).padStart(2,'0')} / ${String(documentData.takes.length).padStart(2,'0')}`;
  const metric=meta.metric===0?'0':clean(meta.metric),valueLength=Array.from(metric).length,valueSize=valueLength>8?tokens.metricSize*.8:tokens.metricSize;overlay.style.setProperty('--graphics-metric-size',valueSize/10.8+'cqw');
  overlay.style.setProperty('--metric-font',valueSize/1080*100+'cqw');overlay.style.setProperty('--metric-unit-left',(Math.min(720,valueLength*valueSize*.56)+18)/1080*100+'cqw');
  const summary=Array.isArray(meta.summary)?meta.summary.filter(row=>row&&typeof row==='object').slice(0,4).map(row=>({label:clean(row.label),metric:row.metric===0?'0':clean(row.metric),unit:clean(row.unit),outcome:concise(row.outcome,6)})):[];
  overlay.dataset.summary=summary.length>0?'true':'false';
  const signature=JSON.stringify(summary),summaryCard=$('rehearsal-summary');summaryCard.hidden=!summary.length;
  if(signature!==summarySignature){
   summarySignature=signature;summaryCard.replaceChildren();
   for(const row of summary){
    const item=document.createElement('div');item.className='rehearsal-summary-row';
    const label=document.createElement('div');label.className='rehearsal-summary-condition';label.textContent=row.label;
    const value=document.createElement('div');value.className='rehearsal-summary-result';
    const number=document.createElement('span');number.textContent=row.metric;const unit=document.createElement('small');unit.textContent=row.unit;value.append(number,unit);
    const outcome=document.createElement('div');outcome.className='rehearsal-summary-outcome';outcome.textContent=row.outcome;outcome.hidden=!row.outcome;
    item.append(label,value,outcome);summaryCard.appendChild(item);
   }
  }
  $('rehearsal-metric').textContent=metric;$('rehearsal-metric-unit').textContent=clean(meta.metricUnit||'');$('rehearsal-metric-label').textContent=clean(meta.metricLabel);$('rehearsal-measurement').hidden=!metric||meta.hideMetric===true||summary.length>0;overlay.dataset.graphicsMetric=String(!$('rehearsal-measurement').hidden);
  $('rehearsal-caption').textContent='';$('rehearsal-caption').hidden=true;
  $('rehearsal-pulse').hidden=summary.length>0;$('rehearsal-pulse').style.setProperty('--event-pulse',summary.length>0?0:clamp(finite(meta.effects?.eventPulse),0,1)*.26);
  const bars=$('rehearsal-film-progress').children;for(let i=0;i<bars.length;i++)bars[i].firstElementChild.style.width=(i<takeIndex?100:i===takeIndex?(localFrame+1)/take.frames.length*100:0)+'%';
  $('rehearsal-movie-time').textContent=movieTime(currentTime);$('rehearsal-movie-duration').textContent=movieTime(duration);
 }
 async function showFrame(index){
  if(!active||!documentData)return;pendingFrame=clamp(Math.floor(index),0,totalFrames-1);if(applying)return;
  applying=true;const token=session;
  try{
   while(pendingFrame!==null&&active&&token===session){
    const selected=pendingFrame;pendingFrame=null;if(selected===displayedFrame)continue;
    let takeIndex=offsets.length-1;for(let i=0;i<offsets.length;i++)if(selected<offsets[i]+documentData.takes[i].frames.length){takeIndex=i;break;}
    const take=documentData.takes[takeIndex],localFrame=selected-offsets[takeIndex],frame=take.frames[localFrame];
    if(takeIndex!==currentTake){await onLoadTake(take,documentData);if(!active||token!==session)return;currentTake=takeIndex;}
    const displayFrame=frameForRehearsal(frame);
    await onFrame(displayFrame,take,documentData);if(!active||token!==session)return;displayedFrame=selected;updateOverlay(displayFrame,take,takeIndex,localFrame);
   }
  }catch(error){failure(error,token);}finally{applying=false;}
 }
 function updateControls(){if(!active)return;if(controls.timeline)controls.timeline.value=String(currentTime);if(controls.time)controls.time.textContent=movieTime(currentTime)+'.'+String(Math.floor(currentTime%1*100)).padStart(2,'0');}
 function seek(time){if(!documentData)return;currentTime=clamp(finite(time),0,Math.max(0,duration-1/fps));baseTime=currentTime;startedAt=performance.now();syncAudio(true);updateControls();void showFrame(Math.floor(currentTime*fps));}
 function tick(now){
  if(!active)return;
  if(documentData&&playing){currentTime=baseTime+(now-startedAt)/1000*playbackRate;if(currentTime>=duration){currentTime=Math.max(0,duration-1/fps);setPlaying(false);}void showFrame(Math.floor(currentTime*fps));}
  syncAudio();
  updateControls();raf=requestAnimationFrame(tick);
 }
 async function loadDocument(data,token){
  if(!data||!Array.isArray(data.takes)||!data.takes.length||data.takes.some(t=>!Array.isArray(t.frames)||!t.frames.length))throw new Error('В расчёте нет кадров для просмотра.');
  if(!active||token!==session)return;documentData=data;fps=clamp(finite(data.fps,12),1,60);offsets=[];totalFrames=0;for(const take of data.takes){offsets.push(totalFrames);totalFrames+=take.frames.length;}duration=totalFrames/fps;
  if(!Number.isFinite(duration)||duration<=0)throw new Error('Некорректная длительность репетиции.');
  currentTime=0;currentTake=-1;displayedFrame=-1;
  prepareAudio(data);
  if(controls.timeline){controls.timeline.max=String(duration);controls.timeline.step=String(1/fps);controls.timeline.disabled=false;controls.timeline.value='0';}
  $('rehearsal-film-progress').replaceChildren(...data.takes.map(()=>{const segment=document.createElement('span');segment.appendChild(document.createElement('i'));return segment;}));renderReport();
  $('rehearsal-report-button').disabled=false;
  await showFrame(0);if(!active||token!==session||playbackError)return;$('rehearsal-loading').hidden=true;setPlaying(true);
 }
 async function requestJSON(url,options={}){const response=await fetch(url,{...options,signal:requestAbort?.signal});const data=await response.json();if(!response.ok)throw new Error(data?.error||'Локальный сервер не ответил.');return data;}
 async function pollJob(id,token,deadline){
  if(!active||token!==session)return;
  if(Date.now()>deadline){failure(new Error('Расчёт занял больше двух минут. Можно вернуться к сцене и повторить репетицию.'),token);return;}
  try{
   const job=await requestJSON('/api/jobs/'+encodeURIComponent(id));if(!active||token!==session)return;
   if(job.status==='error'||job.status==='failed'){failure(new Error(job.message||'Не удалось рассчитать репетицию.'),token);return;}
   if(job.status==='done'||job.status==='complete'){
    showLoading('Загружаем кадры…',98);const data=await requestJSON(job.dataUrl||'/api/previews/'+encodeURIComponent(id));await loadDocument(data,token);return;
   }
   showLoading(job.message||'Рассчитываем сцену…',finite(job.progress));pollTimer=setTimeout(()=>void pollJob(id,token,deadline),1100);
  }catch(error){if(error?.name!=='AbortError')failure(error,token);}
 }
 function close(){
  if(!active)return;active=false;session++;playing=false;clearAudio();pendingFrame=null;clearTimeout(pollTimer);pollTimer=null;cancelAnimationFrame(raf);raf=null;requestAbort?.abort();requestAbort=null;
  for(const id of ['rehearsal-toolbar','rehearsal-overlay','rehearsal-loading','rehearsal-report'])$(id).hidden=true;
  wrap.classList.remove('rehearsal-mode');film.style.removeProperty('width');film.style.removeProperty('height');documentData=null;currentTake=-1;displayedFrame=-1;totalFrames=0;duration=0;
  if(savedControls?.timeline&&controls.timeline)Object.assign(controls.timeline,savedControls.timeline);
  if(savedControls?.play&&controls.play){controls.play.innerHTML=savedControls.play.html;controls.play.title=savedControls.play.title;if(savedControls.play.label)controls.play.setAttribute('aria-label',savedControls.play.label);}
  if(savedControls?.sound&&controls.sound){const saved=savedControls.sound;controls.sound.disabled=saved.disabled;controls.sound.title=saved.title;controls.sound.innerHTML=saved.html;for(const[name,value]of[['aria-label',saved.label],['aria-pressed',saved.pressed]]){if(value===null)controls.sound.removeAttribute(name);else controls.sound.setAttribute(name,value);}if(saved.state===undefined)delete controls.sound.dataset.rehearsalAudio;else controls.sound.dataset.rehearsalAudio=saved.state;}
  if(savedControls?.speed&&controls.speed)Object.assign(controls.speed,savedControls.speed);
  if(controls.time&&savedControls?.time)controls.time.textContent=savedControls.time;icons();
  try{onStop();}catch(error){notify(error?.message||'Не удалось восстановить сцену после просмотра.');}
 }
 async function open(options={}){
  if(active){close();return;}lastOpenOptions=options;
  // Pause the ordinary simulation before installing rehearsal interception.
  if(controls.play&&/Пауза/i.test(controls.play.getAttribute('aria-label')||''))controls.play.click();
  savedControls=controlsSnapshot();clearAudio();playbackRate=clamp(finite(controls.speed?.value,1),.25,4);active=true;playing=false;playbackError=null;session++;const token=session;requestAbort=new AbortController();
  wrap.classList.add('rehearsal-mode');$('rehearsal-toolbar').hidden=false;$('rehearsal-overlay').hidden=true;$('rehearsal-report').hidden=true;$('rehearsal-report-button').disabled=true;fit();showLoading();
  if(controls.timeline){controls.timeline.disabled=true;controls.timeline.value='0';}
  setSoundIcon();setPlayIcon();raf=requestAnimationFrame(tick);
  try{
   const project=getProject(),series=typeof options.series==='boolean'?options.series:typeof project.series==='boolean'?project.series:project.settings?.comparison?.enabled||project.settings?.experiment!=='blank';
   const job=await requestJSON('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...project,series})});
   if(!active||token!==session)return;if(!job.id)throw new Error('Сервер не создал задание репетиции.');
   if(job.takes){await loadDocument(job,token);return;}
   await pollJob(job.id,token,Date.now()+120_000);
  }catch(error){if(error?.name!=='AbortError')failure(error,token);}
 }
 function intercept(target,type,handler){target?.addEventListener(type,event=>{if(!active)return;event.preventDefault();event.stopImmediatePropagation();handler(event);},true);}
 intercept(controls.play,'click',()=>{if(!documentData)return;if(!playing&&currentTime>=duration-1/fps)seek(0);setPlaying(!playing);});
 intercept(controls.reset,'click',()=>{setPlaying(false);seek(0);});
 intercept(controls.step,'click',()=>{setPlaying(false);seek(currentTime+1/fps);});
 for(const type of ['input','change'])intercept(controls.timeline,type,()=>{setPlaying(false);seek(Number(controls.timeline.value));});
 intercept(controls.speed,'change',()=>{advanceClock();playbackRate=clamp(finite(controls.speed?.value,1),.25,4);baseTime=currentTime;startedAt=performance.now();syncAudio(true);});
 intercept(controls.sound,'click',()=>{if(!documentData||!rehearsalAudio||audioUnavailable)return;soundWanted=!soundWanted;audioNoticeShown=false;setSoundIcon();syncAudio(true);});
 $('rehearsal-close').onclick=close;$('rehearsal-report-button').onclick=()=>{$('rehearsal-report').hidden=!$('rehearsal-report').hidden;};$('rehearsal-report-close').onclick=()=>{$('rehearsal-report').hidden=true;};
 $('rehearsal-retry').onclick=()=>{const options=lastOpenOptions;close();void open(options);};
 document.addEventListener('keydown',event=>{if(!active||event.target?.matches('input,textarea,select,[contenteditable=true]'))return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}else if(event.code==='Space'){event.preventDefault();event.stopImmediatePropagation();if(documentData){if(!playing&&currentTime>=duration-1/fps)seek(0);setPlaying(!playing);}}},true);
 icons();return{open,close,get active(){return active;},get audioState(){return{available:!!rehearsalAudio&&!audioUnavailable,enabled:soundWanted,movieTime:currentTime,audioTime:rehearsalAudio?.currentTime??null,rate:playbackRate,playing};}};
}
