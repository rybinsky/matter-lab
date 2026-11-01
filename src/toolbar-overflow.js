import './toolbar-overflow.css';

const mounted=new WeakMap();
const cues=new WeakMap();
let serial=0;
const chevron='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5.5 8 4.5 4.5L14.5 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Keep source buttons in place, including their handlers and inert boundary.
 * Overflow rows forward a user activation to their original source button.
 */
export function mountToolbarOverflow({container}={}){
 if(!container?.parentElement)throw new Error('Toolbar overflow requires its existing container.');
 if(mounted.has(container))return mounted.get(container);
 const host=container.parentElement;host.classList.add('toolbar-overflow-host');
 const trigger=document.createElement('button');trigger.type='button';trigger.className='toolbar-overflow-trigger';trigger.hidden=true;
 trigger.innerHTML='<span>Ещё</span>'+chevron;trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');container.after(trigger);
 const popup=document.createElement('div');popup.id=`toolbar-overflow-${++serial}`;popup.className='toolbar-overflow-menu';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Инструменты сцены');trigger.setAttribute('aria-controls',popup.id);
 document.body.append(popup);
 let overflowing=[],opened=false,frame,destroyed=false;
 const buttons=()=>Array.from(container.children).filter(node=>node.tagName==='BUTTON');
 const locked=()=>container.inert||!!container.closest('[inert]');
 function position(){
  if(!opened)return;
  const r=trigger.getBoundingClientRect(),width=Math.min(290,document.documentElement.clientWidth-24),vh=innerHeight;
  popup.style.width=width+'px';popup.style.left=Math.max(12,Math.min(r.right-width,document.documentElement.clientWidth-width-12))+'px';
  const height=Math.min(overflowing.length*43+16,420,vh-24),below=vh-r.bottom-8;
  popup.style.maxHeight=height+'px';popup.style.top=Math.max(12,Math.min(below>=height?r.bottom+7:r.top-height-7,vh-height-12))+'px';
 }
 function close(returnFocus=true){
  if(!opened)return;opened=false;popup.hidden=true;trigger.setAttribute('aria-expanded','false');
  if(returnFocus&&!trigger.disabled)trigger.focus({preventScroll:true});
 }
 function render(){
  popup.replaceChildren();
  for(const source of overflowing){
   const row=document.createElement('button');row.type='button';row.className='toolbar-overflow-item';
   const icon=source.querySelector('svg');if(icon){const copy=icon.cloneNode(true);copy.removeAttribute('id');copy.setAttribute('aria-hidden','true');row.append(copy);}
   const label=document.createElement('span');label.textContent=source.querySelector('.studio-tool-label')?.textContent.trim()||source.getAttribute('aria-label')||source.title||source.textContent.trim();row.append(label);
   row.disabled=source.disabled||locked();row.classList.toggle('active',source.classList.contains('active'));
   const pressed=source.getAttribute('aria-pressed');if(pressed!==null)row.setAttribute('aria-pressed',pressed);
   row.addEventListener('click',()=>{if(source.disabled||locked())return;close();source.click();schedule();});popup.append(row);
  }
 }
 function measure(){
  if(destroyed)return;
  trigger.disabled=locked();
  if(!host.getClientRects().length){close(false);return;}
  const all=buttons();for(const source of all)source.classList.remove('toolbar-overflow-hidden');trigger.hidden=true;
  const visible=all.filter(source=>!source.hidden&&getComputedStyle(source).display!=='none');
  const gap=Number.parseFloat(getComputedStyle(container).columnGap)||0,widths=visible.map(source=>source.getBoundingClientRect().width);
  const total=widths.reduce((sum,width)=>sum+width,0)+Math.max(0,visible.length-1)*gap;
  overflowing=[];
  if(total>container.clientWidth+1){
   trigger.hidden=false;let used=0,reached=false;const available=container.clientWidth;
   for(const[source,index]of visible.map((source,index)=>[source,index])){
    const required=widths[index]+(used?gap:0);reached||=used+required>available+1;
    source.classList.toggle('toolbar-overflow-hidden',reached);if(reached)overflowing.push(source);else used+=required;
   }
  }
  trigger.hidden=!overflowing.length;trigger.disabled=locked();trigger.setAttribute('aria-label',`Ещё инструменты: ${overflowing.length}`);
  if(opened){if(!overflowing.length||locked())close(false);else{render();position();}}
 }
 function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}
 function open(){
  measure();if(trigger.hidden||trigger.disabled)return;opened=true;popup.hidden=false;trigger.setAttribute('aria-expanded','true');render();position();popup.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 }
 const onTrigger=()=>opened?close():open();
 const onTriggerKey=event=>{if(event.key==='ArrowDown'){event.preventDefault();open();}else if(event.key==='Escape'&&opened){event.preventDefault();close();}};
 const onKey=event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const rows=Array.from(popup.querySelectorAll('button:not(:disabled)'));if(!rows.length)return;
  const current=rows.indexOf(document.activeElement),index=event.key==='Home'?0:event.key==='End'?rows.length-1:(current+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;rows[index].focus();
 };
 const onOutside=event=>{if(opened&&!popup.contains(event.target)&&!trigger.contains(event.target))close(false);};
 const onWindowScroll=()=>{if(opened)position();};
 trigger.addEventListener('click',onTrigger);trigger.addEventListener('keydown',onTriggerKey);popup.addEventListener('keydown',onKey);
 document.addEventListener('pointerdown',onOutside);document.addEventListener('focusin',onOutside);window.addEventListener('scroll',onWindowScroll,true);window.addEventListener('resize',schedule);
 const resize=new ResizeObserver(schedule);resize.observe(host);
 const observer=new MutationObserver(schedule);observer.observe(container,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['inert','disabled','hidden','aria-label','aria-pressed','title']});
 for(let ancestor=container.parentElement;ancestor;ancestor=ancestor.parentElement)observer.observe(ancestor,{attributes:true,attributeFilter:['inert']});
 const api={refresh:measure,destroy(){destroyed=true;close(false);cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();trigger.remove();popup.remove();host.classList.remove('toolbar-overflow-host');for(const source of buttons())source.classList.remove('toolbar-overflow-hidden');document.removeEventListener('pointerdown',onOutside);document.removeEventListener('focusin',onOutside);window.removeEventListener('scroll',onWindowScroll,true);window.removeEventListener('resize',schedule);mounted.delete(container);}};
 mounted.set(container,api);measure();return api;
}

/** A visible cue appears only while the tool rail has content below the fold. */
export function mountScrollCue({element}={}){
 if(!element)throw new Error('Scroll cue requires a scroll container.');
 if(cues.has(element))return cues.get(element);
 const cue=document.createElement('div');cue.className='workspace-scroll-cue';cue.setAttribute('aria-hidden','true');cue.hidden=true;cue.innerHTML=chevron;document.body.append(cue);
 let frame;
 function update(){const r=element.getBoundingClientRect();cue.hidden=!!element.closest('[inert]')||!element.getClientRects().length||element.scrollHeight-element.clientHeight-element.scrollTop<3;cue.style.left=r.left+'px';cue.style.top=(r.bottom-25)+'px';cue.style.width=r.width+'px';}
 function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(update);}
 const resize=new ResizeObserver(schedule);resize.observe(element);for(const child of element.children)resize.observe(child);
 const observer=new MutationObserver(schedule);for(let ancestor=element;ancestor;ancestor=ancestor.parentElement)observer.observe(ancestor,{attributes:true,attributeFilter:['inert']});
 element.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);update();
 const api={refresh:update,destroy(){cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();element.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);cue.remove();cues.delete(element);}};cues.set(element,api);return api;
}
