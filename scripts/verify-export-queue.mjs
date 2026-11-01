import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExportQueue } from '../export-queue.mjs';
import { createExportJobJournal } from '../export-job-journal.mjs';
import { validateProject } from '../src/validation.js';
import { validateFilm } from '../src/film.js';
import { settingsFor } from '../src/catalog.js';
const temp=await mkdtemp(path.join(tmpdir(),'matter-queue-')),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const validate=p=>{validateProject(p);validateFilm(p.film,{fps:p.settings.exportFps||30});return p;};
const project=(name,id)=>({version:1,name,settings:settingsFor('blank'),objects:[{id:'ball',asset:'ball',position:[0,2,0],mass:1}],edits:{},outputName:id});
async function waitFor(fn){const deadline=Date.now()+5000;for(;;){const result=await fn();if(result)return result;assert(Date.now()<deadline,'Queue fixture timed out');await sleep(10);}}
async function artifact(media,id,p){await mkdir(media,{recursive:true});const b=Buffer.alloc(64);b.writeUInt32BE(24);b.write('ftypisom',4);await writeFile(path.join(media,p.outputName+'.mp4'),b);await writeFile(path.join(media,p.outputName+'.json'),JSON.stringify({jobId:id,duration:60,width:1080,height:1920,created:new Date().toISOString()}));}
try{
 const cache=path.join(temp,'cache'),media=path.join(temp,'videos'),started=[],releases=new Map();let active=0,maximum=0;
 const queue=await createExportQueue({cacheDir:cache,mediaDir:media,validate,run:async(p,{id,onProgress})=>{active++;maximum=Math.max(maximum,active);started.push({id,project:structuredClone(p)});onProgress({progress:42,message:'Held fixture'});await new Promise(resolve=>releases.set(id,resolve));await artifact(media,id,p);active--;return{code:0};}});
 const original=project('Original title','first'),submitting=queue.enqueue(original,'first');original.name='Edited after enqueue';original.objects[0].mass=99;const first=await submitting;assert.equal(first.status,'queued');assert.equal(JSON.parse(await readFile(path.join(cache,'queued-projects/first.json'))).objects[0].mass,1,'Snapshot exists and is immutable before acceptance');await waitFor(()=>started.length===1);assert.equal(started[0].project.name,'Original title');assert.equal(started[0].project.objects[0].mass,1);
 const snapshots=[];for(let i=0;i<8;i++){const p=project('Waiting '+i,'waiting-'+i),pending=queue.enqueue(p,'waiting-'+i);p.name='Mutated '+i;p.objects[0].position[0]=999;snapshots.push(pending);}const accepted=await Promise.all(snapshots);assert(accepted.every(j=>j.status==='queued'));assert.equal((await queue.list()).filter(j=>j.status==='queued').length,8);await assert.rejects(()=>queue.enqueue(project('Too many','overflow'),'overflow'),e=>e.statusCode===429&&e.message.includes('8'));assert.equal(started.length,1,'Only one renderer runs');
 releases.get('first')();for(let i=0;i<8;i++){await waitFor(()=>releases.has('waiting-'+i));assert.equal(started[i+1].project.name,'Waiting '+i);assert.equal(started[i+1].project.objects[0].position[0],0);releases.get('waiting-'+i)();}
 await waitFor(async()=>!(await queue.list()).some(j=>['running','queued'].includes(j.status)));assert.equal(maximum,1);assert.deepEqual(started.map(j=>j.id),['first',...Array.from({length:8},(_,i)=>'waiting-'+i)]);assert((await queue.list()).every(j=>j.status==='done'));await queue.shutdown();
 // Restart keeps previously accepted queued snapshots, revalidates them, and
 // never silently reruns a job which had already become active.
 const restoredCache=path.join(temp,'restored/cache'),restoredMedia=path.join(temp,'restored/videos'),journal=await createExportJobJournal({cacheDir:restoredCache,mediaDir:restoredMedia});await mkdir(path.join(restoredCache,'queued-projects'),{recursive:true});
 await journal.begin(project('Was running','was-running'),'was-running');
 for(const id of ['missing','invalid','saved-one','saved-two']){await journal.begin(project(id,id),id,{status:'queued'});if(id!=='missing')await writeFile(path.join(restoredCache,'queued-projects',id+'.json'),JSON.stringify(id==='invalid'?{version:1,objects:[]}:project(id,id)));}
 const resumed=[],restored=await createExportQueue({cacheDir:restoredCache,mediaDir:restoredMedia,validate,run:async(p,{id})=>{resumed.push(id);await artifact(restoredMedia,id,p);return{code:0};}});await waitFor(async()=>!(await restored.list()).some(j=>['queued','running'].includes(j.status)));assert.deepEqual(resumed,['saved-one','saved-two']);assert.equal((await restored.get('was-running')).status,'interrupted');assert.equal((await restored.get('missing')).status,'error');assert.equal((await restored.get('invalid')).status,'error');assert.equal((await restored.get('saved-one')).status,'done');await restored.shutdown();
 console.log('Export queue passed: immutable atomic snapshots before acceptance, 8 waiting +1 active, concurrent capacity, stable FIFO, single renderer, sequential completion, queued restore/revalidation, interrupted active jobs, missing/invalid snapshots continue to next.');
}finally{await rm(temp,{recursive:true,force:true});}
