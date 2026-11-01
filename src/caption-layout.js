const layouts=new WeakMap();
const scrims=new WeakMap();

/** Keep the full text block in the flat part; fade only outside its padding. */
export function graphicsScrimBox({position='top',blockTop,blockBottom,frameHeight,scale=1,fade=110,padding=32}){
 const clamp=value=>Math.max(0,Math.min(frameHeight,value)),edge=padding*scale,feather=fade*scale;
 const top=position==='top'?0:clamp(blockTop-edge-feather),bottom=position==='bottom'?frameHeight:clamp(blockBottom+edge+feather);
 const height=Math.max(1,bottom-top),holdTop=position==='top'?top:Math.max(top,blockTop-edge),holdBottom=position==='bottom'?bottom:Math.min(bottom,blockBottom+edge);
 return{top,height,fadeIn:Math.max(0,Math.min(100,(holdTop-top)/height*100)),fadeOut:Math.max(0,Math.min(100,(holdBottom-top)/height*100))};
}

function updateGraphicsScrims(container){
 const frame=container.getBoundingClientRect();if(!frame.width||!frame.height)return;
 const scale=container.clientWidth/1080,localY=container.clientHeight/frame.height,position=container.dataset.graphicsPosition||'top';
 for(const [blockClass,scrimClass,lane,fade]of [['graphics-title','graphics-title-scrim',position,110],['graphics-measurement','graphics-metric-scrim',position==='bottom'?'top':'bottom',100]]){
  const block=container.querySelector('.'+blockClass),scrim=container.querySelector('.'+scrimClass);if(!block||!scrim)continue;
  const visible=!block.hidden&&!!block.textContent.trim()&&(blockClass!=='graphics-measurement'||container.dataset.graphicsMetric!=='false');scrim.hidden=!visible;if(!visible)continue;
  const bounds=block.getBoundingClientRect(),box=graphicsScrimBox({position:lane,blockTop:(bounds.top-frame.top)*localY,blockBottom:(bounds.bottom-frame.top)*localY,frameHeight:container.clientHeight,scale,fade});
  scrim.style.top=box.top+'px';scrim.style.bottom='auto';scrim.style.height=box.height+'px';
  scrim.style.setProperty('--scrim-fade-in',box.fadeIn+'%');scrim.style.setProperty('--scrim-fade-out',box.fadeOut+'%');
 }
}

function scheduleGraphicsScrims(container){
 let record=scrims.get(container);
 if(!record){
  record={pending:false};scrims.set(container,record);
  if(typeof ResizeObserver!=='undefined'){
   record.observer=new ResizeObserver(()=>scheduleGraphicsScrims(container));
   for(const element of [container,container.querySelector('.graphics-title'),container.querySelector('.graphics-measurement')])if(element)record.observer.observe(element);
  }
 }
 if(record.pending)return;record.pending=true;
 const schedule=typeof requestAnimationFrame==='function'?requestAnimationFrame:queueMicrotask;
 schedule(()=>{record.pending=false;updateGraphicsScrims(container)});
}

/** Natural glyphs only: prefer two lines, then allow three for authored copy. */
export function fitGraphicsHeadline(element,container,tokens){
 scheduleGraphicsScrims(container);
 const width=container.clientWidth;if(!width)return;
 const signature=`graphics|${width}|${tokens.headlineSize}|${tokens.minimumSize}|${tokens.lineHeight}|${element.textContent}`;
 if(layouts.get(element)===signature)return;
 layouts.set(element,signature);delete element.dataset.overflow;element.style.width='';element.style.maxWidth='';element.style.transform='none';element.style.webkitLineClamp='unset';
 const fits=lines=>element.scrollHeight<=Number.parseFloat(getComputedStyle(element).lineHeight)*lines+1;
 for(const lines of [tokens.preferredLines,tokens.headlineLines]){
  for(let size=tokens.headlineSize;size>=tokens.minimumSize-.01;size-=2){
   element.style.fontSize=`${Math.max(size,tokens.minimumSize)/1080*width}px`;
   if(fits(lines)){element.dataset.lines=String(lines);return;}
  }
 }
 element.style.fontSize=`${tokens.minimumSize/1080*width}px`;
 element.dataset.lines=String(tokens.headlineLines);element.dataset.overflow=String(!fits(tokens.headlineLines));
}

/** Fit authored copy into two readable lines; do not cut it by word count. */
export function fitHeadline(element,container,base=68){
 const width=container.clientWidth;if(!width)return;
 const signature=width+'|'+base+'|'+element.textContent;
 if(layouts.get(element)===signature)return;
 layouts.set(element,signature);
 element.style.width='';element.style.maxWidth='';element.style.transform='';
 const fits=()=>element.scrollHeight<=Number.parseFloat(getComputedStyle(element).lineHeight)*2+1;
 for(let size=base;size>=42;size-=2){
  element.style.fontSize=`${size/1080*width}px`;
  if(fits())return;
 }
 // Match the native renderer's condensed fallback while preserving all copy.
 // Expand the layout box, then condense it back into the original safe area.
 const available=element.clientWidth;
 for(let ratio=.96;ratio>=.72;ratio-=.04){
  element.style.width=`${available/ratio}px`;element.style.maxWidth='none';
  element.style.transform=`scaleX(${ratio})`;element.style.transformOrigin='left top';
  if(fits())return;
 }
}
