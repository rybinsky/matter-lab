// Independent, parameterized phenomena. Presets supply parameters, not animation.
export const PLANETS={moon:{name:'Луна',mu:4.902800118e12,radius:1737400},earth:{name:'Земля',mu:3.986004418e14,radius:6371000},mars:{name:'Марс',mu:4.282837e13,radius:3389500}};
export class CentralGravity {
 constructor(settings){this.settings=settings;this.planet=PLANETS[settings.planet||'moon'];this.unit=500000;this.elapsed=0;this.trail=[];this.status='flight';const radius=this.planet.radius+(settings.altitude??100000);this.p=[radius,0,0];this.v=[0,settings.speed??1633.504,0];this.initialSpeed=Math.hypot(...this.v);this.timer=0;this.trail.push(this.p.map(x=>x/this.unit));}
 acceleration(p){const r=Math.hypot(...p),factor=-this.planet.mu/(r*r*r);return p.map(x=>x*factor);}
 step(dt){if(this.status==='impact')return;const total=dt*(this.settings.timeScale||1000),steps=Math.ceil(total/2),h=total/steps;
  for(let i=0;i<steps;i++){const a=this.acceleration(this.p),next=this.p.map((x,j)=>x+this.v[j]*h+.5*a[j]*h*h),b=this.acceleration(next);this.v=this.v.map((x,j)=>x+.5*(a[j]+b[j])*h);this.p=next;this.elapsed+=h;const r=Math.hypot(...this.p);if(r<=this.planet.radius){this.p=this.p.map(x=>x*this.planet.radius/r);this.status='impact';break;}if(r>this.planet.radius*8)this.status='escape';}
  this.timer+=dt;if(this.timer>.025){this.trail.push(this.p.map(x=>x/this.unit));if(this.trail.length>360)this.trail.shift();this.timer=0;}
 }
 snapshot(){return{altitude:Math.max(0,Math.hypot(...this.p)-this.planet.radius),speed:Math.hypot(...this.v),elapsed:this.elapsed,status:this.status,initialSpeed:this.initialSpeed,planetRadius:this.planet.radius,circularSpeed:Math.sqrt(this.planet.mu/(this.planet.radius+(this.settings.altitude??100000)))};}
 position(){return this.p.map(x=>x/this.unit);}
 geometry(){
  const vertices=[],indices=[],segments=360,sides=6,points=this.trail;
  for(let i=0;i<=segments;i++){const p=points[Math.min(i,points.length-1)]||[0,0,0];for(let j=0;j<sides;j++){const a=j/sides*Math.PI*2;vertices.push(p[0]+Math.cos(a)*.013,p[1]+Math.sin(a)*.013,p[2]);}}
  for(let i=0;i<segments;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides,c=(i+1)*sides+j,d=(i+1)*sides+(j+1)%sides;indices.push(a,c,b,b,c,d);}
  return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
 }
}

export class HeatPenetration {
 constructor(settings){this.settings=settings;this.mass=settings.mass||1;this.r=Math.cbrt(3*this.mass/(4*Math.PI*7850));this.temperature=settings.temperature||1000;this.initialTemperature=this.temperature;this.iceTemperature=settings.iceTemperature??-10;this.height=settings.iceHeight||.7;this.base=.22;this.heatCapacity=600;this.latent=334000;this.iceCapacity=2090;this.iceDensity=917;this.contactH=settings.contactH||1000;this.energy=0;this.loss=0;this.depth=0;this.elapsed=0;this.time=0;this.passed=false;this.y=this.base+this.height+this.r+.2;}
 step(dt){this.time+=dt;const release=.4,fall=Math.sqrt(.4/9.81);if(this.time<release)return;if(this.time<release+fall){this.y=this.base+this.height+this.r+.2-.5*9.81*(this.time-release)**2;return;}
  const thermalDt=dt*(this.settings.thermalTimeScale||40);this.elapsed+=thermalDt;
  const contactFraction=.18+.82*Math.min(1,this.depth/this.r);
  const area=2*Math.PI*this.r*this.r*contactFraction;
  const exposed=4*Math.PI*this.r*this.r*Math.max(0,1-this.depth/(2*this.r));
  const contactPower=this.passed?0:this.contactH*area*Math.max(0,this.temperature);
  const airPower=15*exposed*Math.max(0,this.temperature-20);
  const radiative=.7*5.670374419e-8*exposed*Math.max(0,(this.temperature+273.15)**4-293.15**4);
  const available=this.mass*this.heatCapacity*Math.max(0,this.temperature);
  const total=Math.min(available,(contactPower+airPower+radiative)*thermalDt);
  const ratio=contactPower/Math.max(1,contactPower+airPower+radiative);this.energy+=total*ratio;this.loss+=total*(1-ratio);this.temperature=Math.max(0,this.temperature-total/(this.mass*this.heatCapacity));
  const meltV=this.energy/(this.iceDensity*(this.latent+this.iceCapacity*(-Math.min(0,this.iceTemperature))));
  const hemisphere=2/3*Math.PI*this.r**3;
  if(meltV>=hemisphere)this.depth=meltV/(Math.PI*this.r**2)+this.r/3;
  else{let lo=0,hi=this.r;for(let i=0;i<35;i++){const d=(lo+hi)/2,v=Math.PI*d*d*(this.r-d/3);if(v<meltV)lo=d;else hi=d;}this.depth=(lo+hi)/2;}
  if(this.depth>this.height+2*this.r)this.passed=true;
  this.y=Math.max(this.r+.025,this.base+this.height+this.r-this.depth);
 }
 snapshot(){return{depth:Math.min(this.height,this.depth),temperature:this.temperature,elapsed:this.elapsed,mass:this.mass,radius:this.r,energy:this.energy,loss:this.loss,passed:this.passed,contactH:this.contactH};}
 geometry(){
  const verts=[],ix=[];const H=this.height,base=this.base,w=.35,r=this.r,d=Math.min(this.depth,H+2*r);
  const quad=(a,b,c,e)=>{const n=verts.length/3;verts.push(...a,...b,...c,...e);ix.push(n,n+1,n+2,n,n+2,n+3);};
  const cavity=u=>{if(u>d)return 0;const dy=u+r-d;return dy<=0?r:Math.sqrt(Math.max(0,r*r-dy*dy));};
  // The front half is cut away to expose depth. The remaining half is a real
  // mesh with the cavity derived from the same melted-volume calculation.
  quad([-w,base,-w],[w,base,-w],[w,base+H,-w],[-w,base+H,-w]);
  quad([-w,base,0],[-w,base,-w],[-w,base+H,-w],[-w,base+H,0]);
  quad([w,base,-w],[w,base,0],[w,base+H,0],[w,base+H,-w]);
  quad([-w,base,0],[w,base,0],[w,base,-w],[-w,base,-w]);
  const rows=48,sides=24;
  // Keep the same vertex count while resolving the spherical melt front.
  // A uniform 14.6 mm strip is larger than many heated spheres; extending it
  // past d creates a visible cone underneath the actual sphere. Include the
  // exact tip and sample its hemisphere by angle, including very small radii.
  const levels=Array.from({length:rows+1},(_,j)=>j/rows*H);
  for(let j=0;j<=12;j++)levels.push(Math.max(0,Math.min(H,d-r+r*Math.sin(j/12*Math.PI/2))));
  levels.sort((a,b)=>a-b);
  for(let j=0;j<levels.length-1;j++){const u0=levels[j],u1=levels[j+1],y0=base+H-u0,y1=base+H-u1,rr0=cavity(u0),rr1=cavity(u1);
   quad([-w,y1,0],[-rr1,y1,0],[-rr0,y0,0],[-w,y0,0]);quad([rr1,y1,0],[w,y1,0],[w,y0,0],[rr0,y0,0]);
   for(let k=0;k<sides;k++){const a=Math.PI+k/sides*Math.PI,b=Math.PI+(k+1)/sides*Math.PI;quad([rr0*Math.cos(a),y0,rr0*Math.sin(a)],[rr1*Math.cos(a),y1,rr1*Math.sin(a)],[rr1*Math.cos(b),y1,rr1*Math.sin(b)],[rr0*Math.cos(b),y0,rr0*Math.sin(b)]);}
  }
  const topR=cavity(0);for(let k=0;k<sides;k++){const a=Math.PI+k/sides*Math.PI,b=Math.PI+(k+1)/sides*Math.PI,ra=w/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a))),rb=w/Math.max(Math.abs(Math.cos(b)),Math.abs(Math.sin(b)));quad([topR*Math.cos(a),base+H,topR*Math.sin(a)],[ra*Math.cos(a),base+H,ra*Math.sin(a)],[rb*Math.cos(b),base+H,rb*Math.sin(b)],[topR*Math.cos(b),base+H,topR*Math.sin(b)]);}
  return{vertices:new Float32Array(verts),indices:new Uint32Array(ix)};
 }
}
