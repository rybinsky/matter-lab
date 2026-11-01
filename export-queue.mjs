import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rename, stat, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createExportJobJournal } from './export-job-journal.mjs';

const ID=/^[a-zA-Z0-9_-]{1,100}$/,MAX_PROJECT_BYTES=20_000_000;
const issue=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});

/** Durable FIFO of authorized project snapshots, with one renderer at a time. */
export async function createExportQueue({cacheDir,mediaDir,appRoot,validate,run,maxPending=8,debounceMs=750}){
 if(typeof validate!=='function')throw Error('Export queue needs project validation.');
 const journal=await createExportJobJournal({cacheDir,mediaDir,debounceMs}),directory=path.join(cacheDir,'queued-projects');
 await mkdir(directory,{recursive:true});
 let active=null,activeChild=null,pumping=false,scheduled=false,stopping=false,intake=Promise.resolve(),serial=0;
 const snapshotPath=id=>{if(!ID.test(id)||id.startsWith('preview-'))throw issue('Некорректный номер экспорта.');return path.join(directory,id+'.json');};
 async function saveSnapshot(id,bytes){
  const filename=snapshotPath(id),temporary=filename+'.tmp-'+process.pid+'-'+(++serial);let handle;
  try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,filename);}
  catch(error){console.error('Export snapshot:',error.message);throw issue('Не удалось сохранить проект для очереди. Проверьте доступ к папке данных.',503);}
  finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
 }
 async function cleanup(){
  const retained=new Set((await journal.list()).map(job=>job.id));
  for(const name of await readdir(directory)){if(name.endsWith('.json')&&ID.test(name.slice(0,-5))&&!retained.has(name.slice(0,-5)))await unlink(path.join(directory,name)).catch(()=>{});}
 }
 async function capturedRun(project,{id,onProgress}){
  return new Promise(resolve=>{
   let child,pending='',errors='',spawnError='';
   try{child=spawn(process.execPath,[path.join(appRoot,'scripts/export-one.mjs')],{cwd:appRoot,stdio:['pipe','pipe','pipe'],env:process.env});}
   catch(error){resolve({code:null,error:error.message});return;}
   activeChild=child;
   child.stdout.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{onProgress(JSON.parse(line));}catch{}}});
   child.stderr.on('data',chunk=>errors=(errors+chunk).slice(-6000));
   child.on('error',error=>{spawnError=error.message;});
   // Do not start the next renderer while the old child is still alive, even
   // when its input pipe closes early. Wait for close after terminating it.
   child.stdin.on('error',error=>{spawnError=error.message;child.kill('SIGTERM');});
   child.on('close',(code,signal)=>{if(activeChild===child)activeChild=null;resolve({code,error:spawnError||errors.slice(-2000)||(signal?'Процесс остановлен ('+signal+').':'')});});
   child.stdin.end(JSON.stringify({...project,jobId:id}));
  });
 }
 const render=run||capturedRun;
 function kick(){if(stopping||pumping||scheduled)return;scheduled=true;setImmediate(()=>{scheduled=false;void pump();});}
 async function pump(){
  if(stopping||pumping)return;pumping=true;
  try{
   while(!stopping){
    const job=(await journal.pending())[0];if(!job)break;
    let project;
    try{const filename=snapshotPath(job.id),info=await stat(filename);if(!info.isFile()||info.size>MAX_PROJECT_BYTES)throw Error('неподдерживаемый размер проекта');project=validate(JSON.parse(await readFile(filename,'utf8')));const outputName=String(project.outputName||`${project.settings.experiment}-${job.id}`);if(outputName!==job.outputName)throw Error('название файла изменилось');}
    catch(error){await journal.fail(job.id,'Не удалось запустить сохранённый проект: '+error.message);await unlink(snapshotPath(job.id)).catch(()=>{});continue;}
    if(stopping)break;active=job.id;await journal.start(job.id);if(stopping){await journal.defer(job.id);active=null;break;}
    let outcome;try{outcome=await render(project,{id:job.id,onProgress:update=>journal.update(job.id,update)});}catch(error){outcome={code:null,error:error.message};}
    await journal.finish(job.id,outcome||{code:null,error:'Процесс видеорендера не вернул результат.'});active=null;
    await unlink(snapshotPath(job.id)).catch(error=>{if(error.code!=='ENOENT')console.error('Export snapshot cleanup:',error.message);});
   }
  }catch(error){console.error('Export queue:',error.message);}
  finally{active=null;pumping=false;if(!stopping)void journal.pending().then(pending=>{if(pending.length)kick();}).catch(()=>{});}
 }
 function enqueue(project,id){
  // Capture before any await: continuing to edit the studio project cannot
  // mutate an already authorized job, including queued jobs not yet started.
  let snapshot,bytes;try{snapshot=validate(structuredClone(project));bytes=JSON.stringify(snapshot);if(Buffer.byteLength(bytes)>MAX_PROJECT_BYTES)throw issue('Слишком большой проект для очереди.');snapshotPath(id);}catch(error){return Promise.reject(error);}
  const add=async()=>{
   if(stopping)throw issue('Студия завершает работу. Повторите экспорт после запуска.',503);
   if((await journal.pending()).length>=Math.min(8,Math.max(1,maxPending)))throw issue('В очереди уже 8 роликов. Дождитесь запуска одного из них.',429);
   if(await journal.get(id))throw issue('Экспорт с таким номером уже существует.',409);
   await saveSnapshot(id,bytes);
   let job;try{job=await journal.begin(snapshot,id,{status:'queued'});}catch(error){await unlink(snapshotPath(id)).catch(()=>{});throw error;}
   kick();return job;
  };
  const added=intake.catch(()=>{}).then(add);intake=added;return added;
 }
 await cleanup().catch(error=>console.error('Export snapshot cleanup:',error.message));kick();
 return{
  enqueue,list:()=>journal.list(),get:id=>journal.get(id),get busy(){return active!==null;},
  async shutdown({terminateActive=false}={}){stopping=true;await intake.catch(()=>{});await journal.flush();if(terminateActive&&activeChild){const child=activeChild;child.kill('SIGTERM');setTimeout(()=>{if(activeChild===child)child.kill('SIGKILL');},6000).unref();}},
 };
}
