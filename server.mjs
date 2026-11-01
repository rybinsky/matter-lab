import http from 'node:http';
import { createReadStream, constants } from 'node:fs';
import { readFile, readdir, stat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { validateProject } from './src/validation.js';
import { validateFilm } from './src/film.js';
import {cacheDir,mediaDir,projectsDir} from './runtime-paths.mjs';
import {createProjectStore} from './project-store.mjs';
import {createExportQueue} from './export-queue.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const appVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const jobs=new Map();let currentPreview=null;
const projectStore=createProjectStore(projectsDir);
await mkdir(mediaDir,{recursive:true});
const development=process.env.MATTER_LAB_DEV==='1';
const uiRoot=path.resolve(root,process.env.MATTER_LAB_UI_DIR||'dist');
const vite=development?await(await import('vite')).createServer({root,server:{middlewareMode:true,host:'127.0.0.1',fs:{strict:true,allow:[root]},watch:{ignored:['**/.cache/**','**/dist/**','**/scripts/**']}},appType:'spa'}):null;
const workerURL=process.env.MATTER_LAB_RENDER_WORKER_URL?.replace(/\/$/,'');
const exportJobs=workerURL?null:await createExportQueue({cacheDir,mediaDir,appRoot:root,validate:validProject});
async function workerRequest(endpoint,{method='GET',body:payload}={}){
 const response=await fetch(workerURL+endpoint,{method,headers:{'Authorization':'Bearer '+(process.env.MATTER_LAB_RENDER_WORKER_TOKEN||''),'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(10000)});
 return{status:response.status,data:await response.json()};
}
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.wasm':'application/wasm'};
async function stableUI(url,req,res){
 let file=path.resolve(uiRoot,'.'+decodeURIComponent(url.pathname));
 if(file!==uiRoot&&!file.startsWith(uiRoot+path.sep)){res.writeHead(403);res.end();return;}
 try{const info=await stat(file);if(info.isDirectory())file=path.join(file,'index.html');}
 catch{if(!path.extname(file))file=path.join(uiRoot,'index.html');else{res.writeHead(404);res.end('Not found');return;}}
 const info=await stat(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
 if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function finite(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>20_000_000)throw new Error('Слишком большой проект');}return JSON.parse(text);}
function validProject(p){
 validateProject(p);
 validateFilm(p.film,{fps:p.settings?.exportFps||30});
 const allowed=['impact','cascade','mechanism','soft','flow','thermal','orbit','blank'];
 if(!p||p.version!==1||!allowed.includes(p.settings?.experiment))throw new Error('Неподдерживаемый эксперимент');
 if(!Array.isArray(p.objects)||p.objects.length>150)throw new Error('Лимит сцены — 150 добавленных предметов');
 return {...p,settings:{...p.settings,gravity:finite(p.settings.gravity,9.81,0,20),speed:finite(p.settings.speed,8,0,p.settings.experiment==='orbit'?30000:100),mass:finite(p.settings.mass,12,.05,1000),azimuth:finite(p.settings.azimuth,180,0,360),elevation:finite(p.settings.elevation,0,-85,85)},height:[720,1080,2160].includes(p.height)?p.height:1080,series:!!p.series};
}
async function reels(){
 const names=await readdir(mediaDir);const result=[];
 for(const name of names.filter(n=>n.endsWith('.mp4')&&!n.startsWith('preview'))){const base=name.slice(0,-4);let meta={};try{meta=JSON.parse(await readFile(path.join(mediaDir,base+'.json'),'utf8'));}catch{continue;}if(!meta.duration||meta.duration<19&&Number(meta.revision)<5)continue;const info=await stat(path.join(mediaDir,name));result.push({...meta,name,url:'/media/'+encodeURIComponent(name),poster:names.includes(base+'.jpg')?'/media/'+encodeURIComponent(base+'.jpg'):null,size:info.size,modified:info.mtimeMs});}
 return result.sort((a,b)=>b.modified-a.modified);
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Запрос разрешён только из самой студии.'});
  if(url.pathname==='/api/projects'&&req.method==='GET')return json(res,200,await projectStore.list());
  if(url.pathname==='/api/projects'&&req.method==='POST'){const request=await body(req);return json(res,200,await projectStore.save(request.project,{id:request.id}));}
  if(url.pathname.startsWith('/api/projects/')&&req.method==='GET')return json(res,200,await projectStore.get(decodeURIComponent(url.pathname.slice(14))));
  if(url.pathname==='/api/reels')return json(res,200,await reels());
  if(url.pathname==='/api/health')return json(res,200,{ok:true,name:'Matter Lab',version:appVersion,renderMode:workerURL?'worker':process.platform==='darwin'?'local':'unavailable'});
  if(url.pathname==='/api/render-status'){if(workerURL){try{const result=await workerRequest('/health');return json(res,result.status,{...result.data,mode:'worker'});}catch{return json(res,503,{ok:false,mode:'worker',error:'Видеорендер недоступен. Запустите Mac worker.'});}}return json(res,200,{ok:process.platform==='darwin',mode:process.platform==='darwin'?'local':'unavailable',error:process.platform==='darwin'?undefined:'Для экспорта видео подключите Mac render worker.'});}
  if(url.pathname.startsWith('/api/preview-audio/')){
   const match=/^\/api\/preview-audio\/([a-zA-Z0-9_-]{1,80})\.wav$/.exec(url.pathname);
   if(!match)return json(res,404,{error:'Звук репетиции не найден'});
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD','Content-Length':'0'});res.end();return;}
   let handle;
   try{
    handle=await open(path.join(cacheDir,'preview-session-'+match[1]+'.wav'),constants.O_RDONLY|(constants.O_NOFOLLOW||0));const info=await handle.stat();
    if(!info.isFile()||info.size<44){await handle.close();handle=undefined;return json(res,404,{error:'Звук репетиции не найден'});}
    const headers={'Content-Type':'audio/wav','Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
    let start=0,end=info.size-1,status=200;
    if(req.headers.range){
     const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),suffix=range&&!range[1]&&range[2]?Number(range[2]):null;
     if(range&&range[1]){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),info.size-1):end;}
     else if(suffix!==null&&Number.isSafeInteger(suffix)&&suffix>0){start=Math.max(0,info.size-suffix);}
     else start=NaN;
     if(!range||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=info.size||end<start){res.writeHead(416,{...headers,'Content-Range':`bytes */${info.size}`,'Content-Length':'0'});res.end();return;}
     status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
    }
    res.writeHead(status,{...headers,'Content-Length':end-start+1});
    if(req.method==='HEAD'){res.end();return;}
    const stream=handle.createReadStream({start,end,autoClose:true});handle=undefined;stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
   }catch(error){if(['ENOENT','ELOOP','ENOTDIR'].includes(error.code))return json(res,404,{error:'Звук репетиции не найден'});throw error;}
   finally{await handle?.close();}
  }
  if(url.pathname.startsWith('/api/previews/')){
   const id=url.pathname.slice(14);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))return json(res,404,{error:'Репетиция не найдена'});
   const file=path.join(cacheDir,'preview-session-'+id+'.json'),info=await stat(file);res.writeHead(200,{'Content-Type':'application/json;charset=utf-8','Content-Length':info.size,'Cache-Control':'no-store'});createReadStream(file).pipe(res);return;
  }
  if(url.pathname==='/api/jobs'&&req.method==='GET'){
   if(workerURL){try{const result=await workerRequest('/jobs');return json(res,result.status,result.data);}catch{return json(res,503,{error:'История экспортов недоступна. Проверьте подключение к Mac render worker.'});}}
   return json(res,200,await exportJobs.list());
  }
  if(url.pathname.startsWith('/api/jobs/')&&req.method==='GET'){
   const id=url.pathname.slice(10),preview=jobs.get(id);if(preview)return json(res,200,preview);
   if(workerURL&&/^render-[a-zA-Z0-9-]+$/.test(id)){try{const result=await workerRequest('/jobs/'+id);return json(res,result.status,result.data);}catch{return json(res,503,{error:'Статус экспорта недоступен. Проверьте подключение к Mac render worker.'});}}
   const job=exportJobs?await exportJobs.get(id):null;return json(res,job?200:404,job||{error:'Задание не найдено'});
  }
  if(url.pathname==='/api/preview'&&req.method==='POST'){
   if(currentPreview)return json(res,409,{error:'Одна репетиция уже рассчитывается. Дождитесь её завершения.'});
   const p=validProject(await body(req)),id='preview-'+Date.now().toString(36),job={id,status:'running',progress:0,message:'Проверяем движение и строим монтаж…',dataUrl:'/api/previews/'+id};jobs.set(id,job);currentPreview=id;
   const child=spawn(process.execPath,[path.join(root,'scripts/preview-one.mjs')],{cwd:root,stdio:['pipe','pipe','pipe']});child.stdin.end(JSON.stringify({...p,jobId:id}));let pending='',errors='';
   child.stdout.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{Object.assign(job,JSON.parse(line));}catch{console.log(line);}}});
   child.stderr.on('data',c=>errors=(errors+c).slice(-2000));child.on('error',e=>{job.status='error';job.message=e.message;currentPreview=null;});child.on('exit',code=>{job.status=code===0?'done':'error';if(code!==0)job.message=errors;currentPreview=null;});return json(res,202,job);
  }
  if(url.pathname==='/api/export'&&req.method==='POST'){
   if(workerURL){const p=validProject(await body(req)),result=await workerRequest('/jobs',{method:'POST',body:{project:p}});return json(res,result.status,result.data);}
   if(process.platform!=='darwin')return json(res,503,{error:'Для видеорендера подключите Mac render worker.'});
   const p=validProject(await body(req)),id='export-'+randomUUID(),job=await exportJobs.enqueue(p,id);
   return json(res,202,job);
  }
  if(url.pathname.startsWith('/media/')){
   const name=decodeURIComponent(url.pathname.slice(7));if(name!==path.basename(name)||!/\.(mp4|jpg|json)$/.test(name))return json(res,404,{error:'Файл не найден'});
   const file=path.join(mediaDir,name);const info=await stat(file);const type=name.endsWith('.mp4')?'video/mp4':name.endsWith('.jpg')?'image/jpeg':'application/json';
   const range=req.headers.range;
   if(range&&name.endsWith('.mp4')){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m){res.writeHead(416);return res.end();}const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),info.size-1):info.size-1;if(start>=info.size||start>end){res.writeHead(416);return res.end();}res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});createReadStream(file,{start,end}).pipe(res);return;}
   res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'Accept-Ranges':'bytes'});createReadStream(file).pipe(res);return;
  }
  if(vite)vite.middlewares(req,res);else await stableUI(url,req,res);
 }catch(e){json(res,e.statusCode||400,{error:e.message});}
});
const port=Number(process.env.MATTER_LAB_PORT)||4310;
const host=process.env.MATTER_LAB_HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Matter Lab ready: http://${host}:${port}`));
process.on('SIGTERM',()=>{void exportJobs?.shutdown().catch(error=>console.error(error.message));server.close();vite?.close();});
