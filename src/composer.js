import {PATTERNS,buildLayoutAssembly,layoutPoints,rotate} from './layouts.js';
import {CATALOG} from './catalog.js';

// Use live joint anchors when supplied, so a paused mechanism can be copied
// in its current pose. Plain saved connections remain a supported fallback.
export function snapshotAssemblyConnections(connections,sources,center=[0,0,0]){
 const ids=new Set(sources.map(s=>s.sourceId||s.id).filter(Boolean));
 return connections.filter(c=>ids.has(c.a)||ids.has(c.b)).map(c=>{
  const{joint,aEntity,bEntity,...spec}=c,copy=structuredClone(spec);delete copy.generatorId;
  if(joint?.anchor1&&aEntity?.body&&copy.type!=='spring'){
   const local=joint.anchor1(),body=aEntity.body,p=body.translation();
   copy.point=rotate([local.x,local.y,local.z],body.rotation()).map((v,i)=>v+[p.x,p.y,p.z][i]-center[i]);
  }else if(copy.point)copy.point=copy.point.map((v,i)=>v-center[i]);
  return copy;
 });
}

export function mountComposer({getState,getEntities,getSelected,getConnections,onOpen,commit,preview,clearPreview,notify,icons}){
 const $=s=>document.querySelector(s),safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
 const axes=(id,label,values,step='.1',min='-100')=>`<div class="builder-control"><label>${label}</label><div class="builder-axes">${['X','Y','Z'].map((a,i)=>`<label><span>${a}</span><input id="${id}-${i}" aria-label="${label} ${a}" type="number" step="${step}" min="${min}" max="100" value="${values[i]}"/></label>`).join('')}</div></div>`;
 $('#array-dialog').remove();
 document.body.insertAdjacentHTML('beforeend',`<dialog id="builder-dialog" class="builder-dialog"><div class="dialog-head"><div><div class="eyebrow">ПРОЦЕДУРНАЯ РАССТАНОВКА</div><h2>Расстановка объектов</h2></div><button id="builder-close" aria-label="Закрыть редактор расстановки"><i data-lucide="x"></i></button></div>
 <div class="builder-body"><div class="builder-sidebar"><div class="builder-overline">СПОСОБ РАССТАНОВКИ</div><div class="builder-patterns">${PATTERNS.map((p,i)=>`<button data-pattern="${p.id}" class="${!i?'active':''}"><i data-lucide="${p.icon}"></i><span><strong>${p.name}</strong><small>${p.hint}</small></span></button>`).join('')}</div><label class="builder-saved-label" for="builder-saved">Сохранённые расстановки</label><select class="field" id="builder-saved"><option value="">Новая расстановка</option></select><button id="builder-remove" class="toolbar-button" hidden>Удалить расстановку</button></div>
 <div class="builder-main"><div class="builder-source"><div><label for="builder-source">Источник объектов</label><select class="field" id="builder-source"><option value="library">Объект библиотеки</option><option value="scene">Группа объектов сцены</option></select></div><div id="builder-library-wrap"><label for="builder-asset">Объект</label><select class="field" id="builder-asset">${CATALOG.filter(a=>a.id!=='softcube').map(a=>`<option value="${a.id}">${a.name}</option>`).join('')}</select></div></div><div class="builder-entities" id="builder-entities" hidden></div>
 <div class="builder-preview"><svg id="builder-map" viewBox="0 0 560 200" aria-label="Схема расположения"></svg><div class="builder-preview-caption"><span id="builder-count">Объектов: 24</span><span>Предпросмотр геометрии</span></div></div>
 <div class="builder-controls"><div class="builder-control"><label for="builder-name">Название расстановки</label><input class="field" id="builder-name" value="Расстановка 01"/></div><div class="builder-control" id="builder-count-controls"><label>Число копий <small>по осям для решётки</small></label><div class="builder-axes">${['X','Y','Z'].map((a,i)=>`<label><span>${a}</span><input id="builder-count-${i}" aria-label="Количество ${a}" type="number" min="1" max="30" step="1" value="${[6,4,1][i]}"/></label>`).join('')}</div></div>
 ${axes('builder-step','Шаг между центрами, м',[.82,.4,.82])}
 <div class="builder-control" id="builder-radius-control" hidden><label for="builder-radius">Радиус, м</label><input class="field" id="builder-radius" type="number" min=".1" max="30" step=".1" value="3"/></div>
 <div class="builder-control" id="builder-turns-control" hidden><label for="builder-turns">Оборотов спирали</label><input class="field" id="builder-turns" type="number" min=".1" max="12" step=".25" value="2"/></div>
 <div id="builder-extent-control" hidden>${axes('builder-extent','Размер области, м',[6,4,6],'.5','0')}</div>
 ${axes('builder-origin','Начальная точка, м',[-2,1,0])}${axes('builder-rotation','Поворот расстановки, °',[0,0,0],'5','-360')}
 </div><details class="builder-advanced"><summary>Преобразования и движение <span>поворот, разброс и скорость</span></summary><div class="builder-controls">${axes('builder-turn','Поворот каждой следующей копии, °',[0,0,0],'5','-360')}
 <div class="builder-control"><label for="builder-jitter">Разброс положения, м</label><input class="field" id="builder-jitter" type="number" min="0" max="3" step=".01" value="0"/></div><div class="builder-control"><label for="builder-angle-jitter">Разброс поворота, °</label><input class="field" id="builder-angle-jitter" type="number" min="0" max="180" step="5" value="0"/></div><div class="builder-control"><label for="builder-scale-jitter">Разброс размера, %</label><input class="field" id="builder-scale-jitter" type="number" min="0" max="60" step="5" value="0"/></div><div class="builder-control"><label for="builder-seed">Случайное зерно</label><input class="field" id="builder-seed" type="number" min="1" max="1000000" step="1" value="42"/></div>${axes('builder-velocity','Начальная скорость, м/с',[0,0,0])}<div class="builder-control"><label for="builder-fixed-mode">Закрепление копий</label><select class="field" id="builder-fixed-mode"><option value="preserve">Как у исходных предметов</option><option value="fixed">Закрепить все</option><option value="dynamic">Освободить все</option></select></div></div><div class="builder-checks"><label><input type="checkbox" id="builder-align" checked/>Поворот копий по траектории</label></div><p>Шаг измеряется между центрами. Разброс поворота и размера применяется ко всей группе, сохраняя взаимное положение её частей. Слишком маленький шаг может создавать пересечения.</p></details>
 <div class="builder-helper"><i data-lucide="wand-sparkles"></i><span>Внутренние связи группы копируются вместе с предметами. Параметры расстановки сохраняются в проекте.</span><button class="toolbar-button" id="builder-auto-step">Шаг по габаритам</button></div><div id="builder-warnings" class="material-hint" role="status" hidden></div><div id="builder-error" class="builder-error" role="status"></div></div></div>
 <div class="dialog-actions"><span id="builder-total" class="builder-total"></span><button class="toolbar-button" id="builder-preview-button"><i data-lucide="scan"></i>Предпросмотр</button><button class="toolbar-button primary" id="builder-apply"><i data-lucide="layers-2"></i>Применить расстановку</button></div></dialog>
 <div class="builder-preview-bar" id="builder-preview-bar" hidden><span id="builder-preview-description">Предпросмотр расстановки</span><button class="toolbar-button" id="builder-back">Параметры</button><button class="toolbar-button primary" id="builder-confirm">Применить</button><button class="toolbar-button icon-only" id="builder-cancel" aria-label="Отменить предпросмотр"><i data-lucide="x"></i></button></div>`);
 let pattern='grid',editing=null,savedSources=null,savedConnections=null,sourceCenter=[0,0,0],currentObjects=[],currentConnections=[],currentWarnings=[];
 const num=(id,fallback=0)=>{const n=Number($('#'+id).value);return Number.isFinite(n)?n:fallback;};
 const triplet=id=>[0,1,2].map(i=>num(`${id}-${i}`));
 const set=(id,value)=>{$('#'+id).value=value;};
 const set3=(id,values)=>values.forEach((v,i)=>set(`${id}-${i}`,v));
 function getSources(){
  if(savedSources)return savedSources;
  if($('#builder-source').value==='library'){const a=CATALOG.find(a=>a.id===$('#builder-asset').value);return[{asset:a.id,material:a.mat,scale:1,mass:Math.max(.3,Math.min(30,a.size.reduce((a,b)=>a*b,1)*3)),rotation:[0,0,0],offset:[0,0,0]}];}
  const selectedIds=[...document.querySelectorAll('[data-builder-entity]:checked')].map(e=>e.dataset.builderEntity);
  const list=getEntities().filter(e=>selectedIds.includes(e.id));if(!list.length)return[];
  const center=[0,0,0];for(const e of list){const p=e.body.translation();[p.x,p.y,p.z].forEach((v,k)=>center[k]+=v/list.length);}sourceCenter=center;
  return list.map(e=>{const p=e.body.translation();return{...structuredClone(e.spec),id:undefined,sourceId:e.id,generatorId:undefined,asset:e.asset,parts:structuredClone(e.parts),material:e.material,mass:e.fixed?(e.spec.mass||1):e.body.mass(),scale:e.scale,rotation:{...e.body.rotation()},offset:[p.x-center[0],p.y-center[1],p.z-center[2]],fixed:e.fixed,kinematic:false};});
 }
 function getSourceConnections(sources){
  if(savedSources)return savedConnections||[];
  if($('#builder-source').value!=='scene')return[];
  return snapshotAssemblyConnections(getConnections?.()||getState().settings.connections||[],sources,sourceCenter);
 }
 function read(){return{id:editing||'layout-'+Date.now(),name:$('#builder-name').value.trim()||'Расстановка',pattern,count:triplet('builder-count'),step:triplet('builder-step'),origin:triplet('builder-origin'),rotation:triplet('builder-rotation'),turn:triplet('builder-turn'),extent:triplet('builder-extent'),radius:num('builder-radius',3),turns:num('builder-turns',2),jitter:num('builder-jitter'),angleJitter:num('builder-angle-jitter'),scaleJitter:num('builder-scale-jitter')/100,seed:num('builder-seed',42),align:$('#builder-align').checked,fixedMode:$('#builder-fixed-mode').value,velocity:triplet('builder-velocity')};}
 function assemble(spec,sources){
  const sourceConnections=getSourceConnections(sources),result=buildLayoutAssembly(spec,sources,sourceConnections),state=getState();
  const replaced=new Set(state.objects.filter(o=>o.generatorId===spec.id).map(o=>o.id));
  if(result.objects.length+state.objects.filter(o=>!replaced.has(o.id)).length>150)throw new Error('В сцене будет больше 150 добавленных предметов. Уменьшите количество копий.');
  const otherConnections=(state.settings.connections||[]).filter(c=>c.generatorId!==spec.id&&!replaced.has(c.a)&&!replaced.has(c.b)).length;
  if(result.connections.length+otherConnections>150)throw new Error('В сцене будет больше 150 связей. Уменьшите количество копий.');
  return{...result,sourceConnections};
 }
 function draw(){
  $('#builder-library-wrap').hidden=$('#builder-source').value!=='library';$('#builder-entities').hidden=$('#builder-source').value!=='scene';
  const grid=pattern==='grid';[1,2].forEach(i=>{$(`#builder-count-${i}`).parentElement.hidden=!grid;});
  $('#builder-radius-control').hidden=!['ring','helix'].includes(pattern);$('#builder-turns-control').hidden=pattern!=='helix';$('#builder-extent-control').hidden=pattern!=='scatter';
  const s=read(),sources=getSources();let error='';try{const result=assemble(s,sources);currentObjects=result.objects;currentConnections=result.connections;currentWarnings=result.warnings;if(!sources.length)error='Выберите объекты сцены.';}catch(e){currentObjects=[];currentConnections=[];currentWarnings=[];error=e.message;}
  $('#builder-error').textContent=error;$('#builder-apply').disabled=$('#builder-preview-button').disabled=!!error;
  $('#builder-warnings').hidden=!currentWarnings.length;$('#builder-warnings').textContent=currentWarnings.join(' ');
  $('#builder-apply').textContent=$('#builder-confirm').textContent=currentWarnings.length?`Применить без внешних связей (${currentWarnings.length})`:'Применить расстановку';
  $('#builder-preview-description').textContent=currentWarnings.length?`Предпросмотр · исключено связей: ${currentWarnings.length}`:'Предпросмотр расстановки';
  $('#builder-count').textContent=`Объектов: ${currentObjects.length} · Связей: ${currentConnections.length} · Копий: ${layoutPoints(s).length}`;$('#builder-total').textContent=editing?'Редактирование расстановки':`Предметов: ${currentObjects.length} · связей: ${currentConnections.length}`;
  const points=currentObjects.map(o=>{const [x,y,z]=o.position;return[(x-z)*.85,(x+z)*.3-y];});
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of points)p.forEach((v,i)=>{lo[i]=Math.min(lo[i],v);hi[i]=Math.max(hi[i],v);});const scale=Math.min(440/Math.max(1,hi[0]-lo[0]),135/Math.max(1,hi[1]-lo[1]));
  $('#builder-map').innerHTML=`<defs><pattern id="builder-grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="currentColor" stroke-opacity=".08"/></pattern></defs><rect width="560" height="200" fill="url(#builder-grid)"/>`+points.map((p,i)=>{const x=280+(p[0]-(lo[0]+hi[0])/2)*scale,y=98+(p[1]-(lo[1]+hi[1])/2)*scale;return`<path d="M${x} ${y-6}l8 4v8l-8 4-8-4v-8z" fill="${i%sources.length===0?'#f4a271':'#72c8d4'}" fill-opacity=".9" stroke="#102d3d" stroke-width="1.2"/>`;}).join('');
 }
 function patternChanged(id){pattern=id;document.querySelectorAll('[data-pattern]').forEach(e=>e.classList.toggle('active',e.dataset.pattern===id));draw();}
 function sourceChanged(){savedSources=null;savedConnections=null;draw();}
 function autoStep(){const sources=getSources();if(!sources.length)return;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const s of sources){const size=CATALOG.find(a=>a.id===s.asset)?.size||[1,1,1];for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],(s.offset?.[i]||0)-size[i]*(s.scale||1)/2);hi[i]=Math.max(hi[i],(s.offset?.[i]||0)+size[i]*(s.scale||1)/2);}}set3('builder-step',hi.map((v,i)=>Number((v-lo[i]+.06).toFixed(2))));draw();}
 function listSaved(){const list=getState().settings.generators||[];$('#builder-saved').innerHTML='<option value="">Новая расстановка</option>'+list.map(g=>`<option value="${g.id}">${safe(g.name)} · объектов в группе: ${g.sources.length}</option>`).join('');$('#builder-saved').value=editing||'';$('#builder-remove').hidden=!editing;}
 function open(){
  onOpen?.();
  if(editing&&!(getState().settings.generators||[]).some(g=>g.id===editing)){editing=null;savedSources=null;savedConnections=null;}
  clearPreview();$('#builder-preview-bar').hidden=true;const entities=getEntities();
  $('#builder-entities').innerHTML=entities.map(e=>`<label><input type="checkbox" data-builder-entity="${e.id}" ${e.id===getSelected()?'checked':''}/><span>${safe(e.name)}</span></label>`).join('')||'<p>В сцене нет объектов.</p>';
  listSaved();if(!editing){savedSources=null;savedConnections=null;$('#builder-fixed-mode').value='preserve';const entity=entities.find(e=>e.id===getSelected());if(entity){$('#builder-source').value='scene';const p=entity.body.translation();set3('builder-origin',[Number((p.x+1.1).toFixed(2)),Number(p.y.toFixed(2)),Number(p.z.toFixed(2))]);}else{$('#builder-source').value='library';$('#builder-asset').value='brick';}autoStep();}
  draw();icons();$('#builder-dialog').showModal();
 }
 function apply(){try{const spec=read(),sources=getSources(),result=assemble(spec,sources);if(!result.objects.length)throw new Error('Выберите объекты для расстановки');commit({...spec,sources,sourceConnections:result.sourceConnections},result.objects,result.connections,result.warnings);editing=spec.id;savedSources=sources;savedConnections=result.sourceConnections;clearPreview();$('#builder-preview-bar').hidden=true;$('#builder-dialog').close();notify(`Расстановка сохранена. Предметов: ${result.objects.length}, связей: ${result.connections.length}.${result.warnings.length?' Внешние связи исключены: '+result.warnings.length+'.':''}`);}catch(e){notify(e.message);}}
 $('#array').onclick=open;$('#array').setAttribute('aria-label','Расстановка объектов');$('#array').title='Расстановка объектов';
 document.querySelectorAll('[data-pattern]').forEach(e=>e.onclick=()=>patternChanged(e.dataset.pattern));
 $('#builder-dialog').addEventListener('input',draw);$('#builder-source').onchange=$('#builder-asset').onchange=sourceChanged;$('#builder-entities').onchange=sourceChanged;
 $('#builder-auto-step').onclick=autoStep;$('#builder-close').onclick=()=>$('#builder-dialog').close();$('#builder-apply').onclick=$('#builder-confirm').onclick=apply;
 $('#builder-preview-button').onclick=()=>{try{preview(currentObjects);$('#builder-dialog').close();$('#builder-preview-bar').hidden=false;}catch(e){notify(e.message);}};
 $('#builder-back').onclick=()=>{clearPreview();$('#builder-preview-bar').hidden=true;$('#builder-dialog').showModal();};
 $('#builder-cancel').onclick=()=>{clearPreview();$('#builder-preview-bar').hidden=true;};
 $('#builder-saved').onchange=()=>{const g=(getState().settings.generators||[]).find(g=>g.id===$('#builder-saved').value);if(!g){editing=null;savedSources=null;savedConnections=null;$('#builder-fixed-mode').value='preserve';set('builder-name','Новая расстановка');listSaved();draw();return;}editing=g.id;savedSources=g.sources;savedConnections=g.sourceConnections||[];set('builder-name',g.name);for(const key of ['count','step','origin','rotation','turn','extent'])set3('builder-'+key,g[key]);for(const key of ['radius','turns','jitter','seed'])set('builder-'+key,g[key]);set('builder-angle-jitter',g.angleJitter);set('builder-scale-jitter',g.scaleJitter*100);set3('builder-velocity',g.velocity||[0,0,0]);$('#builder-fixed-mode').value=g.fixedMode||(g.fixed===true?'fixed':g.fixed===false?'dynamic':'preserve');$('#builder-align').checked=g.align;patternChanged(g.pattern);listSaved();};
 $('#builder-remove').onclick=()=>{if(!editing)return;commit({id:editing,remove:true},[],[],[]);editing=null;savedSources=null;savedConnections=null;listSaved();draw();notify('Расстановка удалена.');};
 icons();
 return{open};
}
