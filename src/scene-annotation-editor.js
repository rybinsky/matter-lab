import './scene-annotation-editor.css';
import {normalizeSceneAnnotations,SCENE_ANNOTATION_LIMITS} from './scene-annotations.js';
import {objectLabelMap} from './object-labels.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]));
const validPoint=value=>Array.isArray(value)&&value.length===3&&[0,1,2].every(index=>typeof value[index]==='number'&&Number.isFinite(value[index])&&Math.abs(value[index])<=SCENE_ANNOTATION_LIMITS.coordinate);
const toDraft=annotation=>({...annotation,position:annotation.position.map(String),anchorId:annotation.anchorId||'',offset:(annotation.offset||[0,0,0]).map(String),size:String(annotation.size)});
const number=value=>String(value).trim()===''?NaN:Number(value);
const compile=drafts=>normalizeSceneAnnotations(drafts.map(item=>({id:item.id,text:item.text,position:item.position.map(number),color:item.color,size:number(item.size),...(item.anchorId?{anchorId:item.anchorId,offset:item.offset.map(number)}:{})})));

/** Draft-only editor. The host commits annotations into its project, undo
 * history and persistence. Opening/cancelling never changes the source.
 */
export function mountSceneAnnotationEditor({getState,getEntities=()=>[],getSelected=()=>null,commitAnnotations,notify=()=>{},icons=()=>{}}={}){
 if(typeof getState!=='function'||typeof commitAnnotations!=='function')throw new Error('Редактору подписей нужны getState и commitAnnotations.');
 if(document.getElementById('scene-annotation-dialog'))throw new Error('Редактор подписей уже подключён.');
 const dialog=document.createElement('dialog');dialog.id='scene-annotation-dialog';dialog.className='scene-annotation-dialog';dialog.setAttribute('aria-labelledby','sa-title');
 dialog.innerHTML=`<header class="sa-header"><div><span class="sa-eyebrow">СЦЕНА</span><h2 id="sa-title">Подписи в пространстве</h2></div><button type="button" class="sa-icon" id="sa-close" aria-label="Закрыть без сохранения"><i data-lucide="x"></i></button></header><form id="sa-form" novalidate><div class="sa-workspace"><aside class="sa-sidebar" aria-label="Подписи"><div class="sa-list-heading"><strong>Подписи <span id="sa-count"></span></strong><button type="button" class="sa-button" id="sa-add"><i data-lucide="plus"></i>Добавить</button></div><div class="sa-list" id="sa-list"></div></aside><section class="sa-content" aria-label="Настройки подписи"><div id="sa-fields-host"></div></section></div><footer class="sa-footer"><p class="sa-error" id="sa-error" role="alert" hidden></p><span class="sa-status" id="sa-status">Изменения применятся после сохранения.</span><div class="sa-actions"><button type="button" class="sa-button sa-secondary" id="sa-reload">Обновить черновик</button><button type="button" class="sa-button" id="sa-cancel">Отмена</button><button type="submit" class="sa-button sa-primary" id="sa-save"><i data-lucide="check"></i>Сохранить</button></div></footer></form>`;
 document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id);
 let drafts=[],initialDraft='',sourceSignature='',selectedId='',entities=[],labels=new Map(),lastPositions=new Map(),busy=false,destroyed=false;
 const active=()=>drafts.find(item=>item.id===selectedId);
 const dirty=()=>JSON.stringify(drafts)!==initialDraft;
 function fail(message=''){$('sa-error').textContent=message;$('sa-error').hidden=!message;}
 function status(){
  $('sa-count').textContent=`${drafts.length} / ${SCENE_ANNOTATION_LIMITS.count}`;
  $('sa-add').disabled=busy||drafts.length>=SCENE_ANNOTATION_LIMITS.count;
  $('sa-status').textContent=dirty()?'Есть несохранённые изменения.':'Изменения применятся после сохранения.';
 }
 function entityList(state){
  const byId=new Map(),live=getEntities();
  for(const entity of [...(Array.isArray(live)?live:[]),...(Array.isArray(state.objects)?state.objects:[])]){
   const id=entity?.id??entity?.spec?.id;if(typeof id==='string'&&id&&!byId.has(id))byId.set(id,entity);
  }
  return [...byId].map(([id,entity])=>({...entity,id}));
 }
 function drawList(){
  $('sa-list').innerHTML=drafts.length?drafts.map((item,index)=>`<button type="button" class="sa-list-item${item.id===selectedId?' is-selected':''}" data-sa-select="${escape(item.id)}" aria-pressed="${item.id===selectedId}" ${busy?'disabled':''}><span class="sa-list-number">${String(index+1).padStart(2,'0')}</span><span class="sa-list-copy"><strong>${escape(item.text.trim()||'Новая подпись')}</strong><small>${item.anchorId?escape(labels.get(item.anchorId)||'Недоступный предмет'):'Координаты сцены'}</small></span><span class="sa-swatch" style="--sa-swatch:${/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#F4F5F7'}"></span></button>`).join(''):'<div class="sa-empty-list">Подписей пока нет</div>';
  status();
 }
 const vectorFields=(kind,title,values,disabled)=>`<fieldset class="sa-vector" id="sa-${kind}-fields" ${disabled?'disabled':''}><legend>${title}</legend><div>${['X','Y','Z'].map((axis,index)=>`<label><span>${axis}</span><input type="number" id="sa-${kind}-${index}" value="${escape(values[index])}" min="-${SCENE_ANNOTATION_LIMITS.coordinate}" max="${SCENE_ANNOTATION_LIMITS.coordinate}" step="any" aria-label="${kind==='position'?'Положение':'Смещение'} ${axis}, м"/></label>`).join('')}</div></fieldset>`;
 function drawFields(){
  const item=active();
  if(!item){$('sa-fields-host').innerHTML='<div class="sa-empty"><i data-lucide="type"></i><h3>Подпишите точку или предмет</h3><p>Введите свой текст и задайте положение в сцене. Для движущегося предмета выберите привязку.</p><button type="button" class="sa-button" id="sa-empty-add"><i data-lucide="plus"></i>Добавить подпись</button></div>';icons();return;}
  const missing=item.anchorId&&!entities.some(entity=>entity.id===item.anchorId),options=entities.map(entity=>`<option value="${escape(entity.id)}">${escape(labels.get(entity.id)||entity.name||entity.id)}</option>`).join('');
  $('sa-fields-host').innerHTML=`<fieldset class="sa-fields" id="sa-fields" ${busy?'disabled':''}><div class="sa-field-heading"><h3>Настройки подписи</h3><button type="button" id="sa-delete" class="sa-icon sa-danger" aria-label="Удалить выбранную подпись"><i data-lucide="trash-2"></i></button></div><label class="sa-field" for="sa-text"><span>Текст</span><input type="text" id="sa-text" maxlength="80" value="${escape(item.text)}" placeholder="Текст подписи" autocomplete="off"/></label><label class="sa-field" for="sa-anchor"><span>Привязка</span><select id="sa-anchor"><option value="">Координаты сцены</option>${options}${missing?`<option value="${escape(item.anchorId)}">Недоступный предмет · ${escape(item.anchorId)}</option>`:''}</select></label><p class="sa-help" id="sa-anchor-help">${missing?'Предмет сейчас недоступен. Подпись появится, когда он снова будет в сцене.':item.anchorId?'Подпись следует за положением предмета. Смещение задаётся по осям сцены.':'Подпись остаётся в заданной точке сцены.'}</p>${vectorFields('position','Положение в сцене, м',item.position,!!item.anchorId)}${vectorFields('offset','Смещение от предмета, м',item.offset,!item.anchorId)}<div class="sa-style-grid"><label class="sa-field" for="sa-color"><span>Цвет текста</span><div class="sa-color-control"><input type="color" id="sa-color-picker" value="${/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#F4F5F7'}" aria-label="Выбрать цвет подписи"/><input type="text" id="sa-color" value="${escape(item.color)}" maxlength="7" placeholder="#F4F5F7" autocomplete="off" spellcheck="false"/></div></label><label class="sa-field" for="sa-size"><span>Размер текста</span><div class="sa-size-control"><input type="number" id="sa-size" value="${escape(item.size)}" min="14" max="48" step="1"/><span>14–48</span></div></label></div></fieldset>`;
  $('sa-anchor').value=item.anchorId;icons();
 }
 function draw(){drawList();drawFields();}
 function store(){
  const item=active();if(!item||!$('sa-text'))return;
  item.text=$('sa-text').value;item.anchorId=$('sa-anchor').value;item.position=[0,1,2].map(index=>$('sa-position-'+index).value);item.offset=[0,1,2].map(index=>$('sa-offset-'+index).value);item.color=$('sa-color').value;item.size=$('sa-size').value;
  if(validPoint(item.position.map(number)))lastPositions.set(item.id,item.position.slice());
 }
 function load(){
  const state=getState();sourceSignature=JSON.stringify(state);const value=normalizeSceneAnnotations(state.settings?.annotations);
  drafts=value.map(toDraft);initialDraft=JSON.stringify(drafts);lastPositions=new Map(drafts.map(item=>[item.id,item.position.slice()]));entities=entityList(state);labels=objectLabelMap(entities);selectedId=drafts.some(item=>item.id===selectedId)?selectedId:drafts[0]?.id||'';fail();draw();
 }
 function add(){
  if(busy||drafts.length>=SCENE_ANNOTATION_LIMITS.count)return;store();
  const selected=getSelected(),id=typeof selected==='string'?selected:selected?.id??selected?.spec?.id,entity=entities.find(item=>item.id===id),point=entity?.spec?.position??entity?.position;
  const annotation={id:'annotation-'+crypto.randomUUID(),text:'',position:validPoint(point)?point.slice():[0,0,0],...(entity?{anchorId:entity.id,offset:[0,0,0]}:{}),color:'#F4F5F7',size:22};
  const draft=toDraft(annotation);drafts.push(draft);lastPositions.set(draft.id,draft.position.slice());selectedId=annotation.id;fail();draw();$('sa-text')?.focus();
 }
 function setBusy(value){
  busy=value;for(const button of dialog.querySelectorAll('button'))button.disabled=value;if($('sa-fields'))$('sa-fields').disabled=value;
  $('sa-save').innerHTML=value?'Сохранение…':'<i data-lucide="check"></i>Сохранить';if(!value)draw();else icons();
 }
 function close(){if(!busy)dialog.close();}
 function open(){
  if(destroyed||busy||dialog.open)return;
  try{load();dialog.showModal();icons();}catch(error){notify(error?.message||'Не удалось открыть подписи.');}
 }
 $('sa-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;store();fail();let annotations;
  try{
   if(JSON.stringify(getState())!==sourceSignature)throw new Error('Сцена изменилась, пока окно было открыто. Обновите черновик перед сохранением.');
   annotations=compile(drafts);
  }catch(error){fail(error.message);return;}
  if(!dirty()){dialog.close();return;}
  setBusy(true);
  try{await commitAnnotations(structuredClone(annotations));if(!destroyed){dialog.close();notify('Подписи сохранены.');}}
  catch(error){if(!destroyed)fail(error?.message||'Не удалось сохранить подписи.');}
  finally{if(!destroyed)setBusy(false);}
 };
 dialog.addEventListener('input',event=>{
  if(busy)return;
  if(event.target.id==='sa-color-picker'&&$('sa-color'))$('sa-color').value=event.target.value.toUpperCase();
  else if(event.target.id==='sa-color'&&/^#[0-9a-f]{6}$/i.test(event.target.value))$('sa-color-picker').value=event.target.value;
  store();fail();drawList();
 });
 dialog.addEventListener('change',event=>{
  if(busy)return;store();if(event.target.id==='sa-anchor'){
   // The saved world point is inactive while anchored. Preserve its last valid
   // value when switching modes during an unfinished numeric edit.
   const item=active();if(item?.anchorId&&!validPoint(item.position.map(number)))item.position=lastPositions.get(item.id)?.slice()||['0','0','0'];
   drawList();drawFields();
  }
 });
 dialog.addEventListener('click',event=>{
  if(busy)return;const button=event.target.closest('button');if(!button)return;
  if(button.dataset.saSelect){store();selectedId=button.dataset.saSelect;fail();draw();return;}
  if(button.id==='sa-add'||button.id==='sa-empty-add'){add();return;}
  if(button.id==='sa-close'||button.id==='sa-cancel'){close();return;}
  if(button.id==='sa-reload'){try{load();}catch(error){fail(error.message);}return;}
  if(button.id==='sa-delete'){store();const index=drafts.findIndex(item=>item.id===selectedId);if(index<0)return;lastPositions.delete(selectedId);drafts.splice(index,1);selectedId=drafts[Math.min(index,drafts.length-1)]?.id||'';fail();draw();}
 });
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 return{open,destroy(){destroyed=true;if(dialog.open)dialog.close();dialog.remove();}};
}
