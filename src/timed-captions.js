import {READOUT_VARIABLES} from './measurement-readouts.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** A useful static title preview is inside a cue, after its entrance fade. */
export function cuePreviewTime(cue,duration=120){
 const start=Number(cue?.start),end=Math.min(Number(cue?.end),Number(duration));
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return null;
 const span=end-start,fade=Number.isFinite(Number(cue.fade))?Math.max(0,Math.min(Number(cue.fade),span/2)):.15;
 return start+Math.min(span/2,Math.max(.15,fade+.1));
}
export function firstCuePreviewTime(cues=[],duration=120){
 for(const cue of [...cues].sort((a,b)=>Number(a?.start)-Number(b?.start))){const time=cuePreviewTime(cue,duration);if(time!==null)return time;}
 return 0;
}

/** Find a free movie-time window without moving or mutating existing cues.
 * Prefer the cursor, search forward, then wrap to the beginning of the track.
 * A short free window is useful too; a new draft needs at least 0.1 seconds.
 */
export function chooseCueInterval(cues=[],{time=0,duration=120,preferredDuration=3}={}){
 const end=Number.isFinite(Number(duration))?Math.max(0,Number(duration)):0;
 const cursor=Number.isFinite(Number(time))?Math.max(0,Math.min(end,Number(time))):0;
 const minimum=.1,span=Number.isFinite(Number(preferredDuration))?Math.max(minimum,Number(preferredDuration)):3,epsilon=1e-9;
 const occupied=(Array.isArray(cues)?cues:[]).map(c=>({start:Number(c?.start),end:Number(c?.end)})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start).map(c=>({start:Math.max(0,Math.min(end,c.start)),end:Math.max(0,Math.min(end,c.end))})).filter(c=>c.end>c.start).sort((a,b)=>a.start-b.start);
 const gaps=[];let covered=0;
 for(const cue of occupied){if(cue.start>covered)gaps.push({start:covered,end:cue.start});covered=Math.max(covered,cue.end);}
 if(covered<end)gaps.push({start:covered,end});
 const fit=(gap,start)=>gap.end-start+epsilon>=minimum?{start,end:Math.min(gap.end,start+span)}:null;
 for(const gap of gaps){const found=fit(gap,Math.max(gap.start,cursor));if(found)return found;}
 for(const gap of gaps){const found=fit(gap,gap.start);if(found)return found;}
 return null;
}

/** Text is timed on the film clock, never on a physical solver step. */
export function mountTimedCaptions(parent,{onChange=()=>{},onSelect=()=>{},getDuration=()=>120,getTime=()=>0}={}){
 const section=document.createElement('section');section.className='cue-editor';
 section.innerHTML=`<div class="cue-heading"><div><span>ПОДПИСИ ПО ВРЕМЕНИ</span><p>Время в секундах ролика.</p></div><button type="button" class="toolbar-button" data-cue-add>+ Подпись</button></div><div data-cue-list></div><p class="cue-empty">Дорожка титров пуста.</p><p class="cue-error" role="status"></p>`;
 parent.append(section);
 if(!document.getElementById('cue-editor-style'))document.head.insertAdjacentHTML('beforeend',`<style id="cue-editor-style">.cue-editor{border-top:1px solid var(--border);margin-top:20px;padding-top:19px}.cue-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.cue-heading span{font-size:10px;letter-spacing:1px;color:var(--sub)}.cue-heading p,.cue-empty{font-size:10px;color:var(--sub);line-height:1.6}.cue-heading button{font-size:11px;white-space:nowrap}.cue-row{display:grid;grid-template-columns:104px minmax(0,1fr) 24px;gap:10px;margin-top:12px;align-items:start}.cue-time{display:flex;gap:6px}.cue-time label{font-size:9px;color:var(--sub);display:grid;gap:5px;min-width:0}.cue-time input{width:100%;box-sizing:border-box;background:var(--control);color:var(--ink);border:1px solid var(--border);border-radius:5px;padding:9px 5px;font-size:11px}.cue-copy input.field{width:100%;box-sizing:border-box;font-size:11px}.cue-copy>label{display:flex;gap:5px;align-items:center;margin-top:7px;font-size:9px;color:var(--sub)}.cue-remove{border:0;background:transparent;color:var(--sub);font-size:22px;padding:3px}.cue-error{font-size:10px;color:#e5a67c;line-height:1.5}@media(max-width:430px){.cue-row{grid-template-columns:minmax(0,1fr) 24px}.cue-time{grid-column:1;max-width:150px}.cue-copy{grid-column:1;grid-row:2}.cue-remove{grid-column:2;grid-row:1}}</style>`);
 const list=section.querySelector('[data-cue-list]');let cues=[],lastText=null;
 const variables=document.createElement('select');variables.className='field';variables.setAttribute('aria-label','Вставить измерение в титр');variables.style.cssText='max-width:240px;margin:8px 0;font-size:12px';variables.innerHTML='<option value="">Вставить измерение…</option>'+READOUT_VARIABLES.map(v=>`<option value="${v.id}">${esc(v.label)}</option>`).join('');list.before(variables);
 section.addEventListener('focusin',event=>{if(event.target.matches('[data-cue-text],[data-cue-label]'))lastText=event.target;});
 variables.onchange=()=>{if(!variables.value)return;const input=lastText&&list.contains(lastText)?lastText:list.querySelector('[data-cue-text]');if(input){const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;input.setRangeText('{'+variables.value+'}',start,end,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}variables.value='';};
 function read(){return [...list.children].map((row,i)=>({...cues[i],start:Number(row.querySelector('[data-cue-start]').value),end:Number(row.querySelector('[data-cue-end]').value),text:row.querySelector('[data-cue-text]').value,label:row.querySelector('[data-cue-label]').value,hideMetric:row.querySelector('[data-cue-hide]').checked?true:undefined}));}
 function error(duration=120){const rows=read().slice().sort((a,b)=>a.start-b.start);for(let i=0;i<rows.length;i++){const c=rows[i];if(!c.text.trim())return 'Заполните текст подписи или удалите пустую строку.';if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>duration+.001)return `Укажите интервал внутри ролика: от 0 до ${duration} с.`;if(i&&c.start<rows[i-1].end)return 'Подписи пересекаются. Разведите их по времени.';}return '';}
 function draw(){list.innerHTML=cues.map((c,i)=>`<div class="cue-row"><div class="cue-row-top"><span class="cue-index">${String(i+1).padStart(2,'0')}</span><div class="cue-time"><label>С<input type="number" min="0" max="120" step=".1" data-cue-start value="${c.start}" aria-label="Начало подписи ${i+1}"/></label><label>До<input type="number" min=".1" max="120" step=".1" data-cue-end value="${c.end}" aria-label="Конец подписи ${i+1}"/></label></div><button type="button" class="cue-preview" data-cue-preview="${i}" aria-label="Показать подпись ${i+1} в кадре">В кадр</button><button type="button" class="cue-remove" data-cue-remove="${i}" aria-label="Удалить подпись ${i+1}">×</button></div><div class="cue-copy"><textarea class="field" rows="2" maxlength="96" data-cue-text placeholder="Главный текст титра" aria-label="Текст подписи ${i+1}">${esc(c.text)}</textarea><input class="field" maxlength="120" data-cue-label value="${esc(c.label||'')}" placeholder="Строка условий · необязательно" aria-label="Условия подписи ${i+1}" style="margin-top:6px"/><label><input type="checkbox" data-cue-hide ${c.hideMetric?'checked':''}/>Скрыть показатель на это время</label></div></div>`).join('');section.querySelector('.cue-empty').hidden=!!cues.length;section.querySelector('[data-cue-add]').disabled=cues.length>=24;}
 section.querySelector('[data-cue-add]').onclick=()=>{cues=read();const interval=chooseCueInterval(cues,{duration:getDuration(),time:getTime()});if(!interval){section.querySelector('.cue-error').textContent='На дорожке нет свободного интервала длиной хотя бы 0,1 с. Сократите или удалите одну из подписей.';return;}const draft={...interval,text:'',fade:.15,hideMetric:false};cues.push(draft);cues.sort((a,b)=>a.start-b.start);const index=cues.indexOf(draft);draw();section.querySelector('.cue-error').textContent='';list.children[index].querySelector('[data-cue-text]').focus();onChange();};
 section.addEventListener('input',()=>{section.querySelector('.cue-error').textContent=error(getDuration());onChange();});
 section.addEventListener('click',e=>{const b=e.target.closest('[data-cue-remove]');if(b){cues=read();cues.splice(Number(b.dataset.cueRemove),1);draw();onChange();}const selected=e.target.closest('[data-cue-preview]');if(selected){const cue=read()[Number(selected.dataset.cuePreview)],time=cuePreviewTime(cue,getDuration());if(time!==null)onSelect({cue,time,index:Number(selected.dataset.cuePreview)});}});
 return {read,fill(value){cues=structuredClone(value||[]);draw();section.querySelector('.cue-error').textContent='';},validate(duration){const message=error(duration);section.querySelector('.cue-error').textContent=message;if(message)throw new Error(message);}};
}
