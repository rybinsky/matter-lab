/** Read-only normal-contact load cells. Measurements never apply forces. */
const record=v=>v&&typeof v==='object'&&!Array.isArray(v),clone=structuredClone;
const fail=m=>{throw Error('Датчик нагрузки: '+m);};
export function normalizeContactSensors(value=[]){
 if(!Array.isArray(value)||value.length>16)fail('не более 16 датчиков.');const ids=new Set();
 return value.map(s=>{if(!record(s)||Object.keys(s).some(k=>!['id','body','axis','window'].includes(k)))fail('неизвестные поля.');for(const key of['id','body'])if(typeof s[key]!=='string'||!s[key]||s[key].length>160||/[\s\x00-\x1f\x7f]/.test(s[key]))fail('нужен идентификатор предмета и датчика.');if(ids.has(s.id))fail('идентификатор уже занят.');ids.add(s.id);
 const axis=s.axis??[0,1,0];if(!Array.isArray(axis)||axis.length!==3||axis.some(x=>!Number.isFinite(x))||Math.hypot(...axis)<1e-8)fail('направление — ненулевой вектор.');const length=Math.hypot(...axis),window=s.window??.1;if(!Number.isFinite(window)||window<.01||window>2)fail('окно усреднения: 0,01–2 с.');return{id:s.id,body:s.body,axis:axis.map(x=>x/length),window};});
}
export class ContactSensors{
 constructor({world,getEntity,sensors=[]}){this.world=world;this.getEntity=getEntity;this.records=normalizeContactSensors(sensors).map(spec=>({spec,samples:[],pairForces:new Map(),force:0,rawForce:0,peakForce:0,elapsed:0,status:'active'}));for(const r of this.records){const e=getEntity(r.spec.body);if(!e?.body||!Array.isArray(e.colliders)||!e.colliders.length)fail('выберите твёрдый предмет со столкновениями.');r.boundBody=e.body;}}
 afterStep(dt,time){
  if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(time))fail('некорректный шаг измерения.');
  for(const r of this.records){const e=this.getEntity(r.spec.body);if(!e?.body||e.body!==r.boundBody||e.body.isValid?.()===false){r.status='retired';r.samples=[];r.rawForce=r.force=0;continue;}if(r.status==='retired')continue;
   let impulse=0;const activePairs=new Set(),own=new Set(e.colliders.map(c=>c.handle));
   for(const collider of e.colliders){if(collider.isValid?.()===false)continue;this.world.contactPairsWith(collider,other=>{if(own.has(other.handle))return;const pairKey=collider.handle+':'+other.handle,still=body=>!body||body.isFixed()||body.isSleeping(),sleeping=still(e.body)&&still(other.parent()),previous=r.pairForces.get(pairKey);let pairImpulse=0;this.world.contactPair(collider,other,(manifold,flipped)=>{const n=manifold.normal(),direction=(flipped?-1:1)*(n.x*r.spec.axis[0]+n.y*r.spec.axis[1]+n.z*r.spec.axis[2]);if(direction<=0)return;let normalImpulse=0;for(let i=0;i<manifold.numContacts();i++)normalImpulse+=Math.max(0,manifold.contactImpulse(i));pairImpulse+=normalImpulse*direction;});const force=sleeping&&previous!==undefined?previous:pairImpulse/dt;impulse+=force*dt;activePairs.add(pairKey);r.pairForces.set(pairKey,force);});}for(const key of r.pairForces.keys())if(!activePairs.has(key))r.pairForces.delete(key);
   r.rawForce=impulse/dt;r.peakForce=Math.max(r.peakForce,r.rawForce);r.elapsed+=dt;r.samples.push({start:time-dt,end:time,impulse});const cutoff=time-r.spec.window;while(r.samples.length&&r.samples[0].end<=cutoff)r.samples.shift();let total=0;for(const s of r.samples){const portion=Math.max(0,s.end-Math.max(cutoff,s.start))/(s.end-s.start);total+=s.impulse*portion;}r.force=total/Math.min(r.elapsed,r.spec.window);r.time=time;
  }
 }
 dispose(){this.records=[];this.world=null;this.getEntity=()=>null;}
 snapshot(gravity){return this.records.map(r=>({id:r.spec.id,body:r.spec.body,status:r.status,axis:clone(r.spec.axis),window:r.spec.window,force:r.force,rawForce:r.rawForce,peakForce:r.peakForce,time:r.time??0,equivalentMass:gravity>0?r.force/gravity:null,method:'normal-contact-impulse',scope:'Compressive normal contact load projected on the declared world axis; excludes tangential friction and joint forces.'}));}
}
