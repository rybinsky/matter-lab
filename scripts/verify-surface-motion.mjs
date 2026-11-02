import assert from 'node:assert/strict';
import {SurfaceMotion,normalizeSurfaceMotion,surfaceProfile} from '../src/surface-motion.js';

const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b} by more than ${tolerance}`);
const base={body:'runner',origin:[0,0,0],mass:70,gravity:9.81,surface:{kind:'cone',slope:2/3,minRadius:.05,rimRadius:4.2},initial:{radius:1.1,azimuth:0,upslopeSpeed:0,azimuthSpeed:Math.sqrt(9.81*(2/3)*1.1)},drive:{enabled:true,targetSpeed:3,response:.25,lateralDamping:1/.65,friction:.65,maxForce:280,maxPower:1400},maxStep:1/120};
const fresh=()=>structuredClone(base);
function run(config,{hz=240,seconds=20,stopAtRelease=true}={}){
  const model=new SurfaceMotion(config),initial=model.snapshot();let maxResidual=0,maxTraction=0,maxForce=0,maxPower=0,maxL=0,maxRadius=initial.radius;
  for(let i=0;i<Math.round(seconds*hz);i++){
    const s=model.step(1/hz);maxResidual=Math.max(maxResidual,Math.abs(s.energyResidual));maxTraction=Math.max(maxTraction,s.tractionUse);maxForce=Math.max(maxForce,Math.hypot(s.slopeForce,s.azimuthForce));maxPower=Math.max(maxPower,s.propulsionPower);maxL=Math.max(maxL,Math.abs(s.angularMomentumY-initial.angularMomentumY));maxRadius=Math.max(maxRadius,s.radius);
    assert.ok(s.normalForce>=0);assert.ok(s.lateralHeat>=-1e-8);assert.ok(s.brakeHeat>=-1e-8);assert.ok(s.driveWork>=-1e-8);
    if(stopAtRelease&&s.release)break;
  }
  return{model,initial,final:model.snapshot(),maxResidual,maxTraction,maxForce,maxPower,maxL,maxRadius};
}
const checks=[];function check(label,fn){fn();checks.push(label);console.log(`PASS ${label}`);}

check('Cone geometry, paraboloid and analytic polynomial derivatives',()=>{
  const cone=normalizeSurfaceMotion(fresh()).surface;close(surfaceProfile(cone,4.2).height,2.8);close(surfaceProfile(cone,2).secondDerivative,0);
  const p=surfaceProfile({kind:'polynomial',coefficients:[1,2,3,4]},.7);close(p.height,1+2*.7+3*.7**2+4*.7**3);close(p.slope,2+6*.7+12*.7**2);close(p.secondDerivative,6+24*.7);
  const b=surfaceProfile({kind:'paraboloid',curvature:.2,offset:1},2);close(b.height,1.8);close(b.slope,.8);close(b.secondDerivative,.4);
});
check('Authoring input is not mutated and snapshots cannot edit physical state',()=>{
  const config=fresh(),before=JSON.stringify(config),model=new SurfaceMotion(config),s=model.snapshot();s.position[0]=999;s.velocity[0]=999;assert.equal(JSON.stringify(config),before);close(model.position()[0],1.1);close(model.velocity()[0],0);assert.equal(s.model,'axisymmetric-driven-point-mass');
});
check('Invalid domains and nonfinite or negative physical settings fail',()=>{
  for(const patch of[{mass:0},{gravity:-1},{maxStep:0},{origin:[0,1]},{initial:{radius:5}},{surface:{kind:'unknown'}},{surface:{kind:'cone',rimRadius:.01,minRadius:.02}},{drive:{enabled:'yes'}},{drive:{friction:-1}},{drive:{response:0}},{surface:{kind:'polynomial',coefficients:[NaN]}}])assert.throws(()=>new SurfaceMotion({...fresh(),...patch}));
  const model=new SurfaceMotion(fresh());assert.throws(()=>model.step(-1));assert.throws(()=>model.step(NaN));
});
check('Frictionless circular cone orbit preserves energy, vertical L and radius',()=>{
  const config=fresh();config.drive.enabled=false;const r=run(config);close(r.final.radius,config.initial.radius,1e-10);close(r.final.azimuthSpeed,config.initial.azimuthSpeed,1e-10);assert.ok(r.maxResidual<1e-8);assert.ok(r.maxL<1e-8);assert.equal(r.final.phase,'contact');
});
check('Unpowered noncircular cone motion obeys analytic energy escape threshold',()=>{
  const config=fresh();config.drive.enabled=false;const R=config.surface.rimRadius,r0=config.initial.radius,k=config.surface.slope,vCritical=Math.sqrt(2*config.gravity*k*R*R/(R+r0));
  const below=structuredClone(config);below.initial.azimuthSpeed=.97*vCritical;const low=run(below);assert.equal(low.final.phase,'contact');assert.ok(low.maxRadius<R);assert.ok(low.maxL<1e-5);assert.ok(low.maxResidual<1e-3);
  const above=structuredClone(config);above.initial.azimuthSpeed=1.03*vCritical;const high=run(above);assert.equal(high.final.release.reason,'outer-edge');assert.ok(high.final.release.upslopeSpeed>0);assert.ok(high.maxL<1e-5);assert.ok(high.maxResidual<1e-3);
});
const threeRegimes=[];
check('Three powered targets yield two distinct stationary heights and a genuine edge crossing',()=>{
  for(const targetSpeed of[3,4.4,6.6]){
    const pair=[];for(const hz of[120,240]){const config=fresh();config.drive.targetSpeed=targetSpeed;const r=run(config,{hz});assert.ok(r.maxResidual<.001);assert.ok(r.maxTraction<=1+1e-12);assert.ok(r.maxForce<=config.drive.maxForce+1e-8);assert.ok(r.maxPower<=config.drive.maxPower+1e-8);pair.push(r);threeRegimes.push({targetSpeed,hz,phase:r.final.phase,radius:r.final.radius,height:r.final.height,azimuthSpeed:r.final.azimuthSpeed,release:r.final.release,maxEnergyResidual:r.maxResidual,maxTraction:r.maxTraction,maxForce:r.maxForce,maxPower:r.maxPower});}
    if(targetSpeed<6){for(const r of pair){assert.equal(r.final.phase,'contact');close(r.final.radius,targetSpeed**2/(base.gravity*base.surface.slope),1e-5);}}
    else{for(const r of pair)assert.equal(r.final.release.reason,'outer-edge');close(pair[0].final.release.time,pair[1].final.release.time,1e-6);close(pair[0].final.release.azimuthSpeed,pair[1].final.release.azimuthSpeed,1e-5);}
  }
});
check('Friction and positive propulsion power are real shared caps',()=>{
  const traction=fresh();traction.drive.targetSpeed=20;traction.drive.friction=.03;traction.drive.maxForce=1e5;traction.drive.maxPower=1e8;const a=run(traction,{seconds:2});assert.ok(a.maxTraction>.999999);assert.ok(a.maxTraction<=1+1e-12);assert.ok(a.maxResidual<.001);
  const power=fresh();power.drive.targetSpeed=20;power.drive.maxPower=20;const b=run(power,{seconds:2});close(b.maxPower,20,1e-8);assert.ok(b.maxTraction<=1+1e-12);assert.ok(b.maxResidual<.001);
});
check('Curved surfaces include meridional normal acceleration and permit natural contact loss',()=>{
  const parabola=fresh();parabola.drive.enabled=false;parabola.surface={kind:'paraboloid',curvature:.15,offset:0,minRadius:.05,rimRadius:6};parabola.initial={radius:2,azimuth:0,upslopeSpeed:0,azimuthSpeed:2*Math.sqrt(2*9.81*.15)};
  const orbit=run(parabola,{seconds:5});close(orbit.final.radius,2,1e-9);assert.ok(orbit.maxResidual<1e-7);assert.ok(orbit.maxL<1e-7);
  const convex=fresh();convex.drive.enabled=false;convex.surface={kind:'polynomial',coefficients:[0,0,0,0,-.1],minRadius:.05,rimRadius:10};convex.initial={radius:.5,azimuth:0,upslopeSpeed:1,azimuthSpeed:0};const released=run(convex,{seconds:3});assert.equal(released.final.release.reason,'support-lost');assert.ok(released.final.release.time>0);assert.ok(released.maxResidual<.001);
});
check('Release preserves velocity; ballistic motion is exact and all contact drives turn off',()=>{
  const config=fresh();config.drive.targetSpeed=6.6;const model=new SurfaceMotion(config);while(model.phase==='contact')model.step(1/240);
  const before=model.snapshot(),dt=.173,after=model.step(dt);for(let i=0;i<3;i++){close(after.position[i],before.position[i]+before.velocity[i]*dt-(i===1?.5*config.gravity*dt*dt:0),1e-10);close(after.velocity[i],before.velocity[i]-(i===1?config.gravity*dt:0),1e-10);}close(after.energy,before.energy,1e-7);close(after.angularMomentumY,before.angularMomentumY,1e-7);assert.equal(after.normalForce,0);assert.equal(after.azimuthForce,0);assert.equal(after.slopeForce,0);close(after.driveWork,before.driveWork,0);close(after.lateralHeat,before.lateralHeat,0);
  const release=before.release,timeAfter=before.time-release.time;for(let i=0;i<3;i++)close(before.velocity[i],release.velocity[i]-(i===1?config.gravity*timeAfter:0),1e-8);
});
check('Inner free edge and initially unsupported states also release without invented impulses',()=>{
  const inner=fresh();inner.drive.enabled=false;inner.initial={radius:.1,azimuth:0,upslopeSpeed:-1,azimuthSpeed:0};const a=run(inner,{seconds:1});assert.equal(a.final.release.reason,'inner-edge');
  const unsupported=fresh();unsupported.drive.enabled=false;unsupported.surface={kind:'paraboloid',curvature:-.5,offset:0,minRadius:.05,rimRadius:10};unsupported.initial={radius:.5,azimuth:0,upslopeSpeed:10,azimuthSpeed:0};const b=new SurfaceMotion(unsupported);assert.equal(b.phase,'ballistic');close(b.release.time,0);const c=surfaceProfile(b.config.surface,.5);close(b.velocity()[0],10*c.cosBeta);close(b.velocity()[1],10*c.sinBeta);
});
console.log(JSON.stringify({checks:checks.length,threeRegimes},null,2));
