/** Uniform gas around declared closed rigid volumes, in SI units.
 *
 * settings.atmosphere = {enabled:true, density:kg/m³, wind:[m/s,m/s,m/s]}.
 * When wind is omitted, LabWorld's legacy windSpeed becomes [windSpeed,0,0].
 * A declared buoyancy body uses this one atmosphere drag route, never both
 * it and the old volume-estimated wind force. Other bodies retain old wind.
 * object.buoyancy = {volume:m³, center:[m,m,m], dragCoefficient:1,
 *                    referenceArea:m², enabled?:boolean}.
 * Volume/area are the actual, AFTER-scale values supplied by the author.
 * Center is in the body's local metre coordinates AFTER geometry scaling.
 * Changing scale does not silently change these physical inputs.
 *
 * F_b = -rho V g is added temporarily at the declared displacement centre,
 * then only that force/torque is subtracted. Rapier integrates it jointly with
 * gravity; an early whole buoyancy impulse would give neutral bodies a false
 * position drift under this solver's internal gravity integration.
 * Quadratic relative-air drag uses symmetric energy-stable half impulses around
 * the rigid solver, with the point's translational/rotational effective mass.
 * It never resets existing forces, accumulates its own between steps, or clamps
 * velocities to an invented cap.
 * Drag splitting is symmetric; the underlying rigid position solver still
 * needs timestep-convergence checks for each scene.
 *
 * Boundaries: uniform constant-density air/gas, constant rigid envelope and Cd,
 * no liquid submergence, atmosphere stratification, gas expansion, leaks,
 * wake shielding, added mass or turbulent fluid simulation. Gas and envelope
 * masses belong in the ordinary object's ACTUAL total mass; V does not supply
 * helium, change its mass, or make an unsealed prop an inflated balloon.
 */
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,-1e6,1e6));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=m=>{throw Error('Атмосфера: '+m);};
const arr=v=>[v.x,v.y,v.z],vec=a=>({x:a[0],y:a[1],z:a[2]}),add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotate=(v,q)=>add(v,add(mul(cross([q.x,q.y,q.z],v),2*q.w),mul(cross([q.x,q.y,q.z],cross([q.x,q.y,q.z],v)),2)));

export function normalizeAtmosphere(input){
 if(input===undefined||input===null)return{enabled:false,density:1.204,wind:[0,0,0]};
 if(!object(input)||Object.keys(input).some(k=>!['enabled','density','wind'].includes(k)))fail('неизвестные настройки газа.');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('enabled должно быть включено или выключено.');
 const density=input.density??1.204,wind=input.wind??[0,0,0];
 if(!finite(density,0,1000)||!vector(wind))fail('плотность: 0–1000 кг/м³; ветер: три конечные скорости.');
 return{enabled:input.enabled!==false,density,wind:wind.slice()};
}
export function normalizeBuoyancy(input){
 if(input===undefined||input===null)return null;
 if(!object(input)||Object.keys(input).some(k=>!['enabled','volume','center','dragCoefficient','referenceArea'].includes(k)))fail('неизвестные параметры вытесненного объёма.');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('включение объёма должно быть логическим.');
 const volume=input.volume,center=input.center??[0,0,0],dragCoefficient=input.dragCoefficient??0,referenceArea=input.referenceArea??0;
 if(!finite(volume,0,1e12)||!vector(center)||!finite(dragCoefficient,0,1000)||!finite(referenceArea,0,1e10)||dragCoefficient>0&&referenceArea<=0)fail('задайте объём в м³, локальный центр в м, Cd ≥ 0 и площадь > 0 при включённом сопротивлении.');
 return{enabled:input.enabled!==false,volume,center:center.slice(),dragCoefficient,referenceArea};
}
export function archimedesForce(density,volume,gravity){return mul(gravity,-density*volume);}

/** Exact scalar quadratic-drag impulse along the current slip direction.
 * inverseEffectiveMass = nᵀ M_point⁻¹ n, including locked DOFs and rotation.
 * J <= |u| / inverseEffectiveMass, so ΔK_air = -J|u| + J²M⁻¹/2 <= 0.
 * Uniform wind can supply world-frame energy; dissipation is relative to air.
 */
export function quadraticDragImpulse({velocity,wind,density,dragCoefficient,referenceArea,inverseEffectiveMass,dt}){
 const slip=sub(velocity,wind),speed=Math.hypot(...slip),k=.5*density*dragCoefficient*referenceArea;
 if(speed===0||k===0||inverseEffectiveMass<=0)return{impulse:[0,0,0],relativeEnergyChange:0};
 const magnitude=k*speed*speed*dt/(1+k*speed*dt*inverseEffectiveMass);
 return{impulse:mul(slip,-magnitude/speed),relativeEnergyChange:-magnitude*speed+.5*magnitude*magnitude*inverseEffectiveMass};
}
function effectiveInverseMass(body,point,direction){
 const inv=arr(body.effectiveInvMass()),r=sub(point,arr(body.worldCom())),angular=cross(r,direction),m=body.effectiveWorldInvInertia();
 const rotation=[m.m11*angular[0]+m.m12*angular[1]+m.m13*angular[2],m.m21*angular[0]+m.m22*angular[1]+m.m23*angular[2],m.m31*angular[0]+m.m32*angular[1]+m.m33*angular[2]];
 return direction.reduce((s,v,i)=>s+v*v*inv[i],0)+dot(angular,rotation);
}

export class UniformAtmosphere{
 constructor({world,getEntities,settings,legacyWindSpeed=0}){this.world=world;this.getEntities=getEntities;this.inheritsLegacyWind=!!settings&&settings.wind===undefined;this.settings=normalizeAtmosphere(settings===undefined||settings===null?settings:{...settings,...(settings.wind===undefined?{wind:[legacyWindSpeed,0,0]}:{})});this.buoyantForces=new Map();this.dragForces=new Map();this.ownedForces=[];this.lastDragEnergy=0;this.dt=null;}
 setLegacyWindSpeed(speed){if(this.inheritsLegacyWind){if(!finite(speed,-1e6,1e6))fail('скорость ветра должна быть конечной, в м/с.');this.settings.wind=[speed,0,0];}}
 ownsAerodynamics(entity){return this.settings.enabled&&!!entity.spec?.buoyancy&&entity.spec.buoyancy.enabled!==false;}
 eligible(){return this.getEntities().filter(e=>e.body?.isValid()&&e.body.isDynamic()&&e.body.isEnabled()&&e.spec?.buoyancy&&e.spec.buoyancy.enabled!==false);}
 point(entity,config){return add(arr(entity.body.translation()),rotate(config.center,entity.body.rotation()));}
 beforeStep(dt){
  if(this.dt!==null)fail('предыдущая собственная сила ещё не снята: вызовите afterStep.');if(!finite(dt,1e-6,1))fail('шаг: от 0,000001 до 1 с.');this.dt=dt;this.buoyantForces.clear();this.dragForces.clear();this.ownedForces=[];this.lastDragEnergy=0;if(!this.settings.enabled)return;
  this.applyDrag(dt/2,dt);
  const gravity=arr(this.world.gravity);
  for(const e of this.eligible()){
   const config=normalizeBuoyancy(e.spec.buoyancy),force=archimedesForce(this.settings.density,config.volume,gravity),point=this.point(e,config),previousForce=arr(e.body.userForce()),previousTorque=arr(e.body.userTorque());e.body.addForceAtPoint(vec(force),vec(point),true);
   // Record the actual f32 solver additions, including its own point/COM
   // rounding. Recomputing a theoretical torque drifts after many rotations.
   const combinedForce=arr(e.body.userForce()),combinedTorque=arr(e.body.userTorque());this.ownedForces.push({body:e.body,force:sub(combinedForce,previousForce),torque:sub(combinedTorque,previousTorque)});this.buoyantForces.set(e.id,force);
  }
 }
 afterStep(dt){
  if(this.dt===null||dt!==this.dt)fail('вызовите beforeStep с тем же шагом.');this.dt=null;
  // Subtract the recorded WORLD torque directly: the body's centre may have
  // moved/rotated, so a new opposite addForceAtPoint would not cancel it.
  for(const{body,force,torque}of this.ownedForces)if(body.isValid()){
   const expectedForce=sub(arr(body.userForce()),force),expectedTorque=sub(arr(body.userTorque()),torque);body.addForce(vec(mul(force,-1)),false);body.addTorque(vec(mul(torque,-1)),false);
   // Compensate subtraction rounding only. Additions made by another caller
   // between the two hooks are retained in expectedForce/expectedTorque.
   body.addForce(vec(sub(expectedForce,arr(body.userForce()))),false);body.addTorque(vec(sub(expectedTorque,arr(body.userTorque()))),false);
  }this.ownedForces=[];if(!this.settings.enabled)return;
  this.applyDrag(dt/2,dt);
 }
 applyDrag(step,fullStep){
  for(const e of this.eligible()){
   const config=normalizeBuoyancy(e.spec.buoyancy);if(config.dragCoefficient===0)continue;const point=this.point(e,config),velocity=arr(e.body.velocityAtPoint(vec(point))),slip=sub(velocity,this.settings.wind),speed=Math.hypot(...slip);if(speed===0)continue;
   const inverseEffectiveMass=effectiveInverseMass(e.body,point,mul(slip,1/speed)),drag=quadraticDragImpulse({velocity,wind:this.settings.wind,density:this.settings.density,dragCoefficient:config.dragCoefficient,referenceArea:config.referenceArea,inverseEffectiveMass,dt:step});
   e.body.applyImpulseAtPoint(vec(drag.impulse),vec(point),true);this.dragForces.set(e.id,add(this.dragForces.get(e.id)||[0,0,0],mul(drag.impulse,1/fullStep)));this.lastDragEnergy+=drag.relativeEnergyChange;
  }
 }
 snapshot(){return{model:'uniform-gas-archimedes-quadratic-drag',enabled:this.settings.enabled,density:this.settings.density,wind:this.settings.wind.slice(),activeVolumes:this.buoyantForces.size,dragRelativeEnergyChange:this.lastDragEnergy};}
}
