import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {normalizeProjectTemplates} from '../src/project-templates.js';
import {validateProject} from '../src/validation.js';
import {validateFilm,filmDuration} from '../src/film.js';

// Exercise the shipped library as a producer receives it, including assets.
const publicRoot=new URL('../public/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('projects/templates.json',publicRoot),'utf8'));
const original=JSON.stringify(manifest);
const templates=normalizeProjectTemplates(manifest,'http://127.0.0.1:4310/');
assert(templates.length>0,'The shipped project library must not be empty');
const music=new Set(JSON.parse(await readFile(new URL('music/catalog.json',publicRoot),'utf8')).map(track=>track.id));
let clips=0;
for(const template of templates){
 const file=new URL(template.projectUrl.slice(1),publicRoot),text=await readFile(file,'utf8'),project=JSON.parse(text);
 assert(!/\/(?:Users|private|home|var\/folders)\//.test(text),`${template.id}: machine-specific path in portable project`);
 validateProject(project);validateFilm(project.film,{fps:project.settings?.exportFps||30});
 const projects=[project,...(project.film?.clips||[]).map(clip=>clip.project)];
 for(const scene of projects){
  validateProject(scene);
  const track=scene.settings?.musicTrack;
  if(track&&track!=='off')assert(music.has(track),`${template.id}: missing bundled music ${track}`);
 }
 if(project.film?.enabled){assert(filmDuration(project.film,{fps:project.settings.exportFps||30})>0);clips+=project.film.clips.length;}
 if(template.posterUrl){const poster=await stat(new URL(template.posterUrl.slice(1),publicRoot));assert(poster.isFile()&&poster.size>100,`${template.id}: missing poster`);}
}
assert.equal(JSON.stringify(manifest),original,'Reading the library must not mutate it');
console.log(`Project library: ${templates.length} portable projects, ${clips} film clips and bundled media references passed.`);
