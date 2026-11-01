import {open,readFile,unlink,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {cacheDir} from '../runtime-paths.mjs';
const lockPath=path.join(cacheDir,'render.lock');
export async function acquireRenderLock(progress=()=>{}){
 await mkdir(path.dirname(lockPath),{recursive:true});let announced=false;
 for(;;){
  try{const handle=await open(lockPath,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,started:Date.now()}));return{async release(){await handle.close();try{const owner=JSON.parse(await readFile(lockPath,'utf8'));if(owner.pid===process.pid)await unlink(lockPath);}catch{}}};}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   try{const owner=JSON.parse(await readFile(lockPath,'utf8'));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH'){await unlink(lockPath);continue;}}}
   catch{try{const info=await stat(lockPath);if(Date.now()-info.mtimeMs>10000){await unlink(lockPath);continue;}}catch{continue;}}
   if(!announced){progress(0,'Ожидает завершения предыдущего рендера');announced=true;}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
 }
}
