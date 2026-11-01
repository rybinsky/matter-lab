import RAPIER from '@dimforge/rapier3d-compat';
import {MaterialPenetration} from './penetration.js';

const vec=(a)=>({x:a[0],y:a[1],z:a[2]});
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const n=Math.hypot(...v);if(n<1e-10)throw Error('Направление проникновения не может быть нулевым.');return v.map(x=>x/n);};
const finiteVector=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000);
export const PENETRATION_CAVITY_BINS=64;
const PROFILE_STEP=.05,HALF_CIRCLE_SEGMENTS=20;
const GEOMETRY_APPROXIMATION='Локальные осевые ячейки эквивалентного объёма: боковое плавление распределяется по смоченной длине цилиндра. Это приближение формы канала, не решение 3D-теплопроводности, течения воды или трещин.';

export function validatePenetrationScene(spec){
 if(spec===undefined||spec===null)return null;
 if(typeof spec!=='object'||Array.isArray(spec))throw Error('Некорректная модель проникновения.');
 for(const key of ['projectileId','targetId'])if(typeof spec[key]!=='string'||!spec[key].trim()||spec[key].length>160)throw Error('Укажите снаряд и образец для проникновения.');
 if(spec.projectileId===spec.targetId)throw Error('Снаряд и образец должны быть разными предметами.');
 if(!finiteVector(spec.entry)||!finiteVector(spec.axis))throw Error('Задайте конечные координаты входа и направления.');
 unit(spec.axis);
 const model=new MaterialPenetration(spec.parameters),lead=spec.leadDistance??0;
 if(!Number.isFinite(lead)||lead<0||lead>100)throw Error('Расстояние до образца: от 0 до 100 м.');
 const clock=spec.clock||[{time:0,elapsed:0},{time:20,elapsed:20}];
 if(!Array.isArray(clock)||clock.length<2||clock.length>64)throw Error('Шкала опыта: от 2 до 64 точек.');
 let time=-1,elapsed=-1;
 for(const point of clock){if(!Number.isFinite(point.time)||point.time<0||point.time>20||point.time<=time||!Number.isFinite(point.elapsed)||point.elapsed<0||point.elapsed>7200||point.elapsed<elapsed)throw Error('Время опыта должно возрастать, физическое время — не убывать.');time=point.time;elapsed=point.elapsed;}
 if(clock[0].time!==0||clock[0].elapsed!==0)throw Error('Шкала проникновения должна начинаться с нуля.');
 if(model.parameters.integration.maxThermalStep<.01||model.parameters.integration.maxThermalStep>1)throw Error('Тепловой шаг: от 0,01 до 1 физической секунды.');
 return spec;
}

export function physicalTimeAt(clock,time){
 if(time<=0)return 0;
 for(let i=1;i<clock.length;i++)if(time<=clock[i].time){const a=clock[i-1],b=clock[i];return a.elapsed+(b.elapsed-a.elapsed)*(time-a.time)/(b.time-a.time);}
 return clock.at(-1).elapsed;
}

// Average contact overlap for a linearly moving finite cylinder. Knots are
// precisely where a cylinder end crosses a bin end; between them overlap is
// linear, so the trapezoid integral is exact for this substep approximation.
function sweptOverlap(a,b,length,d0,d1){
 const overlap=d=>Math.max(0,Math.min(b,d)-Math.max(a,d-length,0));
 if(Math.abs(d1-d0)<1e-14)return overlap((d0+d1)/2);
 const lo=Math.min(d0,d1),hi=Math.max(d0,d1),knots=[lo,hi,...[a,b,a+length,b+length].filter(d=>d>lo&&d<hi)].sort((a,b)=>a-b);let integral=0;
 for(let i=1;i<knots.length;i++)integral+=(overlap(knots[i-1])+overlap(knots[i]))/2*(knots[i]-knots[i-1]);
 return integral/(hi-lo);
}

function cavityGeometry({entry,axis,size,profile,depth}){
 const vertices=[],indices=[],half=size/2,d=Math.min(size,Math.max(0,depth)),segments=HALF_CIRCLE_SEGMENTS;
 const up=axis.map(x=>-x),x=unit(cross(up,Math.abs(up[2])<.9?[0,0,1]:[0,1,0])),z=unit(cross(x,up));
 const vertex=p=>{const index=vertices.length/3;vertices.push(...entry.map((v,i)=>v+x[i]*p[0]-up[i]*p[1]+z[i]*p[2]));return index;};
 const quad=(a,b,c,e)=>indices.push(a,b,c,a,c,e),levels=[],dz=size/profile.length;
 // Two rows per bin preserve its exact constant-radius volume. A fixed extra
 // pair locates the actual front without rounding depth to a bin boundary.
 // Shared row vertices keep this finer profile smaller than the old mesh.
 const slot=Math.min(profile.length,Math.floor(d/dz)),frontRadius=d>0?profile[Math.min(profile.length-1,Math.ceil(d/dz)-1)].renderRadius:0;
 for(let i=0;i<profile.length;i++){
  const a=i*dz,b=(i+1)*dz,r=a<d?profile[i].renderRadius:0;
  if(i===slot&&d===a)levels.push({u:d,rad:frontRadius},{u:d,rad:0});
  levels.push({u:a,rad:r});
  if(i===slot&&d>a&&d<b)levels.push({u:d,rad:r},{u:d,rad:0});
  levels.push({u:b,rad:b<=d?r:0});
 }
 if(slot===profile.length)levels.push({u:d,rad:frontRadius},{u:d,rad:frontRadius});
 const rows=levels.map(({u,rad})=>({outer:[[-half,u,0],[-half,u,-half],[half,u,-half],[half,u,0]].map(vertex),arc:Array.from({length:segments+1},(_,k)=>{const a=Math.PI+k/segments*Math.PI;return vertex([rad*Math.cos(a),u,rad*Math.sin(a)]);})}));
 for(let j=0;j<levels.length-1;j++){
  const a=rows[j],b=rows[j+1];quad(a.outer[0],b.outer[0],b.arc[0],a.arc[0]);quad(a.arc[segments],b.arc[segments],b.outer[3],a.outer[3]);
  quad(a.outer[1],a.outer[2],b.outer[2],b.outer[1]);quad(a.outer[0],a.outer[1],b.outer[1],b.outer[0]);quad(a.outer[2],a.outer[3],b.outer[3],b.outer[2]);
  for(let k=0;k<segments;k++)quad(a.arc[k],b.arc[k],b.arc[k+1],a.arc[k+1]);
 }
 for(const [u,row,top]of [[0,rows[0],true],[size,rows.at(-1),false]]){
  const outer=Array.from({length:segments+1},(_,k)=>{const a=Math.PI+k/segments*Math.PI,r=half/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)));return vertex([r*Math.cos(a),u,r*Math.sin(a)]);});
  for(let k=0;k<segments;k++)if(top)quad(row.arc[k],row.arc[k+1],outer[k+1],outer[k]);else quad(row.arc[k],outer[k],outer[k+1],row.arc[k+1]);
 }
 return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}

/** Adapter for a documented 1D material model; it does not impersonate 3D damage. */
export class PenetrationScene{
 constructor(lab,spec){
  validatePenetrationScene(spec);this.lab=lab;this.spec=structuredClone(spec);this.axis=unit(spec.axis);this.entry=spec.entry.slice();this.clock=structuredClone(spec.clock||[{time:0,elapsed:0},{time:20,elapsed:20}]);
  const projectile=lab.find(spec.projectileId),target=lab.find(spec.targetId);
  if(!projectile?.body||!target?.body||!target.fixed||projectile.fixed||projectile.kinematic)throw Error('Для проникновения нужны свободный твёрдый снаряд и закреплённый образец.');
  const parameters=structuredClone(spec.parameters||{});parameters.projectile={...parameters.projectile,mass:projectile.body.mass()};parameters.gravity=dot([0,-lab.settings.gravity,0],this.axis);
  this.model=new MaterialPenetration(parameters);this.projectile=projectile;this.target=target;this.sideMeltBins=new Float64Array(PENETRATION_CAVITY_BINS);this.profileSubsteps=0;
  this.lead=spec.leadDistance??0;const speed=this.model.parameters.initialSpeed,g=this.model.parameters.gravity,preSpeedSquared=speed*speed-2*g*this.lead;
  if(this.lead&&preSpeedSquared<=0)throw Error('Для входа в образец не хватает начальной скорости.');
  this.preSpeed=Math.sqrt(Math.max(0,preSpeedSquared));this.flightTime=this.lead?2*this.lead/(this.preSpeed+speed):0;
  projectile.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);projectile.kinematic=true;projectile.phenomenonRole='penetration';
  for(const collider of projectile.colliders)collider.setEnabled(false);
  target.renderHidden=true;target.phenomenonRole='penetration-target';
  const {radius,length}=this.model.parameters.projectile,s=projectile.scale||1;
  projectile.parts=[{shape:'cylinder',d:[radius/s,length/s],p:[0,0,0]}];
  // The accent bands are flush: no decorative solid may extend into a bore
  // whose resistance and geometry use the stated projectile radius.
  projectile.visualParts=[...projectile.parts.map(p=>({...p,color:'#89959F',roughness:.31,metalness:.88})),...[-.32,.32].map(y=>({shape:'cylinder',d:[radius/s,length*.05/s],p:[0,y*length/s,0],color:'#CFD7DD',roughness:.25,metalness:.9}))];
  const up=this.axis.map(x=>-x),qv=cross([0,1,0],up),qw=1+up[1],norm=Math.hypot(...qv,qw);
  const q=norm<1e-8?{x:1,y:0,z:0,w:0}:{x:qv[0]/norm,y:qv[1]/norm,z:qv[2]/norm,w:qw/norm};projectile.body.setRotation(q,true);
  const cutUp=this.axis.map(x=>-x),cutX=unit(cross(cutUp,Math.abs(cutUp[2])<.9?[0,0,1]:[0,1,0])),cutNormal=unit(cross(cutX,cutUp));
  this.surface={cutPlane:{point:this.entry.slice(),normal:cutNormal},id:target.id,name:target.name,material:'ice',kind:'penetration-cutaway',geometryApproximation:GEOMETRY_APPROXIMATION,color:'#A8D4E3',appearance:{roughness:.18,metalness:.025},geometry:()=>{
   const state=this.model.snapshot();return cavityGeometry({entry:this.entry,axis:this.axis,size:this.model.parameters.target.thickness,profile:this.sideMeltProfile().bins,depth:state.frontDepth});
  }};
  lab.surfaces.push(this.surface);this.worldTime=0;this.update(0);
 }
 update(worldTime){
  const elapsed=physicalTimeAt(this.clock,worldTime);if(elapsed+1e-10<this.worldTime)throw Error('Перемотка проникновения требует пересоздания мира.');
  const modelTime=Math.max(0,elapsed-this.flightTime);this.advanceModel(modelTime);
  this.worldTime=elapsed;const state=this.snapshot(),length=this.model.parameters.projectile.length;
  this.projectile.body.setTranslation(vec(this.entry.map((x,i)=>x+this.axis[i]*(state.tipDepth-length/2))),true);
 }
 advanceModel(end){
  const p=this.model.parameters,dz=p.target.thickness/this.sideMeltBins.length;
  while(this.model.elapsed<end){
   const before=this.model.snapshot(),remaining=end-this.model.elapsed;
   // The dynamics/heat law is unchanged. Small physical steps only localize
   // its incremental side heat instead of spreading it along the old hole.
   const localizing=!before.passed&&before.temperature>p.target.meltTemperature&&p.target.sideHeatTransfer>0;
   let dt=remaining;
   if(localizing){
    dt=Math.min(dt,PROFILE_STEP,p.integration.maxThermalStep);
    if(before.phase==='impact'){
     const travel=dz/4,a=Math.max(0,p.gravity),v=before.velocity,bound=a>0?2*travel/(v+Math.sqrt(v*v+2*a*travel)):v>0?travel/v:Infinity;dt=Math.min(dt,bound);
    }
   }
   const after=this.model.step(dt),delta=after.sideMeltedMass-before.sideMeltedMass;
   if(delta>0){
    const weights=Array.from(this.sideMeltBins,(_,i)=>sweptOverlap(i*dz,(i+1)*dz,p.projectile.length,before.depth,after.depth)),total=weights.reduce((s,v)=>s+v,0);
    if(!(total>0))throw Error('Боковое тепло не имеет смоченного участка снаряда.');
    let assigned=0,last=-1;for(let i=0;i<weights.length;i++)if(weights[i]>0){const mass=delta*weights[i]/total;this.sideMeltBins[i]+=mass;assigned+=mass;last=i;}
    // Remove floating-point normalization drift without moving mass outside
    // the actual swept contact interval.
    if(last>=0)this.sideMeltBins[last]+=delta-assigned;
   }
   this.profileSubsteps++;
  }
 }
 sideMeltProfile(){
  const p=this.model.parameters,depth=this.model.frontDepth,dz=p.target.thickness/this.sideMeltBins.length,base=p.projectile.radius,limit=p.target.thickness*.475,density=p.target.density;
  const bins=Array.from(this.sideMeltBins,(mass,i)=>{const start=i*dz,end=(i+1)*dz,openLength=Math.max(0,Math.min(end,depth)-start),radius=openLength>0?Math.sqrt(base*base+mass/(density*Math.PI*openLength)):base,renderRadius=Math.min(limit,radius),renderedSideMass=openLength*Math.PI*Math.max(0,renderRadius*renderRadius-base*base)*density;return{start,end,openLength,sideMeltedMass:mass,radius,renderRadius,renderedSideMass};});
  return{approximation:GEOMETRY_APPROXIMATION,binCount:bins.length,binWidth:dz,sideMeltedMass:bins.reduce((s,b)=>s+b.sideMeltedMass,0),renderClippedSideMass:bins.reduce((s,b)=>s+Math.max(0,b.sideMeltedMass-b.renderedSideMass),0),bins};
 }
 snapshot(){
  const s=this.model.snapshot(),flight=this.worldTime<this.flightTime,g=this.model.parameters.gravity,profile=this.sideMeltProfile();
  return{...s,elapsed:this.worldTime,modelElapsed:s.elapsed,phase:flight?'flight':s.phase,tipDepth:flight?-this.lead+this.preSpeed*this.worldTime+.5*g*this.worldTime*this.worldTime:s.depth,projectileId:this.projectile.id,targetId:this.target.id,radius:this.model.parameters.projectile.radius,length:this.model.parameters.projectile.length,entry:this.entry.slice(),axis:this.axis.slice(),flightTime:this.flightTime,cavityGeometryApproximation:GEOMETRY_APPROXIMATION,cavitySideMeltedMass:profile.sideMeltedMass,cavityRenderClippedSideMass:profile.renderClippedSideMass};
 }
}
