import {normalizeConnectionVisual} from './connection-visuals.js';

/** Massless, tension-only Kelvin–Voigt cables between ordinary rigid anchors.
 * a is a body id; b defaults to the reserved literal 'world'. Body anchors are
 * local METRES relative to body translation, after any authored geometry scale;
 * a world anchor is already a world point. Point velocity uses COM velocity and
 * angular velocity. Fixed/kinematic endpoints can drive a cable but take no
 * impulse. This is an elastic force model, not an ideal rope constraint, cable
 * self-weight/catenary, FEM, plasticity, fatigue or calibrated material failure.
 *
 * beforeStep(dt,time) samples every cable BEFORE any of its impulses, validates
 * the complete step, then applies equal/opposite T*dt point impulses. Other
 * user forces/torques are never reset or accumulated. Run exactly once before
 * each world.step of the same dt; this module does not advance Rapier itself.
 * Explicit impulses give a first-order semi-implicit discretization. The
 * connected-component bound dt²Σ(k*q)+2dtΣ(c*q)<4 is conservative for the frozen
 * AXIAL linearized spring/damper modes; q includes real point rotational
 * mobility. It is not a global stability theorem for arbitrary fast rotation,
 * changing directions, contact coupling or nonlinear large-deformation motion.
 * Those scenes require ordinary timestep convergence checks. No dt, tension,
 * velocity or initial conditions are silently clamped to make a take succeed.
 */
const fail=message=>{throw Error('Упругие тросы: '+message);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=160&&!/[\u0000-\u001f\u007f]/.test(x);
const arr=v=>[v.x,v.y,v.z],vec=a=>({x:a[0],y:a[1],z:a[2]}),add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotate=(v,q)=>add(v,add(mul(cross([q.x,q.y,q.z],v),2*q.w),mul(cross([q.x,q.y,q.z],cross([q.x,q.y,q.z],v)),2)));
function point(value,name){if(!Array.isArray(value)||value.length!==3||value.some(x=>!finite(x,-1e6,1e6)))fail(`${name}: нужны три конечные координаты в метрах.`);return value.slice();}

export function normalizeElasticCables(value){
 if(value===undefined)return[];
 if(!Array.isArray(value)||value.length>64)fail('нужен массив не более 64 тросов.');
 const ids=new Set();return value.map(input=>{
  if(!object(input)||Object.keys(input).some(k=>!['id','a','b','anchorA','anchorB','restLength','stiffness','damping','breakForce','visual'].includes(k)))fail('неизвестные настройки троса.');
  if(!id(input.id)||ids.has(input.id))fail('идентификаторы тросов должны быть непустыми и уникальными.');ids.add(input.id);
  const b=input.b===undefined?'world':input.b,damping=input.damping??0;
  if(!id(input.a)||input.a==='world'||!id(b)||input.a===b)fail('a — предмет, b — другой предмет или world.');
  if(!finite(input.restLength,Number.MIN_VALUE,1e6)||!finite(input.stiffness,Number.MIN_VALUE,1e12)||!finite(damping,0,1e12))fail('длина покоя и жёсткость должны быть положительными; затухание — неотрицательным.');
  if(input.breakForce!==undefined&&!finite(input.breakForce,Number.MIN_VALUE,1e15))fail('порог разрыва должен быть положительным, в ньютонах.');
  return{id:input.id,a:input.a,b,anchorA:point(input.anchorA??[0,0,0],'anchorA'),anchorB:point(input.anchorB??[0,0,0],'anchorB'),restLength:input.restLength,stiffness:input.stiffness,damping,...(input.breakForce===undefined?{}:{breakForce:input.breakForce}),visual:normalizeConnectionVisual(input.visual)};
 });
}

/** Positive separatingSpeed means the two anchors move apart. */
export function elasticCableResponse({length,restLength,stiffness,damping=0,separatingSpeed=0}){
 if(!finite(length,0,1e12)||!finite(restLength,Number.MIN_VALUE,1e6)||!finite(stiffness,Number.MIN_VALUE,1e12)||!finite(damping,0,1e12)||!finite(separatingSpeed,-1e12,1e12))fail('некорректное состояние закона натяжения.');
 const extension=Math.max(0,length-restLength),springTension=stiffness*extension,dampingTension=extension>0?damping*separatingSpeed:0,tension=extension>0?Math.max(0,springTension+dampingTension):0;
 return{length,extension,separatingSpeed,springTension,dampingTension,tension,potentialEnergy:.5*stiffness*extension*extension};
}
function inversePointMass(body,position,direction){
 if(!body?.isDynamic())return 0;
 const inv=arr(body.effectiveInvMass()),r=sub(position,arr(body.worldCom())),angular=cross(r,direction),m=body.effectiveWorldInvInertia(),turned=[m.m11*angular[0]+m.m12*angular[1]+m.m13*angular[2],m.m21*angular[0]+m.m22*angular[1]+m.m23*angular[2],m.m31*angular[0]+m.m32*angular[1]+m.m33*angular[2]],q=direction.reduce((sum,v,i)=>sum+v*v*inv[i],0)+dot(angular,turned);
 if(!Number.isFinite(q)||q< -1e-8)fail('у точки крепления некорректная эффективная масса.');return Math.max(0,q);
}
const movable=body=>body?.isDynamic()===true;
function endpoint(body,local){
 if(!body)return{position:local.slice(),velocity:[0,0,0]};
 const position=add(arr(body.translation()),rotate(local,body.rotation())),velocity=body.isFixed()?[0,0,0]:add(arr(body.linvel()),cross(arr(body.angvel()),sub(position,arr(body.worldCom()))));
 if([...position,...velocity].some(x=>!Number.isFinite(x)))fail('положение или скорость крепления не конечны.');return{position,velocity};
}

export class ElasticCables{
 constructor({world,getEntity,cables,stepSeconds=1/120}){
  if(!world||typeof getEntity!=='function'||!finite(stepSeconds,1e-8,1))fail('нужны физический мир, поиск предмета и шаг от 0,00000001 до 1 с.');
  if(getEntity('world'))fail('world зарезервирован для неподвижного мирового крепления.');
  this.world=world;this.getEntity=getEntity;this.specs=normalizeElasticCables(cables);this.stepSeconds=stepSeconds;this.events=[];this.time=0;this.sampleTime=null;this.disposed=false;
  const bodyFor=id=>{if(id==='world')return null;const e=getEntity(id),b=e?.body;if(!b||e.soft||!b.isValid()||!b.isEnabled())fail(`предмет «${id}» должен быть доступным обычным твёрдым телом.`);return b;};
  this.entries=this.specs.map(spec=>({spec,bodyA:bodyFor(spec.a),bodyB:bodyFor(spec.b),status:'active',record:null}));
  const plans=this.entries.map(e=>this.measure(e,0));this.lastStabilityRatio=this.stability(plans,stepSeconds,true);
  for(const p of plans)p.entry.record=this.record(p,{appliedTension:0,impulse:[0,0,0]});
 }
 unavailable(entry){for(const[which,key]of [['a','bodyA'],['b','bodyB']]){if(entry.spec[which]==='world')continue;const body=entry[key];if(!body.isValid()||!body.isEnabled()||this.getEntity(entry.spec[which])?.body!==body)return true;}return false;}
 measure(entry,time){
  const a=endpoint(entry.bodyA,entry.spec.anchorA),b=endpoint(entry.bodyB,entry.spec.anchorB),delta=sub(b.position,a.position),length=norm(delta),direction=length>0?mul(delta,1/length):[1,0,0],speed=dot(sub(b.velocity,a.velocity),direction),response=elasticCableResponse({...entry.spec,length,separatingSpeed:speed}),inverseEffectiveMass=inversePointMass(entry.bodyA,a.position,direction)+inversePointMass(entry.bodyB,b.position,direction);
  return{entry,time,a,b,direction,...response,inverseEffectiveMass,willBreak:entry.spec.breakForce!==undefined&&response.tension>=entry.spec.breakForce};
 }
 /** Trace bound per connected dynamic component, not a sum over independent
  * cables that merely happen to share a fixed support. Damping is in the bound.
  */
 stability(plans,dt,initial=false){
  const parent=new Map(),find=x=>{if(!parent.has(x))parent.set(x,x);let root=x;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(x)!==x){const next=parent.get(x);parent.set(x,root);x=next;}return root;},join=(a,b)=>{const aa=find(a),bb=find(b);if(aa!==bb)parent.set(bb,aa);},active=plans.filter(p=>initial||p.extension>0&&!p.willBreak);
  for(const p of active){const bodies=[p.entry.bodyA,p.entry.bodyB].filter(movable);if(bodies.length===2)join(bodies[0],bodies[1]);else bodies.forEach(find);}
  const groups=new Map();for(const p of active){const body=[p.entry.bodyA,p.entry.bodyB].find(movable);if(!body)continue;const root=find(body),g=groups.get(root)||{stiffness:0,damping:0,ids:[]};g.stiffness+=p.entry.spec.stiffness*p.inverseEffectiveMass;g.damping+=p.entry.spec.damping*p.inverseEffectiveMass;g.ids.push(p.entry.spec.id);groups.set(root,g);}
  let ratio=0;for(const g of groups.values()){
   const current=dt*dt*g.stiffness+2*dt*g.damping;ratio=Math.max(ratio,current/4);
   if(!(current<4)){const critical=4/(g.damping+Math.sqrt(g.damping*g.damping+4*g.stiffness));fail(`шаг ${dt.toPrecision(5)}с превышает осевой линейный предел <${critical.toPrecision(5)}с для ${g.ids.join(', ')}; уменьшите шаг, жёсткость или затухание.`);}
  }return ratio;
 }
 record(plan,{appliedTension=0,impulse=[0,0,0]}={}){
  const e=plan.entry,old=e.record,broken=e.status==='broken',retired=e.status==='retired';
  return{id:e.spec.id,a:e.spec.a,b:e.spec.b,status:e.status,broken,retired,sampleTime:plan.time,pointA:plan.a.position.slice(),pointB:plan.b.position.slice(),velocityA:plan.a.velocity.slice(),velocityB:plan.b.velocity.slice(),direction:plan.direction.slice(),length:plan.length,extension:plan.extension,separatingSpeed:plan.separatingSpeed,springTension:plan.springTension,dampingTension:plan.dampingTension,computedTension:plan.tension,tension:broken||retired?0:plan.tension,appliedTension,forceA:mul(plan.direction,appliedTension),forceB:mul(plan.direction,-appliedTension),impulseA:impulse.slice(),impulseB:mul(impulse,-1),potentialEnergy:broken||retired?0:plan.potentialEnergy,inverseEffectiveMass:plan.inverseEffectiveMass,peakTension:Math.max(old?.peakTension||0,plan.tension),...(old?.breakTime===undefined?{}:{breakTime:old.breakTime}),...(old?.breakingTension===undefined?{}:{breakingTension:old.breakingTension}),...(old?.retireTime===undefined?{}:{retireTime:old.retireTime})};
 }
 beforeStep(dt,time=this.time){
  if(this.disposed)fail('модель уже удалена.');if(!finite(dt,1e-8,1)||!finite(time,0,1e12)||this.sampleTime!==null&&time<this.sampleTime-1e-9)fail('нужен положительный шаг и неубывающее физическое время; для перемотки пересоздайте модель.');
  // All plans use the same untouched pre-step velocities: no cable-order bias.
  const active=this.entries.filter(e=>e.status==='active'),retired=active.filter(e=>this.unavailable(e)),plans=active.filter(e=>!retired.includes(e)).map(e=>this.measure(e,time));
  const stabilityRatio=this.stability(plans,dt); // No mutations/impulses on failure.
  for(const e of retired)this.retire(e,time,'endpoint-removed-replaced-or-disabled');
  for(const p of plans){const e=p.entry;if(p.willBreak){e.status='broken';e.record=this.record(p);e.record.breakTime=time;e.record.breakingTension=p.tension;this.events.push({type:'elastic-cable-break',id:e.spec.id,time,tension:p.tension,extension:p.extension,length:p.length,elasticEnergyRemoved:p.potentialEnergy,pointA:p.a.position.slice(),pointB:p.b.position.slice()});}else e.record=this.record(p,{appliedTension:p.tension,impulse:mul(p.direction,p.tension*dt)});}
  for(const p of plans){if(p.entry.status!=='active'||p.tension===0)continue;const j=mul(p.direction,p.tension*dt);if(movable(p.entry.bodyA))p.entry.bodyA.applyImpulseAtPoint(vec(j),vec(p.a.position),true);if(movable(p.entry.bodyB))p.entry.bodyB.applyImpulseAtPoint(vec(mul(j,-1)),vec(p.b.position),true);}
  this.sampleTime=time;this.lastStepSeconds=dt;this.time=time+dt;this.lastStabilityRatio=stabilityRatio;return this.snapshot();
 }
 retire(entry,time,reason){if(entry.status!=='active')return;entry.status='retired';entry.record={...entry.record,status:'retired',retired:true,tension:0,appliedTension:0,forceA:[0,0,0],forceB:[0,0,0],impulseA:[0,0,0],impulseB:[0,0,0],potentialEnergy:0,retireTime:time};this.events.push({type:'elastic-cable-retire',id:entry.spec.id,time,reason});}
 retireBody(id,time=this.time){if(this.disposed)return;if(!finite(time,0,1e12))fail('время удаления должно быть конечным.');for(const entry of this.entries)if(entry.spec.a===id||entry.spec.b===id)this.retire(entry,time,'body-retired');}
 /** Live endpoints for a render-only cable. Reading them never applies force. */
 anchors(id){const e=this.entries.find(e=>e.spec.id===id);if(!e||e.status==='retired'||this.unavailable(e))return null;return[endpoint(e.bodyA,e.spec.anchorA).position,endpoint(e.bodyB,e.spec.anchorB).position];}
 snapshot(){return{model:'massless-tension-only-kelvin-voigt-cables',sampleTime:this.sampleTime,stepSeconds:this.lastStepSeconds??this.stepSeconds,nominalStepSeconds:this.stepSeconds,stabilityRatio:this.lastStabilityRatio??0,forceSampling:'pre-world-step',cables:this.entries.map(e=>structuredClone(e.record)),limitations:['Massless tension-only elastic cable; no exact inextensible rope constraint,catenary self-weight,FEM,fatigue or calibrated real failure.','Explicit point impulses; the reported bound covers frozen axial linearized modes,not all nonlinear/contact/fast-rotation stability.','Tension/anchors are sampled before the last world step; live anchors() is read-only.','Rupture removes the stored elastic energy without an extra recoil impulse; cable fragments,vibration and fracture-energy partition are not resolved.']};}
 dispose(){this.disposed=true;this.entries=[];this.specs=[];this.world=null;this.getEntity=()=>null;}
}
