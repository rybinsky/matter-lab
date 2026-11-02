/**
 * A driven point mass on a static axisymmetric y=h(r) surface.
 * This is a constrained mechanics model, not a gait or arbitrary-body solver.
 * Contact is unilateral; a free edge or N<0 releases the unchanged velocity.
 * The ballistic phase does not reacquire surfaces or solve later collisions.
 */
const finite=(value,name,{min=-Infinity,max=Infinity,exclusiveMin=false}={})=>{
  if(!Number.isFinite(value)||(exclusiveMin?value<=min:value<min)||value>max)throw new Error(`Surface motion: invalid ${name}.`);
  return value;
};
const vec=(value,name)=>{
  if(!Array.isArray(value)||value.length!==3)throw new Error(`Surface motion: ${name} requires three coordinates.`);
  return value.map(x=>finite(x,name,{min:-1e6,max:1e6}));
};
const copy=value=>structuredClone(value);

export function normalizeSurfaceMotion(value={}){
  const source=value.surface||{},kind=source.kind||'cone',surface={kind,minRadius:finite(source.minRadius??.05,'minRadius',{min:0,max:1e4,exclusiveMin:true}),rimRadius:finite(source.rimRadius??4.2,'rimRadius',{min:0,max:1e4,exclusiveMin:true})};
  if(surface.rimRadius<=surface.minRadius)throw new Error('Surface motion: rimRadius must exceed minRadius.');
  if(kind==='cone'){surface.slope=finite(source.slope??2/3,'slope',{min:-1000,max:1000});surface.offset=finite(source.offset??0,'offset');}
  else if(kind==='paraboloid'){surface.curvature=finite(source.curvature??.1,'curvature',{min:-1000,max:1000});surface.offset=finite(source.offset??0,'offset');}
  else if(kind==='polynomial'){
    if(!Array.isArray(source.coefficients)||source.coefficients.length<1||source.coefficients.length>7)throw new Error('Surface motion: polynomial requires 1–7 coefficients in increasing power order.');
    surface.coefficients=source.coefficients.map(x=>finite(x,'polynomial coefficient',{min:-1e6,max:1e6}));
  }else throw new Error('Surface motion: unknown surface kind.');
  const initial=value.initial||{},drive=value.drive||{};
  if(drive.enabled!==undefined&&typeof drive.enabled!=='boolean')throw new Error('Surface motion: drive.enabled must be boolean.');
  if(value.body!==undefined&&(typeof value.body!=='string'||!value.body.trim()))throw new Error('Surface motion: body must be a nonempty identifier.');
  const config={body:value.body??'surface-body',origin:vec(value.origin??[0,0,0],'origin'),mass:finite(value.mass??70,'mass',{min:0,max:1e9,exclusiveMin:true}),gravity:finite(value.gravity??9.81,'gravity',{min:0,max:1000}),surface,initial:{radius:finite(initial.radius??1.1,'initial radius',{min:surface.minRadius,max:surface.rimRadius}),azimuth:finite(initial.azimuth??0,'azimuth'),upslopeSpeed:finite(initial.upslopeSpeed??0,'upslope speed',{min:-1000,max:1000}),azimuthSpeed:finite(initial.azimuthSpeed??0,'azimuth speed',{min:-1000,max:1000})},drive:{enabled:drive.enabled??false,targetSpeed:finite(drive.targetSpeed??0,'target speed',{min:-1000,max:1000}),response:finite(drive.response??.25,'response',{min:1e-5,max:1000,exclusiveMin:true}),lateralDamping:finite(drive.lateralDamping??0,'lateral damping',{min:0,max:1e4}),friction:finite(drive.friction??.6,'friction',{min:0,max:10}),maxForce:finite(drive.maxForce??280,'max force',{min:0,max:1e10}),maxPower:finite(drive.maxPower??1400,'max power',{min:0,max:1e12})},maxStep:finite(value.maxStep??1/120,'max step',{min:0,max:.05,exclusiveMin:true})};
  for(const r of[surface.minRadius,config.initial.radius,surface.rimRadius])for(const item of Object.values(surfaceProfile(surface,r)))finite(item,'surface profile');
  return config;
}

/** beta is measured above horizontal; positive slope rises outwards. */
export function surfaceProfile(surface,r){
  let height,slope,secondDerivative;
  if(surface.kind==='cone'){height=surface.offset+surface.slope*r;slope=surface.slope;secondDerivative=0;}
  else if(surface.kind==='paraboloid'){height=surface.offset+surface.curvature*r*r;slope=2*surface.curvature*r;secondDerivative=2*surface.curvature;}
  else if(surface.kind==='polynomial'){
    const a=surface.coefficients;height=0;slope=0;secondDerivative=0;
    for(let i=a.length-1;i>=0;i--){height=height*r+a[i];if(i>=1)slope=slope*r+i*a[i];if(i>=2)secondDerivative=secondDerivative*r+i*(i-1)*a[i];}
  }else throw new Error('Surface motion: unknown surface kind.');
  const cosBeta=1/Math.sqrt(1+slope*slope),sinBeta=slope*cosBeta;
  return{height,slope,secondDerivative,cosBeta,sinBeta,meridionalCurvature:secondDerivative*cosBeta**3};
}

function forces(state,config){
  const[r,u,v]=state,p=surfaceProfile(config.surface,r),normal=config.mass*(config.gravity*p.cosBeta+p.sinBeta*v*v/r+p.meridionalCurvature*u*u),d=config.drive;
  let slopeForce=d.enabled?-config.mass*d.lateralDamping*u:0,azimuthForce=d.enabled?config.mass*(d.targetSpeed-v)/d.response:0;
  const tractionCapacity=d.friction*Math.max(0,normal),forceCapacity=Math.min(d.maxForce,tractionCapacity),requested=Math.hypot(slopeForce,azimuthForce);
  if(requested>forceCapacity){slopeForce*=forceCapacity/requested;azimuthForce*=forceCapacity/requested;}
  const requestedPower=Math.max(0,azimuthForce*v);
  if(requestedPower>d.maxPower)azimuthForce*=d.maxPower/requestedPower;
  return{...p,normal,slopeForce,azimuthForce,tractionCapacity,tractionUse:tractionCapacity>0?Math.hypot(slopeForce,azimuthForce)/tractionCapacity:0,propulsionPower:Math.max(0,azimuthForce*v)};
}
function derivative(state,config){
  const[r,u,v]=state,f=forces(state,config),power=f.azimuthForce*v;
  return[f.cosBeta*u,f.cosBeta*v*v/r-config.gravity*f.sinBeta+f.slopeForce/config.mass,f.azimuthForce/config.mass-f.cosBeta*u*v/r,v/r,Math.max(0,power),-f.slopeForce*u,Math.max(0,-power)];
}
function rk4(state,dt,config){
  const a=derivative(state,config),b=derivative(state.map((x,i)=>x+dt*a[i]/2),config),c=derivative(state.map((x,i)=>x+dt*b[i]/2),config),d=derivative(state.map((x,i)=>x+dt*c[i]),config);
  return state.map((x,i)=>x+dt*(a[i]+2*b[i]+2*c[i]+d[i])/6);
}
function contactWorld(state,config){
  const[r,u,v,phi]=state,p=surfaceProfile(config.surface,r),co=Math.cos(phi),si=Math.sin(phi),o=config.origin;
  return{position:[o[0]+r*co,o[1]+p.height,o[2]-r*si],velocity:[p.cosBeta*u*co-v*si,p.sinBeta*u,-p.cosBeta*u*si-v*co],normal:[-p.sinBeta*co,p.cosBeta,p.sinBeta*si]};
}

export class SurfaceMotion {
  constructor(value={}){
    this.config=normalizeSurfaceMotion(value);const i=this.config.initial;
    this._state=[i.radius,i.upslopeSpeed,i.azimuthSpeed,i.azimuth,0,0,0];this.time=0;this.phase='contact';this.release=null;this._ballistic=null;
    const w=contactWorld(this._state,this.config);this._initialEnergy=this.config.mass*(w.velocity.reduce((s,x)=>s+x*x,0)/2+this.config.gravity*w.position[1]);
    if(forces(this._state,this.config).normal<0)this._release('support-lost');
  }
  _release(reason){
    const w=contactWorld(this._state,this.config);this.phase='ballistic';this._ballistic={position:w.position.slice(),velocity:w.velocity.slice()};
    this.release={reason,time:this.time,position:w.position.slice(),velocity:w.velocity.slice(),radius:this._state[0],upslopeSpeed:this._state[1],azimuthSpeed:this._state[2]};
  }
  _fly(dt){const b=this._ballistic,g=this.config.gravity;for(let i=0;i<3;i++)b.position[i]+=b.velocity[i]*dt-(i===1?.5*g*dt*dt:0);b.velocity[1]-=g*dt;this.time+=dt;}
  step(dt){
    finite(dt,'dt',{min:0,max:60});let remaining=dt,iterations=0;
    while(remaining>1e-14){
      if(++iterations>1e6)throw new Error('Surface motion: too many integration steps.');
      if(this.phase==='ballistic'){this._fly(remaining);remaining=0;break;}
      const state=this._state,s=this.config.surface,d=derivative(state,this.config),radialRate=d[0],radialAcceleration=Math.abs(d[1]*surfaceProfile(s,state[0]).cosBeta);
      // Keep all RK stages away from the cylindrical-coordinate singularity.
      const safeStep=.2*state[0]/(Math.abs(radialRate)+Math.sqrt(radialAcceleration*state[0])+1e-12),h=Math.min(remaining,this.config.maxStep,safeStep),next=rk4(state,h,this.config),events=[];
      const tests=[['outer-edge',a=>a[0]-s.rimRadius],['inner-edge',a=>s.minRadius-a[0]],['support-lost',a=>-forces(a,this.config).normal]];
      for(const[reason,test]of tests)if(test(next)>=(reason==='support-lost'?1e-10:0)){
        let lo=0,hi=h;for(let j=0;j<42;j++){const mid=(lo+hi)/2;if(test(rk4(state,mid,this.config))>=0)hi=mid;else lo=mid;}
        events.push({reason,dt:(lo+hi)/2});
      }
      if(events.length){events.sort((a,b)=>a.dt-b.dt);const event=events[0];this._state=rk4(state,event.dt,this.config);this.time+=event.dt;remaining-=event.dt;this._release(event.reason);}
      else{this._state=next;this.time+=h;remaining-=h;}
    }
    return this.snapshot();
  }
  position(){return(this.phase==='contact'?contactWorld(this._state,this.config).position:this._ballistic.position).slice();}
  velocity(){return(this.phase==='contact'?contactWorld(this._state,this.config).velocity:this._ballistic.velocity).slice();}
  snapshot(){
    const c=this.config,position=this.position(),velocity=this.velocity(),x=position[0]-c.origin[0],z=position[2]-c.origin[2],radius=Math.hypot(x,z),kinetic=c.mass*velocity.reduce((s,v)=>s+v*v,0)/2,potential=c.mass*c.gravity*position[1],f=this.phase==='contact'?forces(this._state,c):null,driveWork=this._state[4],lateralHeat=this._state[5],brakeHeat=this._state[6],netWork=driveWork-lateralHeat-brakeHeat,energy=kinetic+potential;
    return{model:'axisymmetric-driven-point-mass',phase:this.phase,time:this.time,body:c.body,position,velocity,radius,height:position[1]-c.origin[1],upslopeSpeed:this.phase==='contact'?this._state[1]:null,radialSpeed:radius>0?(x*velocity[0]+z*velocity[2])/radius:0,azimuthSpeed:radius>0?(z*velocity[0]-x*velocity[2])/radius:0,normalForce:Math.max(0,f?.normal??0),normal:f?contactWorld(this._state,c).normal:null,slopeForce:f?.slopeForce??0,azimuthForce:f?.azimuthForce??0,tractionCapacity:f?.tractionCapacity??0,tractionUse:f?.tractionUse??0,propulsionPower:f?.propulsionPower??0,kinetic,potential,energy,initialEnergy:this._initialEnergy,driveWork,lateralHeat,brakeHeat,netWork,energyResidual:energy-this._initialEnergy-netWork,angularMomentumY:c.mass*(z*velocity[0]-x*velocity[2]),release:this.release?copy(this.release):null,limitations:['Point mass on a static y=h(r) surface; no gait, finite body shape or balance dynamics.','The active contact drive and lateral brake share one Coulomb traction budget.','Ballistic motion has no later collision detection or surface reacquisition.']};
  }
}
