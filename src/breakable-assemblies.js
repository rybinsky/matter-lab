import RAPIER from '@dimforge/rapier3d-compat';

export const BREAKABLE_LIMITS=Object.freeze({assemblies:32,bonds:200,bodies:150});
export const BREAKABLE_LOAD_MODEL='contact-graph';
const finite=(x,min=0,max=1e12)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const id=x=>typeof x==='string'&&x.trim()&&x.length<=160&&!/[\u0000-\u001f\u007f]/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=m=>{throw new Error('Некорректная разрушаемая сборка: '+m);};
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,-10000,10000));
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),arr=v=>[v.x,v.y,v.z],vec=a=>({x:a[0],y:a[1],z:a[2]});
const qmul=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const inverse=q=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
const rotate=(p,q)=>{const r=qmul(qmul(q,{x:p[0],y:p[1],z:p[2],w:0}),inverse(q));return[r.x,r.y,r.z];};
const positive=x=>finite(x,Number.MIN_VALUE);

/** Plain project data. No bodies, callbacks or engine handles are persisted. */
export function validateBreakableAssemblies(value=[],{knownBodyIds}={}){
 if(value===undefined)return[];
 if(!Array.isArray(value)||value.length>BREAKABLE_LIMITS.assemblies)fail('не больше 32 сборок.');
 const assemblyIds=new Set(),bondIds=new Set(),bodyIds=new Set(),known=knownBodyIds?new Set(knownBodyIds):null;let total=0;
 for(const a of value){
  if(!object(a)||!id(a.id)||assemblyIds.has(a.id))fail('нужны уникальные идентификаторы сборок.');assemblyIds.add(a.id);
  if(Object.keys(a).some(k=>!['id','name','material','loadModel','bonds'].includes(k)))fail('неизвестный параметр сборки.');
  if(a.name!==undefined&&!id(a.name)||a.material!==undefined&&!id(a.material))fail('неверное название или материал.');
  if(a.loadModel!==undefined&&a.loadModel!==BREAKABLE_LOAD_MODEL)fail('поддерживается модель contact-graph.');
  if(!Array.isArray(a.bonds)||!a.bonds.length)fail('добавьте хотя бы одну связь.');
  total+=a.bonds.length;if(total>BREAKABLE_LIMITS.bonds)fail('не больше 200 разрушаемых связей.');
  for(const b of a.bonds){
   if(!object(b)||!id(b.id)||bondIds.has(b.id)||!id(b.a)||!id(b.b)||b.a===b.b)fail('нужны уникальные связи между двумя разными предметами.');bondIds.add(b.id);
   if(Object.keys(b).some(k=>!['id','a','b','point','breakForceN','strengthPa','areaM2'].includes(k)))fail('неизвестный параметр связи.');
   if(b.point!==undefined&&!vector(b.point))fail('точка связи должна содержать три конечные координаты.');
   if(b.breakForceN!==undefined&&!positive(b.breakForceN))fail('порог силы должен быть положительным, в ньютонах.');
   if((b.strengthPa!==undefined||b.areaM2!==undefined)&&(!positive(b.strengthPa)||!positive(b.areaM2)||!positive(b.strengthPa*b.areaM2)))fail('прочность в Па и площадь в м² задаются вместе.');
   if(b.breakForceN===undefined&&b.strengthPa===undefined)fail('задайте breakForceN или strengthPa × areaM2.');
   for(const ref of [b.a,b.b]){bodyIds.add(ref);if(known&&!known.has(ref))fail(`предмет «${ref}» не найден.`);}
  }
 }
 if(bodyIds.size>BREAKABLE_LIMITS.bodies)fail('не больше 150 предметов в разрушаемых сборках.');
 return value;
}

/** Copy inside drainContactForceEvents: Rapier's temporary event is then freed.
 * totalForce is on collider2; collider1 receives its opposite (verified by Δp).
 */
export function copyContactForceEvent(event){const f=event.totalForce();return{collider1:event.collider1(),collider2:event.collider2(),force:[f.x,f.y,f.z],magnitude:event.totalForceMagnitude()};}

// Sparse grounded Laplacian solve, minimum-norm equal-bond force flow. This is
// a contact-load graph approximation, not a getter for a Rapier joint reaction.
function potential(nodes,edges,demand,roots){
 const free=nodes.filter(id=>!roots.has(id)),index=new Map(free.map((id,i)=>[id,i])),n=free.length,out=new Map(nodes.map(id=>[id,[0,0,0]]));if(!n)return out;
 const links=edges.map(e=>[index.get(e.a),index.get(e.b)]),apply=x=>{const y=new Float64Array(n);for(const[a,b]of links){const d=(a===undefined?0:x[a])-(b===undefined?0:x[b]);if(a!==undefined)y[a]+=d;if(b!==undefined)y[b]-=d;}return y;};
 for(let axis=0;axis<3;axis++){
  const x=new Float64Array(n),r=Float64Array.from(free.map(id=>demand.get(id)[axis])),p=r.slice();let rr=dot(r,r),initial=rr;
  for(let iter=0;iter<Math.min(400,n*3+10)&&rr>Math.max(1e-20,initial*1e-14);iter++){
   const ap=apply(p),denom=dot(p,ap);if(denom<=1e-25)break;const alpha=rr/denom;
   for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];}const next=dot(r,r),beta=next/rr;for(let i=0;i<n;i++)p[i]=r[i]+beta*p[i];rr=next;
  }
  for(let i=0;i<n;i++)out.get(free[i])[axis]=x[i];
 }
 return out;
}

/** Existing rigid fragments + fixed joints. Fracture only removes constraints.
 * Construct after bodies exist. Call beforeStep AFTER user forces are applied,
 * then world.step/event drain, then afterStep with unfiltered copied events.
 * Gravity/user force are included; rotations, bending and continuum stress are
 * not solved. Fixed bases absorb their direct loads. Fragments may not overlap.
 */
export class BreakableAssemblies{
 constructor({world,entitiesById,assemblies=[]}){
  validateBreakableAssemblies(assemblies);if(!world||!(entitiesById instanceof Map))fail('нужны world и entitiesById: Map.');
  this.world=world;this.entities=entitiesById;this.bonds=[];this.events=[];this.baseLoads=new Map();this.colliderBodies=new Map();this.changedColliders=[];this.dt=null;this.disposed=false;
  const dynamicOwners=new Map();
  world.propagateModifiedBodyPositionsToColliders();
  const resolved=assemblies.map(a=>{
   const ids=[...new Set(a.bonds.flatMap(b=>[b.a,b.b]))];
   for(const id of ids){const e=entitiesById.get(id);if(!e?.body||!Array.isArray(e.colliders)||!e.colliders.length||e.body.isKinematic())fail(`«${id}» должен быть динамическим или закреплённым твёрдым фрагментом.`);if(e.body.isDynamic()){if(dynamicOwners.has(id)&&dynamicOwners.get(id)!==a.id)fail('динамический фрагмент не может принадлежать двум сборкам.');dynamicOwners.set(id,a.id);}for(const c of e.colliders)this.colliderBodies.set(c.handle,id);}
   for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)for(const ca of entitiesById.get(ids[i]).colliders)for(const cb of entitiesById.get(ids[j]).colliders){const contact=ca.contactCollider(cb,0);if(contact&&contact.distance<-.0001)fail(`фрагменты «${ids[i]}» и «${ids[j]}» перекрываются. Разделите их геометрию перед разрушением.`);}
   return{...a,ids};
  });
  try{
   for(const a of resolved)for(const spec of a.bonds){
    const ea=entitiesById.get(spec.a),eb=entitiesById.get(spec.b),ba=ea.body,bb=eb.body;if(ba.isFixed()&&bb.isFixed())fail('у разрушаемой связи нужен хотя бы один динамический фрагмент.');
    const pa=arr(ba.translation()),pb=arr(bb.translation()),qa=ba.rotation(),qb=bb.rotation(),point=spec.point||mul(add(pa,pb),.5),aa=rotate(sub(point,pa),inverse(qa)),ab=rotate(sub(point,pb),inverse(qb));
    const joint=world.createImpulseJoint(RAPIER.JointData.fixed(vec(aa),{x:0,y:0,z:0,w:1},vec(ab),qmul(inverse(qb),qa)),ba,bb,true);joint.setContactsEnabled(false);
    this.bonds.push({...structuredClone(spec),assemblyId:a.id,material:a.material||null,thresholdN:spec.breakForceN??spec.strengthPa*spec.areaM2,joint,broken:false,retired:false,peakForceN:0,lastForceN:0});
   }
   for(const id of new Set(resolved.flatMap(a=>a.ids)))for(const c of entitiesById.get(id).colliders){this.changedColliders.push({c,events:c.activeEvents(),threshold:c.contactForceEventThreshold()});c.setActiveEvents(c.activeEvents()|RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);c.setContactForceEventThreshold(0);}
  }catch(error){this.dispose();throw error;}
 }
 retireBody(id){
  for(const b of this.bonds)if(!b.broken&&!b.retired&&(b.a===id||b.b===id)){if(b.joint.isValid())this.world.removeImpulseJoint(b.joint,true);b.retired=true;}
 }
 beforeStep(dt){
  if(this.disposed)throw Error('Разрушаемая сборка уже освобождена.');if(!finite(dt,1e-6,1))throw Error('Шаг разрушения должен быть от 0,000001 до 1 секунды.');this.dt=dt;this.baseLoads.clear();
  for(const b of this.bonds)if(!b.broken&&!b.retired&&(!this.entities.get(b.a)?.body?.isValid()||!this.entities.get(b.b)?.body?.isValid()||!b.joint.isValid())){if(b.joint.isValid())this.world.removeImpulseJoint(b.joint,true);b.retired=true;}
  for(const id of new Set(this.bonds.filter(b=>!b.broken&&!b.retired).flatMap(b=>[b.a,b.b]))){const body=this.entities.get(id).body,m=body.isDynamic()?body.mass():0,g=this.world.gravity,f=body.userForce();this.baseLoads.set(id,[f.x+m*g.x*body.gravityScale(),f.y+m*g.y*body.gravityScale(),f.z+m*g.z*body.gravityScale()]);}
 }
 afterStep(dt,time,contactLoads=[]){
  if(this.disposed||this.dt===null||Math.abs(dt-this.dt)>1e-10||!finite(time,0,1e9)||!Array.isArray(contactLoads))throw Error('Вызовите beforeStep(dt), затем afterStep с тем же шагом и копиями контактных сил.');this.dt=null;
  const intact=this.bonds.filter(b=>!b.broken&&!b.retired),adj=new Map();for(const b of intact){for(const id of [b.a,b.b])if(!adj.has(id))adj.set(id,[]);adj.get(b.a).push(b);adj.get(b.b).push(b);}
  const components=[],componentFor=new Map();for(const first of adj.keys())if(!componentFor.has(first)){const ids=[],todo=[first],component=components.length;componentFor.set(first,component);while(todo.length){const id=todo.pop();ids.push(id);for(const bond of adj.get(id)){const other=bond.a===id?bond.b:bond.a;if(!componentFor.has(other)){componentFor.set(other,component);todo.push(other);}}}components.push(ids);}
  const external=new Map([...adj.keys()].map(id=>[id,(this.baseLoads.get(id)||[0,0,0]).slice()])),contactMagnitude=new Map([...adj.keys()].map(id=>[id,0]));
  for(const event of contactLoads){
   if(!object(event)||!Array.isArray(event.force)||event.force.length!==3||!event.force.every(x=>finite(x,-1e15,1e15)))throw Error('Некорректная копия контактной силы.');
   const a=this.colliderBodies.get(event.collider1),b=this.colliderBodies.get(event.collider2);if(a&&b&&componentFor.has(a)&&componentFor.get(a)===componentFor.get(b))continue;
   for(const[id,sign]of[[a,-1],[b,1]])if(id&&external.has(id)){external.set(id,add(external.get(id),mul(event.force,sign)));contactMagnitude.set(id,contactMagnitude.get(id)+Math.hypot(...event.force));}
  }
  for(const ids of components){
   const set=new Set(ids),edges=intact.filter(b=>set.has(b.a)&&set.has(b.b)),roots=new Set(ids.filter(id=>this.entities.get(id).body.isFixed())),loads=new Map(ids.map(id=>[id,external.get(id).slice()]));
   if(!roots.size){const total=ids.reduce((v,id)=>add(v,loads.get(id)),[0,0,0]),mass=ids.reduce((s,id)=>s+this.entities.get(id).body.mass(),0);if(mass<=0)throw Error('У свободной сборки должна быть положительная масса.');for(const id of ids)loads.set(id,sub(loads.get(id),mul(total,this.entities.get(id).body.mass()/mass)));roots.add(ids[0]);}
   const phi=potential(ids,edges,loads,roots);for(const b of edges){b.lastForceN=Math.hypot(...sub(phi.get(b.a),phi.get(b.b)));b.peakForceN=Math.max(b.peakForceN,b.lastForceN);}
  }
  const broken=[];
  // Evaluate every threshold against the SAME intact graph before any removal.
  for(const b of intact)if(b.lastForceN>b.thresholdN){
   const ba=this.entities.get(b.a).body,bb=this.entities.get(b.b).body,position=mul(add(arr(ba.translation()),arr(bb.translation())),.5);
   this.world.removeImpulseJoint(b.joint,true);b.broken=true;b.brokenAt=time;
   const event={type:'bond-break',assemblyId:b.assemblyId,bondId:b.id,bodies:[b.a,b.b],time,position,loadModel:BREAKABLE_LOAD_MODEL,estimatedForceN:b.lastForceN,thresholdN:b.thresholdN,measuredEndpointContactImpulseNs:((contactMagnitude.get(b.a)||0)+(contactMagnitude.get(b.b)||0))*dt,material:b.material};broken.push(event);this.events.push(event);
  }
  return broken;
 }
 snapshot(){return{loadModel:BREAKABLE_LOAD_MODEL,total:this.bonds.length,broken:this.bonds.filter(b=>b.broken).length,retired:this.bonds.filter(b=>b.retired).length,bonds:this.bonds.map(b=>({id:b.id,assemblyId:b.assemblyId,a:b.a,b:b.b,broken:b.broken,retired:b.retired,brokenAt:b.brokenAt??null,lastForceN:b.lastForceN,peakForceN:b.peakForceN,thresholdN:b.thresholdN})),events:structuredClone(this.events)};}
 dispose(){if(this.disposed)return;for(const b of this.bonds)if(!b.broken&&b.joint.isValid())this.world.removeImpulseJoint(b.joint,true);for(const{c,events,threshold}of this.changedColliders){if(c.isValid()){c.setActiveEvents(events);c.setContactForceEventThreshold(threshold);}}this.disposed=true;}
}
