import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor,assetParts} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
import {archimedesForce,normalizeAtmosphere,normalizeBuoyancy,quadraticDragImpulse} from '../src/atmosphere.js';
const R=await initializePhysics(),g=9.81,report={domain:'Uniform constant-density gas, rigid closed envelopes, authored gas/envelope/rigid masses, authored Cd; ideal massless no-stretch ropes. No atmospheric layering, wakes, fluid pressure field or balloon deformation. Numerical/analytic checks are not a real chair-lift experiment.',tests:[],chair:[]};
const near=(a,b,tol,label)=>assert(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b}`),V=r=>4/3*Math.PI*r**3,A=r=>Math.PI*r*r;
const ball=(mass,extra={})=>({id:'float',asset:'ball',scale:.6,mass,position:[0,10,0],linearDamping:0,angularDamping:0,buoyancy:{volume:V(.3),center:[0,0,0],dragCoefficient:0,referenceArea:A(.3)},...extra});
const settings=extra=>({...settingsFor('blank'),atmosphere:{enabled:true,density:1.2,wind:[0,0,0]},...extra});
const run=(objects,config=settings(),seconds=2,dt=1/120)=>{const lab=new LabWorld(config,objects);try{for(let i=0;i<Math.round(seconds/dt);i++)lab.step(dt);const e=lab.find(objects[0].id),p=e.body.translation(),v=e.body.linvel();return{p:[p.x,p.y,p.z],v:[v.x,v.y,v.z],mass:e.body.mass(),readouts:lab.stats().readouts};}finally{lab.dispose();}};

assert.deepEqual(archimedesForce(1.2,3,[1,-g,2]),[-3.5999999999999996,35.315999999999995,-7.199999999999999]);
for(const bad of [{density:-1},{wind:[0,NaN,0]},{unknown:true}])assert.throws(()=>normalizeAtmosphere(bad));for(const bad of [{volume:-1},{volume:1,dragCoefficient:1,referenceArea:0},{volume:1,center:[0,0]}])assert.throws(()=>normalizeBuoyancy(bad));
const displaced=1.2*V(.3);
for(const ratio of [.99,1,1.01]){
 const a=run([ball(displaced*ratio)]),b=run([ball(displaced*ratio)],settings(),2,1/240),acceleration=(displaced/a.mass-1)*g;
 near(a.v[1],acceleration*2,2e-5,'Archimedes isolated velocity');near(a.p[1],10+.5*acceleration*4,.002,'Archimedes isolated position');near(a.v[1],b.v[1],2e-5,'120/240 isolated velocity');near(a.p[1],b.p[1],.001,'120/240 isolated position');if(ratio===1)near(a.p[1],10,3e-5,'Neutral volume does not secretly levitate or sink');
 report.tests.push({test:'isolated float threshold',massRatio:ratio,displacedAirMass:displaced,actualMass:a.mass,analyticAcceleration:acceleration,at120:a,at240:b});
}
{
 const object=ball(displaced,{buoyancy:{volume:V(.3),center:[0,0,0],dragCoefficient:.47,referenceArea:A(.3)}}),a=run([object],settings(),30,1/120),b=run([object],settings(),30,1/240);near(a.p[1],10,2e-4,'Long neutral control has no false ascent');near(b.p[1],10,2e-4,'Long neutral control at240');report.tests.push({test:'30-second neutral body with drag; no levitation drift',at120:a,at240:b});
}
// Drag alone has an independent exact scalar solution, including a zero-volume
// object for which only authored aerodynamic drag is requested.
{
 const r=.3,mass=1,speed=10,k=.5*1.2*.47*A(r),object=ball(mass,{velocity:[speed,0,0],buoyancy:{volume:0,center:[0,0,0],dragCoefficient:.47,referenceArea:A(r)}}),a=run([object],settings({gravity:0}),2),b=run([object],settings({gravity:0}),2,1/240),expected=speed/(1+k/mass*speed*2);
 near(a.v[0],expected,2e-5,'Exact quadratic deceleration');near(b.v[0],expected,2e-5,'Exact quadratic deceleration at240');assert(a.v[0]>0);report.tests.push({test:'quadratic drag analytic solution',expected,actual120:a.v[0],actual240:b.v[0]});
 for(const dt of [.001,.1,1]){const result=quadraticDragImpulse({velocity:[100,0,0],wind:[0,0,0],density:100,dragCoefficient:100,referenceArea:10,inverseEffectiveMass:1000,dt});assert(result.relativeEnergyChange<=0);assert(100+result.impulse[0]*1000>=-1e-9,'Stable drag must not reverse the slip velocity');}
}
// Uniform wind is an external energy supply; it decreases slip energy even
// while accelerating a stationary object in the world frame.
{
 const a=run([ball(1,{buoyancy:{volume:0,dragCoefficient:.47,referenceArea:A(.3)}})],settings({gravity:0,atmosphere:{density:1.2,wind:[5,0,0]}}),2);assert(a.v[0]>0&&a.v[0]<5);report.tests.push({test:'wind-relative drag',velocity:a.v});
}
{
 const mass=.031,object=ball(mass,{buoyancy:{volume:V(.3),center:[0,0,0],dragCoefficient:.47,referenceArea:A(.3)}}),a=run([object],settings(),2,1/120),b=run([object],settings(),2,1/240),acceleration=(displaced/a.mass-1)*g,drag=.5*1.2*.47*A(.3)/a.mass,terminal=Math.sqrt(acceleration/drag),expected=terminal*Math.tanh(Math.sqrt(acceleration*drag)*2);
 near(a.v[1],expected,.003,'Analytic buoyant terminal velocity at120');near(b.v[1],expected,.003,'Analytic buoyant terminal velocity at240');assert(Math.abs(b.v[1]-expected)<=Math.abs(a.v[1]-expected)+1e-6,'Terminal velocity converges with timestep');report.tests.push({test:'Buoyancy plus drag terminal velocity',expected,actual120:a.v[1],actual240:b.v[1]});
}
{
 const lab=new LabWorld(settings({gravity:0}),[ball(1)]);try{const body=lab.find('float').body;body.addForce({x:.3,y:.2,z:-.1},true);for(let i=0;i<120;i++)lab.step();for(const[k,v]of Object.entries({x:.3,y:.2,z:-.1}))near(body.userForce()[k],v,1e-6,'Existing userForce is preserved');near(body.linvel().x,.3,2e-5,'Existing persistent force is not erased');report.tests.push({test:'No force accumulation or erasure',userForce:body.userForce()});}finally{lab.dispose();}
}
{
 const lab=new LabWorld(settings(),[ball(displaced,{buoyancy:{volume:V(.3),center:[.03,.02,0],dragCoefficient:0}})]);try{const body=lab.find('float').body;body.addForce({x:.03,y:.02,z:-.01},true);body.addTorque({x:.001,y:.002,z:.003},true);for(let i=0;i<1200;i++){lab.step();for(const[k,v]of Object.entries({x:.03,y:.02,z:-.01}))near(body.userForce()[k],v,2e-6,'Foreign userForce survives real nonzero buoyancy');for(const[k,v]of Object.entries({x:.001,y:.002,z:.003}))near(body.userTorque()[k],v,2e-6,'Recorded buoyancy torque is removed after rotation');}report.tests.push({test:'10-second nonzero lift/offset force cleanup preserves foreign force and torque',force:body.userForce(),torque:body.userTorque()});}finally{lab.dispose();}
}
{
 const lab=new LabWorld(settings(),[ball(displaced)]);try{const b=lab.find('float').body;b.addForce({x:.1,y:.2,z:.3},true);lab.atmosphere.beforeStep(1/120);assert.throws(()=>lab.atmosphere.beforeStep(1/120),/afterStep/);b.addForce({x:.05,y:.07,z:-.1},true);lab.world.step();lab.atmosphere.afterStep(1/120);for(const[k,v]of Object.entries({x:.15,y:.27,z:.2}))near(b.userForce()[k],v,1e-6,'Forces added between atmosphere hooks are retained');report.tests.push({test:'Independent caller adds force between hooks',remaining:b.userForce()});}finally{lab.dispose();}
}
{
 const object=ball(1);delete object.buoyancy;const a=run([object],settings({windSpeed:4}),1),b=run([object],settings({windSpeed:4,atmosphere:{enabled:false}}),1);for(let i=0;i<3;i++){near(a.p[i],b.p[i],1e-6,'Legacy wind path is preserved for other bodies');near(a.v[i],b.v[i],1e-6,'Legacy wind force is not erased');}report.tests.push({test:'Legacy wind remains effective for non-buoyancy bodies',velocity:a.v});
}
{
 const object=ball(1,{buoyancy:{volume:0,dragCoefficient:.47,referenceArea:A(.3)}}),explicit={enabled:true,density:1.2,wind:[4,0,0]},a=run([object],settings({gravity:0,windSpeed:4,atmosphere:explicit}),1),b=run([object],settings({gravity:0,windSpeed:0,atmosphere:explicit}),1),fallback=run([object],settings({gravity:0,windSpeed:4,atmosphere:{enabled:true,density:1.2}}),1);
 for(let i=0;i<3;i++){near(a.p[i],b.p[i],1e-6,'No duplicate legacy/atmosphere drag');near(a.v[i],b.v[i],1e-6,'One authored drag route');near(fallback.p[i],b.p[i],1e-6,'Omitted atmosphere wind inherits legacy speed exactly once');}report.tests.push({test:'Single aerodynamic route and legacy wind fallback',explicit:a.v,withoutLegacy:b.v,fallback:fallback.v});
}
// A highly damped offset point can also spin an anisotropic body. Checking
// total air-relative kinetic energy catches an incorrect scalar body-mass cap.
{
 const lab=new LabWorld(settings({gravity:0}),[{id:'offset',asset:'custom',parts:[{shape:'box',d:[1,.2,.6]}],mass:.5,position:[0,10,0],velocity:[8,-2,3],angularVelocity:[1,5,-2],linearDamping:0,angularDamping:0,buoyancy:{volume:0,center:[.6,.2,.1],dragCoefficient:20,referenceArea:2}}]);
 const body=lab.find('offset').body;
 function energy(){const v=body.linvel(),w=body.angvel(),q=body.rotation(),frame=body.principalInertiaLocalFrame(),mul=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z}),p=mul(q,frame),local=mul(mul({x:-p.x,y:-p.y,z:-p.z,w:p.w},{...w,w:0}),p),I=body.principalInertia();return .5*body.mass()*(v.x*v.x+v.y*v.y+v.z*v.z)+.5*(I.x*local.x**2+I.y*local.y**2+I.z*local.z**2);}
 try{let previous=energy(),initial=previous;for(let i=0;i<120;i++){lab.step(1/120);const next=energy();assert(next<=previous+2e-4,'Offset-point drag must not inject kinetic energy');previous=next;}report.tests.push({test:'Energy-stable offset-point drag with rotation',initial,final:previous});}finally{lab.dispose();}
}
// A real rope descriptor becomes Rapier Generic at runtime in this installed
// API; verify unilateral physical behaviour instead of guessing by enum name.
assert.equal(R.JointData.rope(2,{x:0,y:0,z:0},{x:0,y:0,z:0}).jointType,R.JointType.Rope);
for(const direction of [1,-1]){
 const config=settings({gravity:0,atmosphere:{enabled:false},connections:[{id:'test-rope',type:'rope',a:'bob',b:'anchor',length:2,anchorA:[0,.05,0],anchorB:[0,0,0]}]}),lab=new LabWorld(config,[{id:'bob',asset:'ball',scale:.1,mass:1,position:[0,9,0],velocity:[0,direction*2,0],linearDamping:0,angularDamping:0},{id:'anchor',asset:'ball',scale:.1,fixed:true,position:[0,10,0]}]);
 try{let maxDistance=0;for(let i=0;i<48;i++){lab.step();const c=lab.connections[0],a=lab.find('bob').body.translation(),b=lab.find('anchor').body.translation();maxDistance=Math.max(maxDistance,Math.hypot(a.x-b.x,a.y+.05-b.y,a.z-b.z));assert.deepEqual(c.localA,[0,.05,0]);}if(direction>0){near(lab.find('bob').body.linvel().y,2,1e-5,'Slack rope cannot push or resist compression');assert(maxDistance<1);}else assert(maxDistance<2.02,'Taut rope enforces maximum separation');report.tests.push({test:direction>0?'Rope slack/compression':'Rope tension',maximumDistance:maxDistance,runtimeJointType:lab.connections[0].joint.type()});}finally{lab.dispose();}
}

// Consistent gas densities at the SAME ideal-gas T/P; envelope mass is an
// explicit author input, not hidden in rho or in an arbitrary lift multiplier.
const temperatureK=293.15,pressurePa=101325,Rgas=8.31446261815324,airMolarMass=.02896546,heliumMolarMass=.004002602,airDensity=pressurePa*airMolarMass/(Rgas*temperatureK),heliumDensity=pressurePa*heliumMolarMass/(Rgas*temperatureK),radius=.3,volume=V(radius),envelopeMass=.012,balloonMass=heliumDensity*volume+envelopeMass,netLiftMass=airDensity*volume-balloonMass,chairMass=5,chairScale=.5;
// Exact union volume/centroid for this axis-aligned catalogue chair, rather
// than summing overlapping solids or pretending the open chair is a sealed box.
const boxes=assetParts('chair').map(p=>({lo:p.p.map((v,i)=>(v-p.d[i]/2)*chairScale),hi:p.p.map((v,i)=>(v+p.d[i]/2)*chairScale)})),axes=[0,1,2].map(k=>[...new Set(boxes.flatMap(b=>[b.lo[k],b.hi[k]]))].sort((a,b)=>a-b));let chairVolume=0,centroid=[0,0,0];
for(let i=1;i<axes[0].length;i++)for(let j=1;j<axes[1].length;j++)for(let k=1;k<axes[2].length;k++){const ids=[i,j,k],center=ids.map((n,a)=>(axes[a][n-1]+axes[a][n])/2);if(boxes.some(b=>center.every((v,a)=>v>b.lo[a]&&v<b.hi[a]))){const v=ids.reduce((v,n,a)=>v*(axes[a][n]-axes[a][n-1]),1);chairVolume+=v;centroid=centroid.map((x,a)=>x+v*center[a]);}}
centroid=centroid.map(v=>v/chairVolume);const effectiveChairMass=chairMass-airDensity*chairVolume,threshold=Math.ceil(effectiveChairMass/netLiftMass);
report.inputs={temperatureK,pressurePa,airDensity,heliumDensity,radius,diameter:.6,volume,referenceArea:A(radius),envelopeMass,balloonMass,netLiftMass,chairMass,chairScale,chairVolume,chairVolumeCentroid:centroid,effectiveChairMass,analyticMinimumBalloonCount:threshold,notes:'Ideal-gas dry air/helium at20°C and101325Pa. Envelope12g, sphere Cd0.47 and chair Cd1.1 are declared assumptions. Rope mass is zero. Exact real-world threshold is not claimed.'};
function chairProject(count){
 const chairY=.465,objects=[{id:'chair',asset:'chair',name:'Стул · 5 кг',mass:chairMass,scale:chairScale,position:[0,chairY,0],material:'wood',linearDamping:0,angularDamping:0,friction:.6,restitution:0,buoyancy:{volume:chairVolume,center:centroid,dragCoefficient:1.1,referenceArea:(.9*chairScale)**2}}],connections=[];
 // Mirrored lattice pairs make a compact starting cluster with an explicit
 // clearance. No overlapping spheres are released to manufacture an explosion.
 const candidates=[];for(let x=-4;x<=4;x++)for(let y=-4;y<=4;y++)for(let z=-4;z<=4;z++)if(x>0||x===0&&(y>0||y===0&&z>0))candidates.push([x,y,z]);candidates.sort((a,b)=>a.reduce((s,v)=>s+v*v,0)-b.reduce((s,v)=>s+v*v,0)||a[1]-b[1]||a[0]-b[0]||a[2]-b[2]);const points=[];if(count%2)points.push([0,0,0]);for(const p of candidates){if(points.length>=count)break;points.push(p,p.map(v=>-v));}
 for(let i=0;i<count;i++){
  const position=points[i].map((v,k)=>v*.66+(k===1?3.2:0)),anchorB=[position[0]<0?-.17:.17,0,position[2]<0?-.17:.17],anchorA=[0,-radius,0],a=position.map((v,j)=>v+anchorA[j]),b=[anchorB[0],chairY+anchorB[1],anchorB[2]],length=Math.hypot(...a.map((v,j)=>v-b[j]));
  objects.push({id:`balloon-${i+1}`,name:`Гелиевый шар ${i+1}`,asset:'ball',scale:2*radius,mass:balloonMass,material:'rubber',appearance:{color:['#F06C8C','#44BFB4','#EBC257'][i%3],roughness:.35,metalness:.05},position,linearDamping:0,angularDamping:0,friction:.15,restitution:.1,buoyancy:{volume,center:[0,0,0],dragCoefficient:.47,referenceArea:A(radius)}});
  connections.push({id:`rope-${i+1}`,type:'rope',a:`balloon-${i+1}`,b:'chair',anchorA,anchorB,length,visual:{enabled:true,radius:.002,color:'#D6C5A5'}});
 }
 for(let i=1;i<objects.length;i++)for(let j=i+1;j<objects.length;j++)assert(Math.hypot(...objects[i].position.map((v,k)=>v-objects[j].position[k]))>=2*radius+.05,'Initial balloon envelopes must not overlap');
 return{version:1,name:`Стул и ${count} гелиевых шаров`,settings:settings({atmosphere:{enabled:true,density:airDensity,wind:[0,0,0]},connections}),objects,edits:{}};
}
for(const count of [30,threshold,80]){
 const p=chairProject(count);validateProject(p);const runChair=dt=>{const lab=new LabWorld(p.settings,p.objects,p.edits);try{let maxY=-Infinity;for(let i=0;i<Math.round(8/dt);i++){lab.step(dt);maxY=Math.max(maxY,lab.find('chair').body.translation().y);}const chair=lab.find('chair').body,p=chair.translation(),v=chair.linvel();assert(lab.entities.every(e=>{const p=e.body.translation();return[p.x,p.y,p.z].every(Number.isFinite);}));return{height:p.y,maxHeight:maxY,velocity:[v.x,v.y,v.z]};}finally{lab.dispose();}};
 const a=runChair(1/120),b=runChair(1/240),netVerticalForce=(count*netLiftMass-effectiveChairMass)*g;report.chair.push({count,netVerticalForce,at120:a,at240:b,heightDifference:Math.abs(a.height-b.height),initialSphereClearance:.06});console.log(JSON.stringify(report.chair.at(-1)));
 if(count===30)assert(a.height<.60,'Insufficient displaced-air mass cannot sustain chair lift');if(count===80)assert(a.height>1.3,'Enough real buoyancy must lift the chair');assert(Math.abs(a.height-b.height)<.20,'Chair outcome must be timestep-convergent to a bounded tolerance');
 const projectDir=process.argv.find(v=>v.startsWith('--projects='))?.slice(11);if(projectDir){await mkdir(projectDir,{recursive:true});await writeFile(path.join(projectDir,`chair-${count}.project.json`),JSON.stringify(p,null,2));}
}
const output=process.argv.find(v=>v.startsWith('--report='))?.slice(9);if(output){await mkdir(path.dirname(path.resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,tests:report.tests.length,chairCases:report.chair.length,analyticThreshold:threshold,scope:report.domain}));
