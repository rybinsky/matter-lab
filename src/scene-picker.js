import './scene-picker.css';

const mounted=new WeakMap();
let serial=0;
const chevron='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5.5 8 4.5 4.5L14.5 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const check='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 10 3.2 3.2L15 6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A bounded, keyboard-accessible view of the existing native scene control.
 * The select remains the source of options and dispatches its usual change
 * event; this component never owns project state or simulation behavior.
 */
export function mountScenePicker({select,syncTarget}={}){
 if(!select||select.tagName!=='SELECT')throw new Error('Scene picker requires its existing select.');
 if(mounted.has(select))return mounted.get(select);
 const id=`scene-picker-${++serial}`,nativeState={tabindex:select.getAttribute('tabindex'),aria:select.getAttribute('aria-hidden')};
 const trigger=document.createElement('button');
 trigger.type='button';trigger.className='scene-picker-trigger';trigger.id=id+'-trigger';
 trigger.setAttribute('aria-label','Выбрать сцену');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id+'-popup');
 trigger.innerHTML='<span class="scene-picker-trigger-label"></span><span class="scene-picker-trigger-chevron">'+chevron+'</span>';
 const title=trigger.querySelector('.scene-picker-trigger-label');
 select.classList.add('scene-picker-native');select.setAttribute('tabindex','-1');select.setAttribute('aria-hidden','true');select.after(trigger);
 const popup=document.createElement('div');
 popup.id=id+'-popup';popup.className='scene-picker-popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Выбор сцены');
 popup.innerHTML=`<div class="scene-picker-heading"><span>Сцены</span><span class="scene-picker-count"></span></div><label class="scene-picker-search"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.6" cy="8.6" r="5.1" stroke="currentColor" stroke-width="1.5"/><path d="m12.5 12.5 3.8 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><input type="search" placeholder="Найти сцену" aria-label="Поиск сцен" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${id}-list" autocomplete="off" spellcheck="false"/></label><div id="${id}-list" class="scene-picker-options" role="listbox" aria-label="Сцены"></div><p class="scene-picker-empty" hidden>Сцены не найдены</p>`;
 document.body.append(popup);
 const search=popup.querySelector('input'),list=popup.querySelector('.scene-picker-options'),empty=popup.querySelector('.scene-picker-empty'),count=popup.querySelector('.scene-picker-count');
 let active=-1,filtered=[],opened=false,destroyed=false,positionFrame;
 const options=()=>Array.from(select.options).map((option,index)=>({label:option.textContent.trim(),value:option.value,disabled:option.disabled,index}));
 const locked=()=>select.disabled||select.inert||!!select.closest('[inert]');
 function sync(){
  if(destroyed)return;
  title.textContent=select.selectedOptions[0]?.textContent.trim()||'Выбрать сцену';trigger.title=title.textContent;
  trigger.disabled=locked();trigger.hidden=select.hidden;
  if(opened){if(trigger.disabled||trigger.hidden)close(false);else render();}
 }
 function position(){
  if(!opened)return;
  const r=trigger.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=window.innerHeight;
  const width=Math.max(0,Math.min(Math.max(r.width,320),420,vw-24));
  popup.style.width=width+'px';
  popup.style.left=Math.max(12,Math.min(r.left,vw-width-12))+'px';
  const desired=Math.min(480,104+Math.max(1,filtered.length)*44),below=vh-r.bottom-10,above=r.top-10;
  const upwards=below<Math.min(desired,240)&&above>below;
  const available=Math.max(0,upwards?above:below),height=Math.min(desired,Math.max(128,available),vh-24);
  popup.style.maxHeight=height+'px';
  popup.style.top=Math.max(12,Math.min(upwards?r.top-height-7:r.bottom+7,vh-height-12))+'px';
  popup.dataset.side=upwards?'above':'below';
 }
 function queuePosition(){cancelAnimationFrame(positionFrame);positionFrame=requestAnimationFrame(position);}
 function highlight(index,{scroll=false}={}){
  const available=filtered.map((option,i)=>option.disabled?-1:i).filter(i=>i>=0);
  active=available.includes(index)?index:(available[0]??-1);
  for(const node of list.children)node.classList.toggle('is-focused',Number(node.dataset.index)===active);
  if(active>=0){search.setAttribute('aria-activedescendant',id+'-option-'+active);if(scroll)list.children[active]?.scrollIntoView({block:'nearest'});}
  else search.removeAttribute('aria-activedescendant');
 }
 function render(){
  const previous=filtered[active]?.value,query=search.value.trim().toLocaleLowerCase('ru-RU');
  filtered=options().filter(option=>!query||option.label.toLocaleLowerCase('ru-RU').includes(query));
  list.replaceChildren();
  for(const[ index,option]of filtered.entries()){
   const row=document.createElement('button');row.type='button';row.className='scene-picker-option';row.id=id+'-option-'+index;row.dataset.index=index;row.tabIndex=-1;row.disabled=option.disabled;
   row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.value===select.value));
   const label=document.createElement('span');label.textContent=option.label;row.append(label);
   const mark=document.createElement('span');mark.className='scene-picker-option-check';mark.innerHTML=check;row.append(mark);list.append(row);
  }
  empty.hidden=filtered.length!==0;count.textContent=String(filtered.length);
  const preferred=filtered.findIndex(option=>option.value===(previous??select.value));highlight(preferred);
  queuePosition();
 }
 function open(){
  sync();if(trigger.disabled||trigger.hidden)return;
  opened=true;popup.hidden=false;trigger.setAttribute('aria-expanded','true');search.value='';active=-1;render();position();search.focus({preventScroll:true});
 }
 function close(returnFocus=true){
  if(!opened)return;opened=false;popup.hidden=true;trigger.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');cancelAnimationFrame(positionFrame);
  if(returnFocus&&!trigger.disabled)trigger.focus({preventScroll:true});
 }
 function choose(index){
  const option=filtered[index];if(!option||option.disabled||locked())return;
  const changed=select.value!==option.value;select.value=option.value;close();
  if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
  sync();
 }
 function move(direction){
  const available=filtered.map((option,i)=>option.disabled?-1:i).filter(i=>i>=0);if(!available.length)return;
  const index=available.indexOf(active),next=(index+direction+available.length)%available.length;highlight(available[next],{scroll:true});
 }
 const onTriggerClick=()=>opened?close():open();
 const onTriggerKey=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();if(event.key==='ArrowUp')highlight(filtered.length-1,{scroll:true});}};
 const onSearchKey=event=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();move(event.key==='ArrowDown'?1:-1);}
  else if(event.key==='Home'){event.preventDefault();highlight(0,{scroll:true});}
  else if(event.key==='End'){event.preventDefault();highlight(filtered.length-1,{scroll:true});}
  else if(event.key==='Enter'){event.preventDefault();choose(active);}
  else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
  else if(event.key==='Tab')close(false);
 };
 const onPointer=event=>{if(opened&&!popup.contains(event.target)&&!trigger.contains(event.target))close(false);};
 const onFocus=event=>{if(opened&&!popup.contains(event.target)&&!trigger.contains(event.target))close(false);};
 const onRowClick=event=>{const row=event.target.closest('[data-index]');if(row&&list.contains(row))choose(Number(row.dataset.index));};
 const onRowPointer=event=>{const row=event.target.closest('[data-index]');if(row&&list.contains(row)&&!row.disabled)highlight(Number(row.dataset.index));};
 trigger.addEventListener('click',onTriggerClick);trigger.addEventListener('keydown',onTriggerKey);
 search.addEventListener('input',render);search.addEventListener('keydown',onSearchKey);list.addEventListener('click',onRowClick);list.addEventListener('pointermove',onRowPointer);
 select.addEventListener('change',sync);document.addEventListener('pointerdown',onPointer);document.addEventListener('focusin',onFocus);
 window.addEventListener('resize',queuePosition);window.addEventListener('scroll',queuePosition,true);
 const observer=new MutationObserver(sync);observer.observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','inert','hidden','selected','label']});
 for(let ancestor=select.parentElement;ancestor;ancestor=ancestor.parentElement)observer.observe(ancestor,{attributes:true,attributeFilter:['inert']});
 const target=syncTarget||select.closest('.stage-column')?.querySelector('#presets');if(target)observer.observe(target,{childList:true});
 const api={open,close,sync,trigger,destroy(){
  close(false);destroyed=true;observer.disconnect();trigger.remove();popup.remove();select.classList.remove('scene-picker-native');
  for(const[name,value]of [['tabindex',nativeState.tabindex],['aria-hidden',nativeState.aria]])if(value===null)select.removeAttribute(name);else select.setAttribute(name,value);
  select.removeEventListener('change',sync);document.removeEventListener('pointerdown',onPointer);document.removeEventListener('focusin',onFocus);window.removeEventListener('resize',queuePosition);window.removeEventListener('scroll',queuePosition,true);mounted.delete(select);
 }};
 mounted.set(select,api);sync();return api;
}
