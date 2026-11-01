import './camera-studio.css';
import { normalizeCameraRig, createCameraSampler, retimeCameraRig, simplifyCameraRig } from './camera-rig.js';
import {objectLabelMap,objectLabel} from './object-labels.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(n,fallback=0)=>Number.isFinite(Number(n))?Number(n):fallback;
const valid=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const clean=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const clock=value=>{const t=Math.max(0,finite(value));return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;};
const plural=(n,one,few,many)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many;
const modes=[['auto','sparkles','Авто'],['static','camera','Ракурс'],['recorded','video','Запись'],['keys','key-round','Ключи']];

/** Manual camera authoring; movie time is never inferred from physics time. */
export function mountCameraStudio({getState,commitRig,view,getTime=()=>0,getHeroPosition=()=>null,getSelected=()=>null,reset=()=>{},play=()=>{},pause=()=>{},isPlaying=()=>false,isRehearsal=()=>false,seekPhysics=async()=>{},notify=()=>{},icons=()=>{}}){
  if(typeof getState!=='function'||typeof commitRig!=='function'||!view?.camera||!view?.controls)throw new Error('Для студии камеры нужны проект, камера и сохранение дубля');
  if(document.getElementById('camera-studio'))throw new Error('Студия камеры уже подключена');
  const toolbar=document.querySelector('.scene-toolbar'),wrap=document.getElementById('viewport-wrap');
  if(!toolbar||!wrap)throw new Error('Не найдено рабочее пространство камеры');
  const bar=document.createElement('div');bar.id='camera-studio';bar.className='camera-studio-bar';
  bar.innerHTML=`<span class="camera-studio-brand"><i data-lucide="aperture"></i>КАМЕРА</span><div class="camera-mode-switch" role="group" aria-label="Способ съёмки">${modes.map(([id,icon,label])=>`<button type="button" data-camera-mode="${id}" title="${{auto:'Автоматическая режиссура',static:'Сохранить один ракурс',recorded:'Записать движение камеры',keys:'Собрать маршрут из ключевых кадров'}[id]}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</div><div class="camera-studio-live-tools"><label class="camera-lens" title="Вертикальный угол зрения"><i data-lucide="focus"></i><input id="camera-fov" type="range" min="20" max="75" step="1" aria-label="Угол зрения камеры"/><output id="camera-fov-value"></output></label><button type="button" class="camera-btn camera-physics" id="camera-physics"><i data-lucide="pause"></i><span>Физика</span></button><button type="button" class="camera-btn camera-action" id="camera-action"></button><button type="button" class="camera-btn" id="camera-montage" aria-expanded="false" title="Открыть монтаж камеры"><i data-lucide="sliders-horizontal"></i><span>Монтаж</span></button></div><span class="camera-auto-note">Автоматическая камера</span>`;
  toolbar.after(bar);
  const panel=document.createElement('section');panel.className='camera-studio-panel';panel.hidden=true;panel.setAttribute('aria-label','Монтаж ручной камеры');
  panel.innerHTML=`<div class="camera-panel-head"><div><span class="camera-overline">РУЧНАЯ СЪЁМКА</span><h3>Монтаж камеры</h3></div><button type="button" class="camera-btn camera-icon-btn" id="camera-panel-close" aria-label="Закрыть монтаж камеры"><i data-lucide="x"></i></button></div><div class="camera-panel-body"><div class="camera-take-settings"><label>Длительность видео <span class="camera-unit-input"><input id="camera-duration" type="number" min=".1" max="120" step=".1" value="20"/>с</span></label><label>Движение между ключами<select id="camera-interpolation"><option value="smooth">Плавное</option><option value="linear">Равномерное</option></select></label><label class="camera-follow"><input id="camera-follow" type="checkbox"/><span>Следовать за предметом<small id="camera-follow-label">Выберите предмет в сцене</small></span></label></div><div class="camera-clock-row"><span>ВИДЕО <strong id="camera-movie-clock">00:00.0</strong></span><span>ФИЗИКА <strong id="camera-source-clock">00:00.0</strong></span><span id="camera-take-status">Дубль ещё не записан</span></div><svg id="camera-timing-curve" viewBox="0 0 600 64" role="img" aria-label="Ход времени: видео по горизонтали, физика по вертикали"></svg><input id="camera-scrub" class="camera-scrub" type="range" min="0" max="20" step=".01" value="0" aria-label="Просмотреть момент ручного дубля"/><p class="camera-timing-help">Пауза физики не останавливает запись камеры. Горизонтальный участок — камера движется при остановленной симуляции.</p><div class="camera-key-workspace"><div><div class="camera-key-head"><span>КАДРЫ <small id="camera-key-count">0</small></span><button type="button" class="camera-text-button" id="camera-to-keys">Упростить до 12 ключей</button></div><div id="camera-key-list" class="camera-key-list"></div></div><div class="camera-key-editor" id="camera-key-editor"><div class="camera-key-time-row"><label>В видео, с<input id="camera-key-time" type="number" min="0" max="120" step=".1" value="0"/></label><label>В физике, с<input id="camera-key-source" type="number" min="0" max="20" step=".1" value="0"/></label></div><label class="camera-cut"><input id="camera-key-cut" type="checkbox"/>Склейка перед кадром</label><div class="camera-key-actions"><button type="button" class="camera-btn camera-action" id="camera-add-key"><i data-lucide="plus"></i>Добавить ключ</button><button type="button" class="camera-btn camera-icon-btn" id="camera-delete-key" aria-label="Удалить выбранный ключ"><i data-lucide="trash-2"></i></button></div><details class="camera-coordinate-details"><summary>Точные координаты <small id="camera-coordinate-space">в мире, м</small></summary>${['position','target'].map((name,n)=>`<label class="camera-coordinate-label">${n?'Цель камеры':'Положение камеры'}</label><div class="camera-coordinate-row">${['X','Y','Z'].map((axis,i)=>`<label><span>${axis}</span><input id="camera-${name}-${i}" type="number" min="-100000000" max="100000000" step=".1" aria-label="${n?'Цель':'Камера'} ${axis}"/></label>`).join('')}</div>`).join('')}<button type="button" id="camera-apply-key" class="camera-btn">Применить изменения ключа</button></details><button type="button" class="camera-text-button camera-new-route" id="camera-clear-keys">Начать новый маршрут</button></div></div><div class="camera-operator-help"><i data-lucide="mouse-pointer-2"></i><span><b>ЛКМ</b> — облёт · <b>ПКМ</b> — сдвиг · <b>Колесо</b> — расстояние<br><b>W A S D</b> — движение · <b>Q / E</b> — вниз / вверх · <b>Shift</b> — быстрее. Нажмите предмет, чтобы перенести точку вращения.</span></div></div>`;
  bar.after(panel);
  const keyEditor=panel.querySelector('#camera-key-editor'),keySide=document.createElement('div');keySide.className='camera-key-side';keyEditor.replaceWith(keySide);
  const attentionPanel=document.createElement('section');attentionPanel.id='camera-attention-editor';attentionPanel.className='camera-attention-editor';
  attentionPanel.innerHTML=`<div class="camera-attention-heading"><i data-lucide="scan-eye"></i><strong id="camera-attention-heading">Цель внимания ключа</strong></div><label class="camera-attention-label">Куда смотреть<select id="camera-attention-mode"><option value="point">Авторская точка</option><option value="objects">Предмет или группа</option><option value="mix" hidden>Сохранённый переход</option></select></label><div id="camera-attention-object-tools"><select id="camera-attention-add" aria-label="Добавить предмет в цель камеры"><option value="">Добавить предмет…</option></select><div id="camera-attention-chips" class="camera-attention-chips"></div><button type="button" id="camera-attention-selected" class="camera-text-button">Добавить выбранный в сцене</button><label class="camera-attention-label">Смещение цели, м <small>по мировым осям</small></label><div class="camera-coordinate-row">${['X','Y','Z'].map((axis,index)=>`<label><span>${axis}</span><input id="camera-attention-offset-${index}" type="number" step=".1" min="-100000000" max="100000000" value="0" aria-label="Смещение цели ${axis}"/></label>`).join('')}</div></div><label class="camera-attention-label" id="camera-attention-transition-label">Переход к этому ключу<select id="camera-attention-transition"><option value="smooth">Плавный перевод взгляда</option><option value="linear">Равномерный</option><option value="cut">Сразу на ключе</option></select></label><p id="camera-attention-note" class="camera-attention-note">Цель управляет взглядом. Опора маршрута отдельно перемещает саму камеру.</p><p id="camera-attention-warning" class="camera-attention-warning" role="status" hidden></p><button type="button" id="camera-attention-apply" class="camera-btn">Применить цель к ключу</button>`;
  keySide.append(attentionPanel,keyEditor);
  const badge=document.createElement('div');badge.className='camera-format-badge';badge.innerHTML='<span>9:16</span><span id="camera-on-air">РУЧНОЙ КАДР</span>';badge.hidden=true;wrap.append(badge);
  const $=id=>document.getElementById(id),held=new Set();
  $('camera-follow').nextElementSibling.firstChild.textContent='Перемещать камеру с предметом';
  panel.querySelectorAll('.camera-coordinate-label')[1].textContent='Авторская точка взгляда';
  let rig=normalizeCameraRig(getState()?.settings?.cameraRig),mode=rig.mode,lastSource=null;
  let cameraSample=createCameraSampler(rig,{resolveTarget:id=>bodyPosition(id)});
  let recording=false,recordPoints=[],recordStarted=0,nextSample=0,lastClockDraw=0,cursor=0,selectedKey=-1,busy=false,pendingCut=false;
  let followId=rig.anchorId,anchorLast=null,oldAutoMode=null,oldTransformEnabled=true,seekVersion=0,rehearsalSince=0,seeking=false,seekQueue=Promise.resolve();
  let attentionDraft={ids:[],offset:[0,0,0],transition:'smooth',mix:null},attentionPreview=null;
  const settings=()=>getState()?.settings||{};
  const bodyPosition=id=>{const p=id?getHeroPosition(id):null;return valid(p)?p.slice():null;};
  const anchor=()=>bodyPosition(followId)||anchorLast||[0,0,0];
  const manual=()=>mode!=='auto'&&document.querySelector('#workspace')?.dataset.workflow==='shoot';
  function canEdit(){if(isRehearsal()){notify('Закройте просмотр ролика, чтобы настроить камеру.');return false;}return !busy&&!seeking;}
  function sourceTime(){return clamp(finite(getTime()),0,20);}
  function snapshot(time,physical=sourceTime()){
    const origin=followId?anchor():[0,0,0];
    return{time:clamp(time,0,120),sourceTime:physical,position:view.camera.position.toArray().map((v,i)=>v-origin[i]),target:view.controls.target.toArray().map((v,i)=>v-origin[i]),fov:clamp(finite(view.camera.fov,40),20,75),cut:pendingCut,...attentionPointFields()};
  }
  function apply(point){
    if(!point)return;view.camera.position.fromArray(point.position);view.controls.target.fromArray(point.target);view.camera.fov=point.fov;view.camera.updateProjectionMatrix();view.camera.lookAt(view.controls.target);view.controls.update();
    $('camera-fov').value=point.fov;$('camera-fov-value').textContent=`${Math.round(point.fov)}°`;anchorLast=followId?bodyPosition(followId):null;
    if(point.attentionMissingIds?.length){$('camera-attention-warning').hidden=false;$('camera-attention-warning').textContent=`Цель недоступна: ${point.attentionMissingIds.join(', ')}. Выберите существующие предметы перед выгрузкой.`;}
  }
  function setPortrait(){
    wrap.classList.toggle('manual-shooting',manual());document.body.classList.toggle('manual-camera-studio',manual());badge.hidden=!manual();
    if(manual()){
      if(oldAutoMode===null){oldAutoMode=view.autoMode||settings().cameraMode||'dolly';oldTransformEnabled=view.transform?.enabled??true;}
      view.autoMode='free';view.transform?.detach();if(view.transform)view.transform.enabled=false;
    }else{
      if(oldAutoMode!==null)view.autoMode=oldAutoMode;if(view.transform)view.transform.enabled=oldTransformEnabled;oldAutoMode=null;held.clear();
    }
    requestAnimationFrame(()=>view.resize());
  }
  async function save(next,message=''){
    const normalized=normalizeCameraRig(next);busy=true;drawState();
    try{await commitRig(normalized);rig=normalized;cameraSample=createCameraSampler(rig,{resolveTarget:id=>bodyPosition(id)});mode=rig.mode;lastSource=getState()?.settings?.cameraRig;if(message)notify(message);return true;}
    catch(error){notify(error?.message||'Не удалось сохранить камеру');return false;}
    finally{busy=false;draw();}
  }
  function drawState(){
    const locked=busy||seeking;
    bar.dataset.mode=mode;bar.classList.toggle('is-recording',recording);panel.classList.toggle('is-recording',recording);
    for(const button of bar.querySelectorAll('[data-camera-mode]')){button.classList.toggle('active',button.dataset.cameraMode===mode);button.setAttribute('aria-pressed',String(button.dataset.cameraMode===mode));button.disabled=locked||recording;}
    $('camera-action').disabled=locked;
    $('camera-action').innerHTML=recording?'<i data-lucide="square"></i>Стоп':mode==='static'?'<i data-lucide="bookmark"></i>Сохранить ракурс':mode==='keys'?'<i data-lucide="plus"></i>Ключевой кадр':'<i data-lucide="circle"></i>Снять дубль';
    $('camera-physics').innerHTML=`<i data-lucide="${isPlaying()?'pause':'play'}"></i><span>${isPlaying()?'Пауза физики':'Запустить физику'}</span>`;
    $('camera-physics').setAttribute('aria-label',isPlaying()?'Пауза физики. Запись камеры продолжится.':'Запустить физику');$('camera-physics').title='Управляет только физикой. Камеру можно снимать во время паузы.';
    $('camera-montage').setAttribute('aria-expanded',String(!panel.hidden));
    $('camera-key-editor').hidden=mode!=='keys';
    attentionPanel.hidden=!['keys','static'].includes(mode);
    $('camera-to-keys').disabled=locked||recording||rig.points.length<2;
    $('camera-to-keys').textContent='Запись → ключи';
    $('camera-to-keys').title='Обычно 12 ключей. Склейки и изменения физического времени сохраняются, поэтому ключей может быть больше.';
    for(const id of ['camera-duration','camera-interpolation','camera-add-key','camera-clear-keys'])$(id).disabled=locked||recording;
    $('camera-apply-key').disabled=locked||recording||selectedKey<0;
    $('camera-delete-key').disabled=locked||recording||selectedKey<0;
    $('camera-follow').disabled=locked||recording||(mode==='keys'&&rig.points.length>0);
    $('camera-follow').title=mode==='keys'&&rig.points.length?'Опора принадлежит всему маршруту. Для другой опоры начните новый маршрут.':'Следующая запись или первый ключ будут сохранены относительно выбранного предмета.';
    $('camera-follow').checked=!!followId;
    const object=(getState()?.objects||[]).find(o=>o.id===followId);
    $('camera-follow-label').textContent=followId?(object?.name||object?.asset||followId):'Выберите предмет в сцене';
    $('camera-attention-apply').disabled=locked||recording||(selectedKey<0&&mode!=='static');
    $('camera-attention-apply').textContent=mode==='static'&&selectedKey<0?'Применить цель к ракурсу':'Применить цель к ключу';
    $('camera-attention-heading').textContent=mode==='static'&&selectedKey<0?'Цель внимания ракурса':'Цель внимания ключа';
    for(const control of attentionPanel.querySelectorAll('input,select,button'))if(control.id!=='camera-attention-apply')control.disabled=locked||recording||(attentionDraft.mix&&['camera-attention-add','camera-attention-selected'].includes(control.id))||(attentionDraft.mix&&control.id.startsWith('camera-attention-offset-'));
    $('camera-coordinate-space').textContent=rig.anchorId?'относительно опоры, м':'в мире, м';
    $('camera-on-air').textContent=recording?'REC · '+clock(elapsed()):'РУЧНОЙ КАДР';
    icons();
  }
  function draw(){
    drawState();$('camera-duration').value=Number(rig.duration.toFixed(2));$('camera-interpolation').value=rig.interpolation;
    $('camera-fov').value=view.camera.fov;$('camera-fov-value').textContent=`${Math.round(view.camera.fov)}°`;
    $('camera-scrub').max=rig.duration;$('camera-scrub').value=Math.min(cursor,rig.duration);
    $('camera-key-count').textContent=rig.points.length;
    $('camera-take-status').textContent=recording?'Запись идёт · до 120 с':rig.points.length?`${rig.points.length} ${mode==='keys'?plural(rig.points.length,'ключ','ключа','ключей'):plural(rig.points.length,'отсчёт','отсчёта','отсчётов')} · сохранено`:'Дубль ещё не записан';
    const indices=mode==='recorded'&&rig.points.length>12?Array.from({length:12},(_,i)=>Math.round(i*(rig.points.length-1)/11)):rig.points.map((_,i)=>i);
    $('camera-key-list').innerHTML=indices.length?indices.map((index,row)=>{const p=rig.points[index];return`<button type="button" class="camera-key-row ${selectedKey===index?'active':''}" data-camera-key="${index}"><span>${String(row+1).padStart(2,'0')}</span><strong>${clock(p.time)}</strong><small>физика ${clock(p.sourceTime)}</small><i data-lucide="${p.cut?'scissors':'diamond'}"></i></button>`;}).join(''):'<p class="camera-empty-take">Нет ключевых кадров.<br>Добавьте текущий ракурс или запишите движение камеры.</p>';
    const points=rig.points,top=Math.max(1,...points.map(p=>p.sourceTime)),end=Math.max(.1,rig.duration);
    const path=points.map((p,i)=>`${i?'L':'M'}${(8+p.time/end*584).toFixed(2)} ${(55-p.sourceTime/top*46).toFixed(2)}`).join(' ');
    $('camera-timing-curve').innerHTML=`<path d="M8 9H592M8 32H592M8 55H592" class="camera-curve-grid"/><path d="${path}" class="camera-curve-path"/>${mode==='keys'?points.map(p=>`<circle cx="${8+p.time/end*584}" cy="${55-p.sourceTime/top*46}" r="3"/>`).join(''):''}`;
    drawClock();drawAttention();
  }
  function attentionTargets(){
    const items=[...(view.lab?.entities||[]),...(view.lab?.softs||[]),...(getState()?.objects||[])],unique=new Map();
    for(const object of items)if(object.id&&object.id!=='ground'&&!unique.has(object.id))unique.set(object.id,object);
    const objects=[...unique.values()],labels=objectLabelMap(objects);
    return objects.map(object=>({id:object.id,name:objectLabel(object,labels)}));
  }
  function attentionPointFields(){
    if(attentionDraft.mix)return{attentionMix:structuredClone(attentionDraft.mix),attentionTransition:attentionDraft.transition};
    return{attentionIds:attentionDraft.ids.slice(),...(attentionDraft.ids.length?{attentionOffset:attentionDraft.offset.slice()}:{}),attentionTransition:attentionDraft.transition};
  }
  function fillAttention(point){
    attentionDraft={ids:point?.attentionIds?.slice()||[],offset:point?.attentionOffset?.slice()||[0,0,0],transition:point?.attentionTransition||'smooth',mix:point?.attentionMix?structuredClone(point.attentionMix):null};
    $('camera-attention-mode').value=attentionDraft.mix?'mix':attentionDraft.ids.length?'objects':'point';
    $('camera-attention-transition').value=attentionDraft.transition;
    attentionDraft.offset.forEach((value,index)=>$(`camera-attention-offset-${index}`).value=value);
    drawAttention();refreshAttentionPreview();
  }
  function drawAttention(){
    const targets=attentionTargets(),names=new Map(targets.map(object=>[object.id,object.name]));
    $('camera-attention-mode').querySelector('[value=mix]').hidden=!attentionDraft.mix;
    $('camera-attention-object-tools').hidden=$('camera-attention-mode').value==='point';
    $('camera-attention-add').innerHTML='<option value="">Добавить предмет…</option>'+targets.filter(object=>!attentionDraft.ids.includes(object.id)).map(object=>`<option value="${clean(object.id)}">${clean(object.name)}</option>`).join('');
    const ids=attentionDraft.mix?[...new Set(attentionDraft.mix.flatMap(d=>d.ids))]:attentionDraft.ids;
    $('camera-attention-chips').innerHTML=ids.length?ids.map(id=>`<span class="camera-attention-chip ${!bodyPosition(id)?'is-missing':''}" title="${clean(id)}"><span>${clean(names.get(id)||id)}</span>${attentionDraft.mix?'':`<button type="button" data-remove-attention="${clean(id)}" aria-label="Убрать ${clean(names.get(id)||id)} из цели">×</button>`}</span>`).join(''):'<span class="camera-attention-empty">Добавьте один предмет или несколько для центра группы.</span>';
    const missing=ids.filter(id=>!bodyPosition(id));
    $('camera-attention-warning').hidden=!missing.length;
    $('camera-attention-warning').textContent=missing.length?`Не найдены: ${missing.map(id=>names.get(id)||id).join(', ')}. Замените или удалите эти цели перед выгрузкой.`:'';
    $('camera-attention-note').textContent=attentionDraft.mix?'В ключе сохранён переход из монтажа. Выберите новую цель или авторскую точку, чтобы заменить его.':mode==='keys'&&selectedKey<0?'Цель сохранится в следующем ключе. Выберите существующий ключ, чтобы изменить его взгляд.':'Цель управляет взглядом. Опора маршрута отдельно перемещает саму камеру.';
  }
  function refreshAttentionPreview(){
    const base=rig.points[selectedKey]||mode==='static'&&rig.points[0]||snapshot(0);
    const point={...base,...attentionPointFields(),time:0,sourceTime:sourceTime()};
    if(!attentionDraft.mix)delete point.attentionMix;
    attentionPreview=createCameraSampler({mode:'static',anchorId:followId,points:[point]},{resolveTarget:id=>bodyPosition(id)});
    const sampled=attentionPreview(0,anchor());
    if(sampled){view.controls.target.fromArray(sampled.target);view.camera.lookAt(view.controls.target);view.controls.update();}
    if(!attentionDraft.ids.length&&!attentionDraft.mix)attentionPreview=null;
  }
  function previewSampledAttention(point){
    attentionPreview=point?.attentionMix?createCameraSampler({mode:'static',anchorId:rig.anchorId,points:[{time:0,sourceTime:0,position:[6,4,8],target:[0,0,0],fov:40,attentionMix:point.attentionMix}]},{resolveTarget:id=>bodyPosition(id)}):null;
  }
  function readAttentionInputs(){
    attentionDraft.transition=$('camera-attention-transition').value;
    attentionDraft.offset=[0,1,2].map(index=>Number($(`camera-attention-offset-${index}`).value));
    if(!valid(attentionDraft.offset)||attentionDraft.offset.some(value=>Math.abs(value)>1e8)){notify('Смещение цели должно содержать три конечные координаты.');return false;}
    return true;
  }
  async function applyAttention(){
    if(!canEdit()||recording||!readAttentionInputs())return;
    if($('camera-attention-mode').value==='objects'&&!attentionDraft.ids.length){notify('Добавьте хотя бы один предмет в цель камеры.');return;}
    if(attentionDraft.ids.some(id=>!bodyPosition(id))){notify('В цели есть удалённые предметы. Замените или удалите их.');return;}
    if(mode==='static'&&selectedKey<0){
      if(!rig.points.length){await saveStatic();return;}
      const points=rig.points.map(point=>{const next={...point,...attentionPointFields()};if(!attentionDraft.mix)delete next.attentionMix;return next;});
      await save({...rig,points},'Цель ракурса сохранена. Положение камеры не изменилось.');refreshAttentionPreview();return;
    }
    if(selectedKey<0){notify('Выберите ключ или добавьте новый с этой целью.');return;}
    const points=structuredClone(rig.points),index=selectedKey;
    points[index]={...points[index],...attentionPointFields()};if(!attentionDraft.mix)delete points[index].attentionMix;
    await save({...rig,points},'Цель внимания ключа сохранена.');selectedKey=index;draw();await showMoment(rig.points[index].time);
  }
  function elapsed(){return recording?clamp((performance.now()-recordStarted)/1000,0,120):cursor;}
  function drawClock(){const t=elapsed();$('camera-movie-clock').textContent=clock(t);$('camera-source-clock').textContent=clock(sourceTime());if(recording){$('camera-on-air').textContent='REC · '+clock(t);$('camera-take-status').textContent=`${recordPoints.length} отсчётов · камера пишет`;}}
  function fillCoordinates(point){for(const name of ['position','target'])point[name].forEach((v,i)=>$( `camera-${name}-${i}`).value=Number(v.toFixed(4)));}
  async function showMoment(time){
    if(recording||isRehearsal()||!rig.points.length)return;
    const version=++seekVersion;cursor=clamp(time,0,rig.duration);
    let point=cameraSample(cursor,bodyPosition(rig.anchorId)||[0,0,0]);
    pause();seeking=true;drawState();
    seekQueue=seekQueue.catch(()=>{}).then(async()=>{
      if(version!==seekVersion)return;
      await seekPhysics(point.sourceTime);if(version!==seekVersion)return;
      point=cameraSample(cursor,bodyPosition(rig.anchorId)||[0,0,0]);apply(point);previewSampledAttention(point);drawClock();
    });
    try{await seekQueue;}catch(error){notify(error?.message||'Не удалось перейти к моменту физики');}
    finally{if(version===seekVersion){seeking=false;drawState();}}
  }
  async function setMode(next){
    if(!modes.some(([id])=>id===next)||!canEdit())return;
    if(recording)await stop();
    let nextRig={...rig,mode:next};
    try{if(next==='keys'&&rig.points.length>12)nextRig=simplifyCameraRig(rig,12);}
    catch(error){notify(error?.message||'Не удалось сократить маршрут камеры.');return;}
    const message=next==='keys'&&rig.points.length>12?reductionMessage(nextRig):'';
    if(!await save({...nextRig,mode:next},message))return;
    selectedKey=-1;if(next==='keys')panel.hidden=false;
    followId=rig.anchorId||'';anchorLast=followId?bodyPosition(followId):null;setPortrait();fillAttention(next==='static'?rig.points[0]:null);draw();
  }
  function reductionMessage(next){const count=next.points.length;return`Сохранено ${count} ${plural(count,'ключ','ключа','ключей')}.${count>12?' Склейки, время и смены целей требуют больше 12 ключей.':''} Исходный дубль можно вернуть отменой.`;}
  async function start(){
    if(!canEdit()||recording)return;
    if(followId&&!bodyPosition(followId)){notify('Опора не найдена. Выберите существующий предмет.');return;}
    busy=true;drawState();pause();
    const position=view.camera.position.clone(),target=view.controls.target.clone(),fov=view.camera.fov,oldAnchor=followId?bodyPosition(followId):null;
    try{
      await reset();view.autoMode='free';view.camera.position.copy(position);view.controls.target.copy(target);view.camera.fov=fov;view.camera.updateProjectionMatrix();
      anchorLast=followId?bodyPosition(followId):null;
      if(oldAnchor&&anchorLast){const delta=target.clone().fromArray(anchorLast).sub(target.clone().fromArray(oldAnchor));view.camera.position.add(delta);view.controls.target.add(delta);}
      mode='recorded';recordPoints=[];cursor=0;pendingCut=false;recordStarted=performance.now();nextSample=1/30;recording=true;
      recordPoints.push(snapshot(0));play();notify('Камера записывается. Физику можно ставить на паузу.');
    }catch(error){notify(error?.message||'Не удалось начать съёмку');}
    finally{busy=false;setPortrait();draw();}
  }
  async function stop(){
    if(!recording)return;
    const time=elapsed();if(!isRehearsal()&&time-(recordPoints.at(-1)?.time||0)>.001&&recordPoints.length<3601)recordPoints.push(snapshot(time));
    recording=false;pause();cursor=time;
    const next={version:1,mode:'recorded',anchorId:followId,interpolation:rig.interpolation,duration:time,points:recordPoints};
    await save(next,`Дубль сохранён · ${clock(time)}. Его можно снять заново или перевести в ключи.`);
  }
  async function saveStatic(){
    if(!canEdit())return;
    const duration=clamp(finite($('camera-duration').value,settings().story?.duration||20),.1,120),physical=clamp(finite(settings().simulationDuration,duration),0,20);
    const p=snapshot(0,0);await save({...rig,mode:'static',anchorId:followId,points:[p,{...p,time:duration,sourceTime:physical}]},'Ракурс сохранён. Камера остаётся на месте, физика продолжает движение.');
  }
  async function addKey(){
    if(!canEdit()||recording)return;
    const time=Number($('camera-key-time').value);if(!Number.isFinite(time)||time<0||time>120){notify('Время ключа должно быть от 0 до 120 секунд.');return;}
    const point=snapshot(time);point.cut=$('camera-key-cut').checked;
    await save({...rig,mode:'keys',anchorId:rig.points.length?rig.anchorId:followId,points:[...rig.points,point]},'Ключ добавлен из текущего ракурса.');
    selectedKey=-1;$('camera-key-time').value=Math.min(120,time+2);$('camera-key-source').value=sourceTime();fillCoordinates(point);draw();
  }
  async function selectKey(index){
    const point=rig.points[index];if(!point)return;selectedKey=index;cursor=point.time;
    $('camera-key-time').value=point.time;$('camera-key-source').value=point.sourceTime;$('camera-key-cut').checked=point.cut;fillCoordinates(point);fillAttention(point);draw();await showMoment(point.time);
  }
  async function applyKey(){
    if(!canEdit()||selectedKey<0||!rig.points[selectedKey])return;
    if(!readAttentionInputs())return;
    const point={time:Number($('camera-key-time').value),sourceTime:Number($('camera-key-source').value),fov:clamp(view.camera.fov,20,75),cut:$('camera-key-cut').checked,...attentionPointFields()};
    for(const name of ['position','target'])point[name]=[0,1,2].map(i=>Number($(`camera-${name}-${i}`).value));
    if(!valid(point.position)||!valid(point.target)||[...point.position,...point.target].some(v=>Math.abs(v)>1e8)||!Number.isFinite(point.time)||point.time<0||point.time>120||!Number.isFinite(point.sourceTime)||point.sourceTime<0||point.sourceTime>20){notify('Проверьте координаты и время: видео 0–120 с, физика 0–20 с.');return;}
    if(Math.hypot(...point.position.map((v,i)=>v-point.target[i]))<.005){notify('Положение камеры и точка взгляда должны различаться.');return;}
    const points=rig.points.filter((_,i)=>i!==selectedKey);points.push(point);await save({...rig,points},'Ключ обновлён.');selectedKey=rig.points.findIndex(p=>Math.abs(p.time-point.time)<.0001);await selectKey(selectedKey);
  }
  $('camera-action').onclick=()=>recording?stop():mode==='static'?saveStatic():mode==='keys'?addKey():start();
  $('camera-physics').onclick=()=>{if(!isRehearsal()){if(isPlaying())pause();else play();drawState();}};
  $('camera-montage').onclick=()=>{panel.hidden=!panel.hidden;drawState();};$('camera-panel-close').onclick=()=>{panel.hidden=true;drawState();};
  bar.querySelectorAll('[data-camera-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.cameraMode));
  $('camera-fov').oninput=()=>{if(!manual()||isRehearsal())return;view.camera.fov=Number($('camera-fov').value);view.camera.updateProjectionMatrix();$('camera-fov-value').textContent=`${Math.round(view.camera.fov)}°`;};
  $('camera-duration').onchange=async()=>{if(!canEdit())return;selectedKey=-1;await save(retimeCameraRig({...rig,duration:Number($('camera-duration').value)},Number($('camera-duration').value)));};
  $('camera-interpolation').onchange=()=>{if(canEdit())save({...rig,interpolation:$('camera-interpolation').value});};
  $('camera-follow').onchange=()=>{
    if(!canEdit())return;
    const id=$('camera-follow').checked?getSelected():'';
    if(id&&!bodyPosition(id)||$('camera-follow').checked&&!id){notify('Сначала выберите предмет, за которым должна следовать камера.');$('camera-follow').checked=!!followId;return;}
    followId=id||'';anchorLast=bodyPosition(followId);drawState();
  };
  $('camera-scrub').oninput=()=>{if(recording||isRehearsal())return;cursor=Number($('camera-scrub').value);const point=cameraSample(cursor,bodyPosition(rig.anchorId)||[0,0,0]);apply(point);previewSampledAttention(point);$('camera-movie-clock').textContent=clock(cursor);};
  $('camera-scrub').onchange=()=>showMoment(Number($('camera-scrub').value));
  $('camera-key-list').onclick=event=>{const button=event.target.closest('[data-camera-key]');if(button&&!recording)selectKey(Number(button.dataset.cameraKey));};
  $('camera-attention-mode').onchange=()=>{if(!canEdit())return;attentionDraft.mix=null;if($('camera-attention-mode').value==='point')attentionDraft.ids=[];drawAttention();drawState();refreshAttentionPreview();};
  const addAttentionTarget=id=>{if(!canEdit()||!id||attentionDraft.ids.includes(id))return;if(attentionDraft.ids.length>=16){notify('В одной цели может быть до 16 предметов.');return;}attentionDraft.mix=null;attentionDraft.ids.push(id);$('camera-attention-mode').value='objects';drawAttention();drawState();refreshAttentionPreview();};
  $('camera-attention-add').onchange=()=>addAttentionTarget($('camera-attention-add').value);
  $('camera-attention-selected').onclick=()=>{const id=getSelected();if(!id){notify('Сначала выберите предмет в сцене.');return;}addAttentionTarget(id);};
  $('camera-attention-chips').onclick=event=>{const button=event.target.closest('[data-remove-attention]');if(!button||!canEdit())return;attentionDraft.ids=attentionDraft.ids.filter(id=>id!==button.dataset.removeAttention);drawAttention();refreshAttentionPreview();};
  for(const index of [0,1,2])$(`camera-attention-offset-${index}`).onchange=()=>{if(canEdit()&&readAttentionInputs())refreshAttentionPreview();};
  $('camera-attention-transition').onchange=()=>{if(canEdit())readAttentionInputs();};
  $('camera-attention-apply').onclick=applyAttention;
  $('camera-add-key').onclick=addKey;$('camera-apply-key').onclick=applyKey;
  $('camera-delete-key').onclick=async()=>{if(canEdit()&&selectedKey>=0){await save({...rig,points:rig.points.filter((_,i)=>i!==selectedKey)},'Ключ удалён.');selectedKey=-1;draw();}};
  $('camera-clear-keys').onclick=async()=>{if(canEdit()){selectedKey=-1;await save({...rig,mode:'keys',points:[],duration:settings().story?.duration||20},'Новый маршрут. Предыдущий можно вернуть отменой.');$('camera-key-time').value=0;draw();}};
  $('camera-to-keys').onclick=async()=>{
    if(!canEdit()||!rig.points.length)return;
    let next;try{next=simplifyCameraRig(rig,12);}catch(error){notify(error?.message||'Не удалось сократить маршрут камеры.');return;}
    if(await save(next,reductionMessage(next))){selectedKey=-1;setPortrait();draw();}
  };
  const onKeyDown=event=>{
    if(!manual()||isRehearsal()||event.target?.closest?.('input,textarea,select,button,[contenteditable=true],dialog'))return;
    if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(event.code)){held.add(event.code);event.preventDefault();}
  };
  const onKeyUp=event=>held.delete(event.code),onBlur=()=>held.clear();
  document.addEventListener('keydown',onKeyDown);document.addEventListener('keyup',onKeyUp);window.addEventListener('blur',onBlur);
  const onWorkflow=event=>{
    if(event.detail?.mode==='shoot'){
      if(mode==='auto')void setMode('recorded');
      else{setPortrait();if(rig.points.length)void showMoment(cursor);}
    }else if(event.detail?.mode==='build'){
      if(recording)void stop();panel.hidden=true;setPortrait();drawState();
    }
  };
  document.addEventListener('matter:workflow',onWorkflow);
  const resizeObserver=new ResizeObserver(()=>{if(manual())requestAnimationFrame(()=>view.resize());});resizeObserver.observe(wrap);
  function update(delta=1/60){
    if(isRehearsal()){held.clear();if(recording&&!rehearsalSince)rehearsalSince=performance.now();return;}
    if(rehearsalSince){if(recording)recordStarted+=performance.now()-rehearsalSince;rehearsalSince=0;}
    if(!manual())return;
    view.autoMode='free';
    if(followId){const current=bodyPosition(followId);if(current){if(anchorLast){const d=view.controls.target.clone().fromArray(current).sub(view.controls.target.clone().fromArray(anchorLast));view.camera.position.add(d);view.controls.target.add(d);}anchorLast=current;}}
    if(attentionPreview){const point=attentionPreview(0,anchor());if(point){view.controls.target.fromArray(point.target);view.camera.lookAt(view.controls.target);}}
    if(held.size){
      const forward=view.controls.target.clone().sub(view.camera.position).normalize(),right=forward.clone().cross(view.camera.up).normalize(),up=view.camera.up.clone().normalize();
      const velocity=clamp(view.camera.position.distanceTo(view.controls.target)*.65,.2,40)*clamp(finite(delta,1/60),0,.1)*(held.has('ShiftLeft')||held.has('ShiftRight')?3:1),motion=forward.clone().set(0,0,0);
      if(held.has('KeyW'))motion.add(forward);if(held.has('KeyS'))motion.sub(forward);if(held.has('KeyD'))motion.add(right);if(held.has('KeyA'))motion.sub(right);if(held.has('KeyE'))motion.add(up);if(held.has('KeyQ'))motion.sub(up);
      if(motion.lengthSq()){motion.normalize().multiplyScalar(velocity);view.camera.position.add(motion);view.controls.target.add(motion);}
    }
    if(performance.now()-lastClockDraw>100){lastClockDraw=performance.now();drawClock();const label=isPlaying()?'Пауза физики':'Запустить физику';if($('camera-physics').querySelector('span')?.textContent!==label)drawState();}
  }
  function sample(){
    if(!recording||isRehearsal())return;
    const time=elapsed();if(time+1e-7>=nextSample&&recordPoints.length<3601){recordPoints.push(snapshot(time));pendingCut=false;nextSample=(Math.floor(time*30+1e-6)+1)/30;}
    if(time>=120||recordPoints.length>=3601)void stop();
  }
  function sync(){
    const source=getState()?.settings?.cameraRig;if(source===lastSource||recording||busy)return;
    lastSource=source;rig=normalizeCameraRig(source);cameraSample=createCameraSampler(rig,{resolveTarget:id=>bodyPosition(id)});mode=rig.mode;followId=rig.anchorId;anchorLast=bodyPosition(followId);selectedKey=-1;cursor=0;fillAttention(mode==='static'?rig.points[0]:null);setPortrait();draw();
  }
  function focus(id){if(!manual()||isRehearsal())return;const p=bodyPosition(id);if(!p)return;view.controls.target.fromArray(p);view.camera.lookAt(view.controls.target);view.controls.update();pendingCut=recording;}
  function open(){if(mode==='auto')void setMode('recorded');panel.hidden=false;draw();}
  lastSource=getState()?.settings?.cameraRig;setPortrait();
  if(manual()&&rig.points.length)apply(cameraSample(0,bodyPosition(rig.anchorId)||[0,0,0]));
  fillCoordinates(snapshot(0));fillAttention(mode==='static'?rig.points[0]:null);draw();
  return{update,sample,sync,stop,focus,setMode,open,get configuredManual(){return mode!=='auto';},get active(){return manual()&&!isRehearsal();},get recording(){return recording;},destroy(){held.clear();recording=false;document.removeEventListener('keydown',onKeyDown);document.removeEventListener('keyup',onKeyUp);window.removeEventListener('blur',onBlur);document.removeEventListener('matter:workflow',onWorkflow);resizeObserver.disconnect();mode='auto';setPortrait();bar.remove();panel.remove();badge.remove();}};
}
