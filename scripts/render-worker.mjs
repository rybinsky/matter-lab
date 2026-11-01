import http from 'node:http';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {appRoot,cacheDir,mediaDir} from '../runtime-paths.mjs';
import {validateProject} from '../src/validation.js';
import {validateFilm} from '../src/film.js';
import {createExportQueue} from '../export-queue.mjs';

const appVersion=JSON.parse(await readFile(path.join(appRoot,'package.json'),'utf8')).version;
const token=process.env.MATTER_LAB_RENDER_WORKER_TOKEN||'';
if(token.length<32)throw new Error('Set a render worker token of at least 32 characters.');
await Promise.all([mkdir(cacheDir,{recursive:true}),mkdir(mediaDir,{recursive:true})]);
const validate=project=>{validateProject(project);validateFilm(project.film,{fps:project.settings.exportFps||30});return{...project,height:[720,1080,2160].includes(project.height)?project.height:1080};};
const jobs=await createExportQueue({cacheDir,mediaDir,appRoot,validate});
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const authorized=req=>{const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);return actual.length===expected.length&&timingSafeEqual(actual,expected);};
const server=http.createServer(async(req,res)=>{
 try{
  if(!authorized(req))return json(res,401,{error:'Render worker authorization required.'});
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,kind:'matter-lab-render-worker',platform:process.platform,renderer:'SceneKit / Metal',busy:jobs.busy,version:appVersion});
  if(req.method==='GET'&&url.pathname==='/jobs')return json(res,200,await jobs.list());
  if(req.method==='GET'&&url.pathname.startsWith('/jobs/')){const job=await jobs.get(url.pathname.slice(6));return json(res,job?200:404,job||{error:'Задание не найдено'});}
  if(req.method!=='POST'||url.pathname!=='/jobs')return json(res,404,{error:'Not found'});
  let body='';for await(const chunk of req){body+=chunk;if(body.length>20_000_000)throw new Error('Слишком большой проект');}
  const request=JSON.parse(body),project=request.project;
  const job=await jobs.enqueue(project,'render-'+randomUUID());
  json(res,202,job);
 }catch(error){json(res,error.statusCode||400,{error:error.message});}
});
const port=Number(process.env.MATTER_LAB_RENDER_WORKER_PORT)||4316,host=process.env.MATTER_LAB_RENDER_WORKER_HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Matter Lab render worker: ${host}:${port}`));
process.on('SIGTERM',()=>{void jobs.shutdown({terminateActive:true}).catch(error=>console.error(error.message));server.close();});
