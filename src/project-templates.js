const mounts=new WeakMap();
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>{throw new Error('Некорректный список готовых проектов.');};
function copyText(value,max,empty=false){
 if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||!empty&&!value.trim())invalid();
 return value.trim();
}

/** Resolve bundled assets only; never follow a manifest to another service. */
export function projectTemplatePath(value,baseURL,kind='project'){
 if(typeof value!=='string'||!value||/[\u0000-\u0020\u007f\\%]/.test(value))invalid();
 let url,base;try{base=new URL(baseURL);url=new URL(value,base);}catch{invalid();}
 if(url.origin!==base.origin||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)invalid();
 // Check the supplied path too: URL() would otherwise normalize ../ away.
 const supplied=value.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i,'');
 if(!supplied.startsWith('/projects/')||supplied.includes('?')||supplied.includes('#'))invalid();
 const segments=supplied.slice('/projects/'.length).split('/');
 if(!segments.length||segments.some(s=>!s||s==='.'||s==='..'||! /^[a-z\d_-][a-z\d_.-]*$/i.test(s)))invalid();
 if(!url.pathname.startsWith('/projects/'))invalid();
 if(kind==='poster'?!/\.(?:jpe?g|png|webp)$/i.test(url.pathname):!/\.json$/i.test(url.pathname))invalid();
 return url.pathname;
}

/** Plain authoring data. Validation does not mutate the supplied manifest. */
export function normalizeProjectTemplates(manifest,baseURL){
 if(!record(manifest)||manifest.version!==1||!Array.isArray(manifest.templates)||manifest.templates.length>24)invalid();
 const ids=new Set();
 return manifest.templates.map(item=>{
  if(!record(item)||typeof item.id!=='string'||!/^[a-z\d][a-z\d_-]{0,79}$/i.test(item.id)||ids.has(item.id))invalid();
  ids.add(item.id);
  if(!Array.isArray(item.tags)||item.tags.length>6)invalid();
  return{
   id:item.id,title:copyText(item.title,120),teaser:copyText(item.teaser,240,true),
   projectUrl:projectTemplatePath(item.projectUrl,baseURL),
   ...(item.posterUrl===undefined?{}:{posterUrl:projectTemplatePath(item.posterUrl,baseURL,'poster')}),
   tags:item.tags.map(tag=>copyText(tag,40)),
  };
 });
}

/** The owning application validates and opens a fetched project as usual. */
export function mountProjectTemplates({host,onOpenProject,notify=()=>{},icons=()=>{}}={}){
 if(!host||typeof host.prepend!=='function'||typeof onOpenProject!=='function')throw new Error('Нужны контейнер и обработчик открытия проекта.');
 if(mounts.has(host))return mounts.get(host);
 const document=host.ownerDocument,section=document.createElement('section');
 section.className='project-templates';section.hidden=true;section.setAttribute('aria-label','Готовые проекты');
 section.innerHTML='<div class="project-templates-heading"><div><h3>Готовые проекты</h3><p>Откройте сцену и сделайте свой вариант.</p></div></div><div class="project-templates-grid"></div><div class="project-templates-error" role="status" hidden><span>Не удалось загрузить готовые проекты.</span><button type="button" class="toolbar-button">Повторить</button></div>';
 const heading=section.querySelector('.project-templates-heading'),grid=section.querySelector('.project-templates-grid'),error=section.querySelector('.project-templates-error'),retry=error.querySelector('button');
 host.prepend(section);
 let generation=0,request=null,projectRequest=null,opening=false,destroyed=false;
 const buttons=()=>[...grid.querySelectorAll('button')];
 function setOpening(value,target){
  opening=value;section.setAttribute('aria-busy',String(value));
  for(const button of buttons()){button.disabled=value;button.querySelector('span').textContent=value&&button===target?'Открываем…':'Открыть проект';}
 }
 async function json(url,signal){
  const response=await fetch(url,{signal,cache:'no-store',credentials:'same-origin',redirect:'error'});
  if(!response.ok)throw new Error('Проект недоступен.');
  return response.json();
 }
 async function open(template,button){
  if(opening||destroyed)return;
  projectRequest=new AbortController();setOpening(true,button);
  try{
   const project=await json(template.projectUrl,projectRequest.signal);
   if(destroyed||projectRequest.signal.aborted)return;
   await onOpenProject(project);
  }catch(cause){if(!destroyed&&cause?.name!=='AbortError')notify('Не удалось открыть проект. Повторите попытку.');}
  finally{if(!destroyed)setOpening(false);projectRequest=null;}
 }
 function card(template){
  const article=document.createElement('article');article.className='project-template-card';
  const thumb=document.createElement('div');thumb.className='project-template-thumb';
  const placeholder=document.createElement('div');placeholder.className='project-template-placeholder';
  placeholder.innerHTML='<i data-lucide="layout-template" aria-hidden="true"></i><span>Сохранённая сцена</span>';
  thumb.append(placeholder);
  if(template.posterUrl){
   const image=document.createElement('img');image.alt=template.title;image.loading='lazy';image.decoding='async';
   image.onload=()=>{placeholder.hidden=true;};image.onerror=()=>{image.remove();placeholder.hidden=false;};
   image.src=template.posterUrl;thumb.append(image);
  }
  const body=document.createElement('div');body.className='project-template-copy';
  const title=document.createElement('h4');title.textContent=template.title;
  const teaser=document.createElement('p');teaser.textContent=template.teaser;
  const tags=document.createElement('div');tags.className='project-template-tags';
  for(const text of template.tags){const tag=document.createElement('span');tag.textContent=text;tags.append(tag);}
  const button=document.createElement('button');button.type='button';button.className='toolbar-button project-template-open';
  button.innerHTML='<span>Открыть проект</span><i data-lucide="arrow-right" aria-hidden="true"></i>';
  button.setAttribute('aria-label','Открыть проект «'+template.title+'»');button.onclick=()=>void open(template,button);
  body.append(title,teaser,tags,button);article.append(thumb,body);return article;
 }
 async function reload(){
  const token=++generation;request?.abort();request=new AbortController();retry.disabled=true;
  try{
   const data=await json('/projects/templates.json',request.signal);
   if(destroyed||token!==generation)return;
   const templates=normalizeProjectTemplates(data,document.location.href);
   grid.replaceChildren(...templates.map(card));error.hidden=true;heading.hidden=false;grid.hidden=false;section.hidden=!templates.length;
   icons();
  }catch(cause){
   if(destroyed||token!==generation||cause?.name==='AbortError')return;
   grid.replaceChildren();grid.hidden=true;heading.hidden=true;error.hidden=false;section.hidden=false;
  }finally{if(!destroyed&&token===generation)retry.disabled=false;}
 }
 retry.onclick=()=>void reload();
 const api={reload,destroy(){if(destroyed)return;destroyed=true;generation++;request?.abort();projectRequest?.abort();section.remove();mounts.delete(host);}};
 mounts.set(host,api);api.ready=reload();return api;
}
