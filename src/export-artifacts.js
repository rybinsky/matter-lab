// Pure serialization helpers. Authoring data is copied, never normalized away.
const copy=value=>value===undefined?undefined:structuredClone(value);
const runtimeKeys=['jobId','outputName','preview','previewFps','previewDuration'];

/** Strip runtime flags only at project boundaries, including film children.
 * An unknown physical field, even one named "preview" inside a material or
 * solver configuration, remains authoring data and must survive the download.
 */
export function downloadableProject(project,{title}={}){
 const result=copy(project);
 for(const key of runtimeKeys)delete result[key];
 if(!Object.hasOwn(result,'version'))result.version=1;
 if(!Object.hasOwn(result,'name')&&title!==undefined)result.name=title;
 if(!Object.hasOwn(result,'objects'))result.objects=[];
 if(!Object.hasOwn(result,'edits'))result.edits={};
 if(Array.isArray(result.film?.clips))for(const clip of result.film.clips)if(clip.project&&typeof clip.project==='object')clip.project=downloadableProject(clip.project);
 return result;
}

export function exportMetadata(project,data,{id,name,created}={}){
 return copy({jobId:id,experiment:data.experiment,title:data.title,description:project.description,duration:data.duration,width:data.width,height:data.height,fps:data.fps,showcase:!!project.showcase,collection:project.collection||(project.settings?.scenarioKit?'studio':undefined),revision:data.revision,editing:data.editing,camera:data.cameraMode,music:data.audioPreset,musicTrack:data.musicTrack,environment:data.environment,soundDesign:data.soundDesign,sourceProjectName:name+'.project.json',story:data.story,film:data.film,analysis:data.analysis,takes:data.takes.map(t=>({label:t.label,detail:t.detail,settings:t.settings,experiment:t.experiment,clipId:t.clipId,clipIndex:t.clipIndex,start:t.start,duration:t.duration,observationTime:t.observationTime,negativeControl:t.negativeControl,modelProvenance:t.modelProvenance})),models:data.models||{orbit:'Central gravity / velocity Verlet',thermal:'Lumped heat balance / melt enthalpy',flow:'Clavet-style Double Density Relaxation'}[data.experiment]||'Rapier 0.21',modelProvenance:data.modelProvenance,created});
}
