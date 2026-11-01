import './connection-editor.css';
import { objectLabelMap } from './object-labels.js';
import {CONNECTION_TYPES as TYPES,connectionForm,connectionFromForm} from './connection-authoring.js';
export {connectionForm,connectionFromForm} from './connection-authoring.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const WORLD='world';
const world=id=>id===undefined||id===null||id===''||id===WORLD;

/** Edits saved author links only. Persistence, validation and reset are host-owned. */
export function mountConnectionEditor({getState,getEntities,commitConnections,onCreate,notify=()=>{},icons=()=>{}}){
  if(![getState,getEntities,commitConnections].every(fn=>typeof fn==='function'))throw new Error('Редактору связей нужны проект, список предметов и сохранение.');
  if(document.getElementById('connection-editor-dialog'))throw new Error('Редактор связей уже подключён.');
  const dialog=document.createElement('dialog');dialog.id='connection-editor-dialog';dialog.className='connection-editor';dialog.setAttribute('aria-labelledby','connection-editor-title');
  dialog.innerHTML=`<header class="ce-header"><div><span class="ce-eyebrow">СЦЕНА</span><h2 id="connection-editor-title">Связи предметов</h2><p>Шарниры, подвесы и пружины, которые вы добавили в проект.</p></div><button type="button" class="ce-icon" id="connection-editor-close" aria-label="Закрыть без сохранения"><i data-lucide="x"></i></button></header><form id="connection-editor-form"><div class="ce-workspace"><aside class="ce-sidebar"><div class="ce-list-tools"><label class="ce-search"><i data-lucide="search"></i><input type="search" id="connection-editor-search" placeholder="Найти связь…" aria-label="Найти связь"/></label><button type="button" class="ce-create" id="connection-editor-create"><i data-lucide="plus"></i>Добавить связь</button></div><div class="ce-list-heading">В проекте <span id="connection-editor-count">0</span></div><ol id="connection-editor-list" class="ce-list" aria-label="Сохранённые связи"></ol><p class="ce-list-note">Встроенные механизмы шаблонов сюда не входят.</p></aside><section class="ce-details"><div id="connection-editor-empty" class="ce-empty"><i data-lucide="link-2"></i><h3>Добавьте первую связь</h3><p>Соедините предметы между собой или закрепите один предмет в пространстве.</p></div><fieldset id="connection-editor-fields" hidden><div class="ce-detail-heading"><span id="connection-editor-selected-type"></span><button type="button" id="connection-editor-delete" class="ce-delete"><i data-lucide="trash-2"></i>Удалить связь</button></div><label class="ce-label" for="connection-editor-name">Название <span>необязательно</span></label><input id="connection-editor-name" maxlength="160" placeholder="Например, подвес груза"/><div class="ce-two-columns"><label class="ce-label">Первый предмет<select id="connection-editor-a"></select></label><label class="ce-label">Второй предмет или опора<select id="connection-editor-b"></select></label></div><div class="ce-two-columns ce-kind-row"><label class="ce-label">Тип связи<select id="connection-editor-type">${Object.entries(TYPES).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label class="ce-label" id="connection-editor-axis-wrap">Ось шарнира<select id="connection-editor-axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label></div><p id="connection-editor-type-note" class="ce-help"></p><section id="connection-editor-point-wrap" class="ce-section"><label class="ce-check"><input type="checkbox" id="connection-editor-point-enabled"/>Задать точку связи в мире</label><div class="ce-three-columns" id="connection-editor-point-fields">${['X','Y','Z'].map((axis,index)=>`<label class="ce-label">${axis}, м<input id="connection-editor-point-${index}" type="number" min="-10000" max="10000" step="any"/></label>`).join('')}</div><p class="ce-help" id="connection-editor-point-note"></p></section><section id="connection-editor-spring-wrap" class="ce-section" hidden><h3>Пружина</h3><div class="ce-spring-grid"><label class="ce-label">Длина покоя, м<input id="connection-editor-length" type="number" min="0" max="10000" step="any" placeholder="По расстоянию при старте"/></label><label class="ce-label">Жёсткость, Н/м<input id="connection-editor-stiffness" type="number" min="0" max="100000000" step="any" placeholder="120"/></label><label class="ce-label">Затухание<input id="connection-editor-damping" type="number" min="0" max="1000000" step="any" placeholder="8"/></label></div><p class="ce-help">Пустое поле оставляет исходное значение по умолчанию.</p></section></fieldset><p id="connection-editor-error" class="ce-error" role="alert" hidden></p></section></div><footer class="ce-footer"><span id="connection-editor-status">После сохранения опыт начнётся заново.</span><button type="button" id="connection-editor-reset" class="ce-button">Вернуть исходные</button><button type="button" id="connection-editor-cancel" class="ce-button">Отмена</button><button type="submit" id="connection-editor-save" class="ce-button ce-primary"><i data-lucide="check"></i>Сохранить изменения</button></footer></form>`;
  document.body.append(dialog);
  dialog.querySelector('#connection-editor-fields').insertAdjacentHTML('beforeend',`<section class="ce-section" id="connection-editor-rope-wrap" hidden><h3>Идеальная невесомая верёвка</h3><div class="ce-spring-grid" id="connection-editor-rope-length-slot"></div><p class="ce-help">Ограничивает максимальное расстояние между креплениями, свободно провисает при сближении и не работает на сжатие. Растяжение, масса и контакт самой нити не рассчитываются.</p>${['A','B'].map((end,index)=>`<p class="ce-label" id="connection-editor-anchor-${end}-label">${index?'Второе':'Первое'} крепление · локальные координаты, м</p><div class="ce-three-columns">${['X','Y','Z'].map((axis,i)=>`<label class="ce-label">${axis}, м<input type="number" step="any" min="-10000" max="10000" id="connection-editor-anchor-${end}-${i}"/></label>`).join('')}</div>`).join('')}<p class="ce-help">Точки заданы в локальных метрах тела после его масштаба и вращаются вместе с ним. Пустая длина определяется по расстоянию между этими точками при старте. Прямая графическая линия показывает концы; форма провиса не решается.</p></section>`);
  dialog.querySelector('#connection-editor-fields').insertAdjacentHTML('beforeend','<section class="ce-section"><label class="ce-check"><input type="checkbox" id="connection-editor-visual-enabled"/>Показывать соединение в кадре</label><div class="ce-spring-grid" id="connection-editor-visual-fields"><label class="ce-label">Цвет<input id="connection-editor-visual-color" type="color"/></label><label class="ce-label">Радиус линии, м<input id="connection-editor-visual-radius" type="number" step="any" min=".00025" max="1"/></label><label class="ce-label" id="connection-editor-visual-coils-wrap">Витки пружины<input id="connection-editor-visual-coils" type="number" min="3" max="16" step="1"/></label></div><p class="ce-help">Графика следует точкам физической связи и не добавляет ей массу или жёсткость.</p></section>');
  const $=id=>dialog.querySelector(`#${id}`);
  let forms=[],selected=-1,busy=false,signature='',destroyed=false;
  const current=()=>{const state=getState();return Array.isArray(state?.settings?.connections)?state.settings.connections:Array.isArray(state?.connections)?state.connections:[];};
  const entities=()=>{const value=getEntities();return Array.isArray(value)?value:[];};
  const dirty=()=>JSON.stringify(forms.map(form=>form))!==signature;
  function error(message){$('connection-editor-error').textContent=message;$('connection-editor-error').hidden=!message;}
  function names(){return objectLabelMap(entities());}
  function label(id,map){return world(id)?'Пространство':map.get(id)||`Не найден: ${id}`;}
  function store(){
    if(selected<0||!forms[selected])return;
    const form=forms[selected];for(const key of ['name','a','b','type','axis','length','stiffness','damping'])form[key]=$(`connection-editor-${key}`).value;
    form.visualEnabled=$('connection-editor-visual-enabled').checked;form.visualColor=$('connection-editor-visual-color').value;form.visualRadius=$('connection-editor-visual-radius').value;form.visualCoils=$('connection-editor-visual-coils').value;
    form.pointEnabled=$('connection-editor-point-enabled').checked;form.point=[0,1,2].map(index=>$(`connection-editor-point-${index}`).value);
    for(const end of ['A','B'])form[`anchor${end}`]=[0,1,2].map(i=>$(`connection-editor-anchor-${end}-${i}`).value);
  }
  function renderList(){
    const map=names(),query=$('connection-editor-search').value.trim().toLocaleLowerCase('ru-RU'),items=forms.map((form,index)=>({form,index})).filter(({form})=>`${form.name} ${TYPES[form.type]||''} ${label(form.a,map)} ${label(form.b,map)}`.toLocaleLowerCase('ru-RU').includes(query));
    $('connection-editor-count').textContent=forms.length;
    $('connection-editor-list').innerHTML=items.length?items.map(({form,index})=>`<li><button type="button" data-connection-index="${index}" class="${selected===index?'is-selected':''}" aria-pressed="${selected===index}"><span class="ce-index">${String(index+1).padStart(2,'0')}</span><span class="ce-link-copy"><strong>${escape(form.name||TYPES[form.type]||'Связь')}</strong><span>${escape(label(form.a,map))} <b>↔</b> ${escape(label(form.b,map))}</span><small>${escape(TYPES[form.type]||'Связь')}</small></span></button></li>`).join(''):`<li class="ce-no-results">${forms.length?'Ничего не найдено.':'Сохранённых связей пока нет.'}</li>`;
    $('connection-editor-status').textContent=dirty()?'Есть изменения. При сохранении опыт начнётся заново.':'После сохранения опыт начнётся заново.';
    $('connection-editor-reset').disabled=busy||!dirty();
  }
  function selectOptions(form){
    const all=entities(),map=objectLabelMap(all),available=all.filter(e=>e.id&&e.id!=='ground'&&!e.soft&&e.asset!=='softcube'),option=e=>`<option value="${escape(e.id)}">${escape(map.get(e.id)||e.name||e.id)}</option>`;
    for(const key of ['a','b']){
      const value=form[key],select=$(`connection-editor-${key}`);select.innerHTML=(key==='b'?'<option value="world">Закрепить в пространстве</option>':'<option value="">Выберите предмет…</option>')+available.map(option).join('');
      if(value&&!world(value)&&!available.some(e=>e.id===value))select.insertAdjacentHTML('beforeend',`<option value="${escape(value)}">Не найден: ${escape(value)}</option>`);
      select.value=value;
    }
  }
  function visibility(){
    const type=$('connection-editor-type').value,space=world($('connection-editor-b').value),point=$('connection-editor-point-enabled').checked;
    $('connection-editor-visual-fields').hidden=!$('connection-editor-visual-enabled').checked;$('connection-editor-visual-coils-wrap').hidden=type!=='spring';
    $('connection-editor-axis-wrap').hidden=type!=='hinge';$('connection-editor-spring-wrap').hidden=type!=='spring';$('connection-editor-rope-wrap').hidden=type!=='rope';$('connection-editor-point-wrap').hidden=['spring','rope'].includes(type)&&!space;
    const length=$('connection-editor-length'),slot=type==='rope'?$('connection-editor-rope-length-slot'):$('connection-editor-spring-wrap').querySelector('.ce-spring-grid'),label=length.closest('label');if(label.parentElement!==slot)slot.prepend(label);label.firstChild.textContent=type==='rope'?'Максимальная длина, м':'Длина покоя, м';length.placeholder=type==='rope'?'Между креплениями при старте':'По расстоянию при старте';
    length.disabled=busy||!['spring','rope'].includes(type);for(const key of ['stiffness','damping'])$(`connection-editor-${key}`).disabled=busy||type!=='spring';for(const end of ['A','B'])for(const i of [0,1,2])$(`connection-editor-anchor-${end}-${i}`).disabled=busy||type!=='rope';
    for(const key of ['color','radius','coils'])$(`connection-editor-visual-${key}`).disabled=busy||!$('connection-editor-visual-enabled').checked||key==='coils'&&type!=='spring';
    $('connection-editor-anchor-B-label').textContent=space?'Смещение от точки опоры · локальные метры':'Второе крепление · локальные координаты, м';
    for(const index of [0,1,2])$(`connection-editor-point-${index}`).disabled=busy||!point||$('connection-editor-point-wrap').hidden;
    $('connection-editor-point-note').textContent=space?'Без своей точки опора будет на 1,8 м выше первого предмета.':'Без своей точки связь создаётся посередине между предметами.';
    $('connection-editor-type-note').textContent={hinge:'Предметы вращаются относительно друг друга вокруг выбранной оси.',ball:'Предметы соединены точкой и могут поворачиваться в разные стороны.',fixed:'Относительное положение и поворот предметов сохраняются.',spring:space?'Пружина соединяет центр предмета с опорой в пространстве.':'Пружина соединяет центры двух предметов.',rope:'Верёвка удерживает конечные точки не дальше заданной длины, сохраняя возможность свободного сближения.'}[type]||'';
    $('connection-editor-selected-type').textContent=TYPES[type]||'Связь';
  }
  function drawSelected(){
    const form=forms[selected];$('connection-editor-empty').hidden=!!form;$('connection-editor-fields').hidden=!form;$('connection-editor-fields').disabled=busy||!form;
    if(!form){renderList();return;}
    selectOptions(form);
    for(const key of ['name','type','axis','length','stiffness','damping'])$(`connection-editor-${key}`).value=form[key];
    $('connection-editor-visual-enabled').checked=form.visualEnabled;$('connection-editor-visual-color').value=form.visualColor;$('connection-editor-visual-radius').value=form.visualRadius;$('connection-editor-visual-coils').value=form.visualCoils;
    $('connection-editor-point-enabled').checked=form.pointEnabled;form.point.forEach((value,index)=>$(`connection-editor-point-${index}`).value=value);
    for(const end of ['A','B'])form[`anchor${end}`].forEach((value,i)=>$(`connection-editor-anchor-${end}-${i}`).value=value);
    visibility();renderList();icons();
  }
  function load(preferred){
    forms=structuredClone(current()).map(connectionForm);signature=JSON.stringify(forms);
    selected=typeof preferred==='number'?Math.min(forms.length-1,Math.max(0,preferred)):forms.findIndex(form=>form.source.id===preferred);
    if(selected<0&&forms.length)selected=0;error('');drawSelected();
  }
  function setBusy(value){
    busy=value;for(const node of dialog.querySelectorAll('input,select,button'))node.disabled=value;
    $('connection-editor-fields').disabled=value||selected<0;
    if(!value){visibility();$('connection-editor-reset').disabled=!dirty();$('connection-editor-create').disabled=typeof onCreate!=='function';}
    $('connection-editor-save').innerHTML=value?'Сохранение…':'<i data-lucide="check"></i>Сохранить изменения';icons();
  }
  function close(){if(!busy&&dialog.open)dialog.close();}
  function open(preferred){if(dialog.open||busy||destroyed)return;load(preferred);$('connection-editor-search').value='';renderList();setBusy(false);dialog.showModal();icons();}
  async function save(event){
    event.preventDefault();if(busy)return;store();error('');
    // A host may replace the project while an async import finishes. Avoid
    // overwriting newer links with a stale modal draft.
    if(JSON.stringify(current().map(connectionForm))!==signature){error('Связи в проекте изменились. Нажмите «Вернуть исходные» и повторите правку.');return;}
    let next=[];
    try{next=forms.map((form,index)=>{try{return connectionFromForm(form,entities());}catch(problem){selected=index;drawSelected();throw problem;}});}catch(problem){error(problem.message);return;}
    setBusy(true);
    try{await commitConnections(structuredClone(next));if(!destroyed){dialog.close();notify('Связи сохранены.');}}
    catch(problem){if(!destroyed)error(problem?.message||'Не удалось сохранить связи.');}
    finally{if(!destroyed)setBusy(false);}
  }
  $('connection-editor-form').addEventListener('submit',save);
  $('connection-editor-list').onclick=event=>{const button=event.target.closest('[data-connection-index]');if(!button||busy)return;store();selected=Number(button.dataset.connectionIndex);error('');drawSelected();};
  $('connection-editor-search').oninput=()=>{store();renderList();};
  $('connection-editor-fields').addEventListener('input',()=>{store();visibility();renderList();});
  $('connection-editor-fields').addEventListener('change',()=>{store();visibility();renderList();});
  $('connection-editor-delete').onclick=()=>{if(busy||selected<0)return;store();forms.splice(selected,1);selected=Math.min(selected,forms.length-1);error('');drawSelected();};
  $('connection-editor-reset').onclick=()=>{if(!busy)load(selected);};
  $('connection-editor-create').onclick=()=>{if(busy||typeof onCreate!=='function')return;store();if(dirty()){error('Сохраните изменения или верните исходные перед добавлением новой связи.');return;}dialog.close();onCreate();};
  $('connection-editor-close').onclick=$('connection-editor-cancel').onclick=close;
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
  return{open,close,destroy(){destroyed=true;if(dialog.open)dialog.close();dialog.remove();}};
}
