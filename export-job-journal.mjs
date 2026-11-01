import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const ID=/^[a-zA-Z0-9_-]{1,100}$/,OUTPUT=/^[a-zA-Z0-9_-]{1,90}$/;
const STATES=new Set(['queued','running','done','error','interrupted']);
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const progress=value=>Math.max(0,Math.min(100,Number.isFinite(Number(value))?Number(value):0));
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const visible=job=>Object.fromEntries(Object.entries(job).filter(([key])=>!key.startsWith('_')));
const storageError=message=>Object.assign(new Error(message),{statusCode:503});

/** One owner per cache directory: the local renderer OR the authenticated worker. */
export async function createExportJobJournal({cacheDir,mediaDir,limit=100,debounceMs=750}){
 const filename=path.join(cacheDir,'export-jobs.json'),jobs=new Map();
 let timer=null,serial=0,ordinal=0,writeChain=Promise.resolve(),readError=null,lastWriteError=null;
 await mkdir(cacheDir,{recursive:true});
 const ordered=()=>[...jobs.values()].sort((a,b)=>Date.parse(b.created)-Date.parse(a.created)||b.id.localeCompare(a.id));
 const trim=()=>{const all=ordered(),keep=new Set(all.filter(job=>job.status==='queued'||job.status==='running').map(job=>job.id));for(const job of all)if(keep.size<Math.max(1,Math.min(100,limit)))keep.add(job.id);let removed=false;for(const job of all)if(!keep.has(job.id)){jobs.delete(job.id);removed=true;}return removed;};
 const ready=()=>{if(readError)throw storageError(readError);if(lastWriteError)throw storageError(lastWriteError);};
 async function persist(){
  if(timer){clearTimeout(timer);timer=null;}
  if(readError)throw storageError(readError);
  trim();const payload=JSON.stringify({version:1,jobs:ordered().map(job=>({...visible(job),_order:job._order}))},null,2)+'\n';
  const write=async()=>{
   const temporary=filename+'.tmp-'+process.pid+'-'+(++serial);let handle;
   try{handle=await open(temporary,'wx',0o600);await handle.writeFile(payload);await handle.sync();await handle.close();handle=null;await rename(temporary,filename);lastWriteError=null;}
   catch(error){lastWriteError='Не удалось сохранить историю экспортов. Проверьте доступ к папке данных.';console.error('Export journal:',error.message);throw storageError(lastWriteError);}
   finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  };
  const pending=writeChain.catch(()=>{}).then(write);writeChain=pending;return pending;
 }
 function scheduled(){if(!timer){timer=setTimeout(()=>{timer=null;void persist().catch(()=>{});},debounceMs);timer.unref();}}
 async function outputReady(job){
  if(!OUTPUT.test(job.outputName))return false;
  try{
   const video=path.join(mediaDir,job.outputName+'.mp4'),metaFile=path.join(mediaDir,job.outputName+'.json');
   const [videoInfo,metaInfo]=await Promise.all([stat(video),stat(metaFile)]);
   if(!videoInfo.isFile()||videoInfo.size<32||!metaInfo.isFile()||metaInfo.size<2||metaInfo.size>5_000_000)return false;
   // Reusing an output name must not turn an older export into this job's success.
   const earliest=Date.parse(job.created)-1000;
   if(videoInfo.mtimeMs<earliest||metaInfo.mtimeMs<earliest)return false;
   const meta=JSON.parse(await readFile(metaFile,'utf8'));
   if(meta.jobId!==job.id)return false;
   if(!Number.isFinite(Number(meta.duration))||Number(meta.duration)<=0||!Number.isFinite(Number(meta.width))||Number(meta.width)<=0||!Number.isFinite(Number(meta.height))||Number(meta.height)<=0||!date(meta.created)||Date.parse(meta.created)<earliest)return false;
   const handle=await open(video,'r');try{const header=Buffer.alloc(12);const {bytesRead}=await handle.read(header,0,12,0);return bytesRead===12&&header.toString('ascii',4,8)==='ftyp';}finally{await handle.close();}
  }catch{return false;}
 }
 function done(job){Object.assign(job,{status:'done',progress:100,message:'Готово. Видео сохранено в видеостудии.',updated:new Date().toISOString(),url:'/media/'+encodeURIComponent(job.outputName+'.mp4')});}
 try{
  const info=await stat(filename);if(info.size>2_000_000)throw Error('Journal is too large');
  const stored=JSON.parse(await readFile(filename,'utf8'));
  if(stored?.version!==1||!Array.isArray(stored.jobs))throw Error('Unknown journal format');
  for(const value of stored.jobs){
   if(!value||typeof value.id!=='string'||typeof value.outputName!=='string'||!ID.test(value.id)||value.id.startsWith('preview-')||!OUTPUT.test(value.outputName)||!STATES.has(value.status)||!date(value.created))continue;
   const job={id:value.id,title:clean(value.title,160)||'Новый ролик',status:value.status,progress:progress(value.progress),message:clean(value.message,1200),created:date(value.created),updated:date(value.updated)||date(value.created),outputName:value.outputName,_order:Number.isSafeInteger(value._order)&&value._order>0?value._order:++ordinal};
   ordinal=Math.max(ordinal,job._order);jobs.set(job.id,job);
  }
  let changed=trim();
  for(const job of jobs.values()){
   if(job.status==='running'||job.status==='done'){
    if(await outputReady(job)){if(job.status!=='done'){done(job);changed=true;}else job.url='/media/'+encodeURIComponent(job.outputName+'.mp4');}
    else{job.status=job.status==='running'?'interrupted':'error';job.message=job.status==='interrupted'?'Экспорт прерван после остановки приложения. Готовое видео не найдено. Запустите экспорт заново.':'Готовое видео или его описание больше не доступны. Запустите экспорт заново.';job.updated=new Date().toISOString();changed=true;}
   }
  }
  if(changed)await persist();
 }catch(error){if(error.code!=='ENOENT'){readError='Не удалось прочитать историю экспортов. Файл export-jobs.json повреждён или недоступен; сохранённый файл не изменён.';console.error('Export journal restore:',error.message);}}
 async function reconcile(){
  ready();let changed=false;
  // A surviving renderer may finish after its owner stopped. Only actual final
  // artifacts can recover an interrupted job; no progress number proves success.
  for(const job of jobs.values()){
   if(job.status==='interrupted'&&await outputReady(job)){done(job);changed=true;}
   else if(job.status==='done'&&!await outputReady(job)){job.status='error';job.message='Результат этого экспорта удалён, заменён или недоступен. Запустите экспорт заново.';job.updated=new Date().toISOString();delete job.url;changed=true;}
  }
  if(changed)await persist();
 }
 return{
  async list(){await reconcile();return ordered().map(visible);},
  async get(id){await reconcile();const job=jobs.get(id);return job?visible(job):null;},
  async pending(){ready();return [...jobs.values()].filter(job=>job.status==='queued').sort((a,b)=>a._order-b._order).map(visible);},
  async begin(project,id,{status='running'}={}){
   ready();if(!['running','queued'].includes(status))throw Error('Некорректное состояние экспорта.');if(jobs.has(id))throw Object.assign(new Error('Экспорт с таким номером уже существует.'),{statusCode:409});if(!ID.test(id)||id.startsWith('preview-'))throw Error('Некорректный номер экспорта.');
   const outputName=String(project.outputName||`${project.settings.experiment}-${id}`);
   if(!OUTPUT.test(outputName))throw Error('Название файла: от 1 до 90 латинских букв, цифр, дефисов или подчёркиваний.');
   const now=new Date().toISOString(),job={id,title:clean(project.name||project.film?.title||project.settings?.story?.title,160)||'Новый ролик',status,progress:0,message:status==='queued'?'В очереди на экспорт.':'Подготовка физического расчёта…',created:now,updated:now,outputName,_order:++ordinal};
   jobs.set(id,job);trim();await persist();return visible(job);
  },
  async start(id){ready();const job=jobs.get(id);if(!job||job.status!=='queued')throw Error('Экспорт больше не находится в очереди.');job.status='running';job.message='Подготовка физического расчёта…';job.updated=new Date().toISOString();await persist();return visible(job);},
  async defer(id){const job=jobs.get(id);if(!job||job.status!=='running')return;job.status='queued';job.message='В очереди на экспорт.';job.updated=new Date().toISOString();await persist();},
  async fail(id,message){const job=jobs.get(id);if(!job||!['queued','running'].includes(job.status))return;job.status='error';job.message=clean(message,1200)||'Не удалось запустить экспорт.';job.updated=new Date().toISOString();delete job.url;await persist();return visible(job);},
  update(id,update){const job=jobs.get(id);if(!job||job.status!=='running')return;if(Number.isFinite(update.progress))job.progress=progress(update.progress);if(update.message)job.message=clean(update.message,1200);job.updated=new Date().toISOString();scheduled();},
  async finish(id,{code,error}={}){
   const job=jobs.get(id);if(!job||job.status!=='running')return job?visible(job):null;
   if(code===0&&await outputReady(job))done(job);
   else{job.status='error';job.message=code===0?'Рендер завершился, но готовое MP4 или описание видео не найдены. Запустите экспорт заново.':'Не удалось завершить рендер: '+(clean(error,1000)||'процесс видеорендера остановился.');job.updated=new Date().toISOString();delete job.url;}
   await persist();return visible(job);
  },
  async flush(){await persist();await writeChain;},
 };
}
