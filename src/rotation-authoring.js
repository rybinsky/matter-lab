import {initializePhysics,LabWorld} from './physics.js';
import {settingsFor} from './catalog.js';
import {validateProject} from './validation.js';
export const ROTATION_AXES=Object.freeze([{id:'minimum',name:'Минимальный момент'},{id:'intermediate',name:'Промежуточный'},{id:'maximum',name:'Максимальный момент'}]);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),fail=m=>{throw Error('Вращение: '+m);},arr=v=>[v.x,v.y,v.z],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],scale=(a,s)=>a.map(v=>v*s);
export function unitVector(value){if(!Array.isArray(value)||value.length!==3||![0,1,2].every(i=>typeof value[i]==='number'&&Number.isFinite(value[i])))fail('неверная ось.');const n=Math.hypot(...value);if(n<1e-12)fail('ось не может быть нулевой.');return value.map(v=>v/n);}
function unitQ(q){if(!object(q)||!['x','y','z','w'].every(k=>typeof q[k]==='number'&&Number.isFinite(q[k])))fail('неверная ориентация.');const n=Math.hypot(q.x,q.y,q.z,q.w);if(n<1e-12)fail('неверная ориентация.');return Object.fromEntries(['x','y','z','w'].map(k=>[k,q[k]/n]));}
export function rotateVector(vector,quaternion){const q=unitQ(quaternion),t=cross([q.x,q.y,q.z],vector),u=cross([q.x,q.y,q.z],t);return vector.map((v,i)=>v+2*(q.w*t[i]+u[i]));}
const eligible=o=>o&&!o.deleted&&!o.fixed&&!o.kinematic&&o.asset!=='softcube'&&!(o.deformable&&o.deformable.enabled!==false);
export function rotationTargets(project){return(project?.objects||[]).map(o=>({...structuredClone(o),...structuredClone(project.edits?.[o.id]||{})})).filter(eligible);}
function target(project,id){if(typeof id!=='string'||!id)fail('выберите предмет.');const source=project?.objects?.find(o=>o.id===id),spec=source?{...structuredClone(source),...structuredClone(project.edits?.[id]||{})}:null;if(!eligible(spec))fail('нужен добавленный свободный твёрдый предмет.');return spec;}
const signature=spec=>JSON.stringify(Object.fromEntries(['id','asset','parts','mass','material','position','rotation','scale'].map(k=>[k,spec[k]])));
/** Independent allocation only: no step and no handles escape this function. */
export async function previewRotationInertia(project,id){
 validateProject(project);const spec=target(project,id);await initializePhysics();const lab=new LabWorld({...settingsFor('blank'),gravity:0,windSpeed:0,autoLaunch:false,connections:[],emitters:[],atmosphere:{enabled:false}},[spec]);
 try{
  const body=lab.find(id)?.body;if(!body||body.isFixed()||body.isKinematic())fail('предмет не поддерживает свободное вращение.');
  const moments=arr(body.principalInertia()),principalFrame=unitQ(body.principalInertiaLocalFrame()),rotation=unitQ(body.rotation());if(moments.some(v=>!Number.isFinite(v)||v<=0))fail('нужны положительные моменты инерции.');
  const axes=moments.map((moment,i)=>({moment,local:unitVector(rotateVector([0,1,2].map(k=>k===i?1:0),principalFrame))})).sort((a,b)=>a.moment-b.moment);
  // Principal directions have arbitrary signs. Canonical local signs for the
  // first two and a right-handed third keep the perturbation basis coherent.
  for(const axis of axes.slice(0,2)){const k=axis.local.reduce((best,v,i)=>Math.abs(v)>Math.abs(axis.local[best])?i:best,0);if(axis.local[k]<0)axis.local=scale(axis.local,-1);}
  if(dot(cross(axes[0].local,axes[1].local),axes[2].local)<0)axes[2].local=scale(axes[2].local,-1);
  return{version:1,targetId:id,sourceSignature:signature(spec),mass:body.mass(),localCOM:arr(body.localCom()),worldCOM:arr(body.worldCom()),rotation,principalFrame,axes:axes.map((axis,i)=>({...axis,id:ROTATION_AXES[i].id,world:unitVector(rotateVector(axis.local,rotation))})),angularDamping:body.angularDamping(),angularVelocity:arr(body.angvel())};
 }finally{lab.dispose();}
}
export function normalizeRotationParameters(input={}){
 if(!object(input)||Object.keys(input).some(k=>!['axis','speed','perturbationPercent','perturbationPhase','angularDamping','zeroGravity'].includes(k)))fail('неверные параметры.');
 const values={axis:'intermediate',speed:4,perturbationPercent:.5,perturbationPhase:45,angularDamping:0,zeroGravity:false,...input};if(!ROTATION_AXES.some(a=>a.id===values.axis))fail('выберите главную ось.');
 for(const[key,label,min,max]of[['speed','Скорость, рад/с',-1000,1000],['perturbationPercent','Поперечная примесь, %',0,200],['perturbationPhase','Направление примеси, °',-3600,3600],['angularDamping','Затухание вращения',0,100]])if(typeof values[key]!=='number'||!Number.isFinite(values[key])||values[key]<min||values[key]>max)fail(`${label}: от ${min} до ${max}.`);
 if(typeof values.zeroGravity!=='boolean')fail('неверное включение невесомости.');return values;
}
export function angularVelocityFromPrincipalAxes(preview,input){
 const p=normalizeRotationParameters(input);if(!preview||preview.axes?.length!==3)fail('сначала рассчитайте инерцию предмета.');const index=ROTATION_AXES.findIndex(a=>a.id===p.axis),a=unitVector(preview.axes[index].world),b=unitVector(preview.axes[(index+1)%3].world),c=unitVector(preview.axes[(index+2)%3].world),phase=p.perturbationPhase*Math.PI/180,transverse=Math.abs(p.speed)*p.perturbationPercent/100;
 if(Math.abs(dot(a,b))>1e-6||Math.abs(dot(a,c))>1e-6||Math.abs(dot(b,c))>1e-6||dot(cross(a,b),c)<1-1e-6)fail('неверный базис главных осей.');
 return a.map((v,i)=>v*p.speed+transverse*(b[i]*Math.cos(phase)+c[i]*Math.sin(phase)));
}
export function rotationParametersFromPreview(preview){
 const w=preview.angularVelocity,speed=Math.hypot(...w);if(speed<1e-9)return normalizeRotationParameters({angularDamping:preview.angularDamping});const components=preview.axes.map(a=>dot(w,a.world)),index=components.reduce((best,v,i)=>Math.abs(v)>Math.abs(components[best])?i:best,0),main=components[index],b=components[(index+1)%3],c=components[(index+2)%3];
 return normalizeRotationParameters({axis:ROTATION_AXES[index].id,speed:main,perturbationPercent:Math.hypot(b,c)/Math.abs(main)*100,perturbationPhase:Math.atan2(c,b)*180/Math.PI,angularDamping:preview.angularDamping});
}
export function compileRotationDraft(project,id,input,preview){
 const spec=target(project,id),p=normalizeRotationParameters(input);if(preview?.targetId!==id||preview?.sourceSignature!==signature(spec))fail('предмет изменился. Рассчитайте инерцию заново.');const angularVelocity=angularVelocityFromPrincipalAxes(preview,p),next=structuredClone(project);next.edits??={};next.edits[id]={...next.edits[id],angularVelocity,angularDamping:p.angularDamping};if(p.zeroGravity)next.settings.gravity=0;validateProject(next);return next;
}
