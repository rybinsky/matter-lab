import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const tests=['verify.mjs','verify-penetration.mjs','verify-atmosphere.mjs','verify-connection-authoring.mjs','verify-layout-buoyancy.mjs','verify-graphics-style.mjs','verify-cue-preview.mjs','verify-model-provenance.mjs','verify-penetration-scene.mjs','verify-interaction-authoring.mjs','verify-scene-annotations.mjs','verify-connection-visuals.mjs','verify-breakable-assemblies.mjs','verify-deformable-assets.mjs','verify-lab-interactions.mjs','verify-validation.mjs','verify-household-assets.mjs','verify-object-properties.mjs','verify-layout-assembly.mjs','verify-connections.mjs','verify-melt-surface.mjs','verify-project-store.mjs','verify-scenario-kits.mjs','verify-events.mjs','verify-frame-sampling.mjs','verify-camera-rig.mjs','verify-camera-attention.mjs','verify-cinematography.mjs','verify-editing.mjs','verify-film.mjs','verify-film-timing.mjs','verify-film-editing.mjs','verify-timed-captions.mjs','verify-sound.mjs','verify-recorded-audio.mjs','verify-export-jobs.mjs','verify-export-queue.mjs','verify-export-queue-http.mjs','verify-caption-insertion.mjs','verify-rehearsal-audio.mjs'];
async function run(args){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
  child.on('error',reject);
  child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${args.at(-1)} failed (${signal||code}).`)));
 });
}
async function modules(folder){
 const list=[];
 for(const entry of await readdir(path.join(root,folder),{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(entry.isDirectory())list.push(...await modules(file));
  else if(/\.(js|mjs)$/.test(entry.name))list.push(file);
 }
 return list.sort();
}
const files=[...(await modules('src')),...(await modules('scripts')),...(await modules('packaging')),...(await readdir(root)).filter(f=>f.endsWith('.mjs'))];
for(const file of files)await run(['--check',file]);
console.log(`Syntax: ${files.length} modules passed.`);
for(const test of tests){console.log(`\nChecking ${test}`);await run([path.join('scripts',test)]);}
console.log(`\nAll ${tests.length} verification suites passed.`);
