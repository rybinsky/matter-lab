import RAPIER from '@dimforge/rapier3d-compat';
import {SurfaceMotion,normalizeSurfaceMotion,surfaceProfile} from './surface-motion.js';

const arr=v=>[v.x,v.y,v.z],vec=a=>({x:a[0],y:a[1],z:a[2]}),norm=a=>Math.hypot(...a);
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function rotate(v,q){const u=[q.x,q.y,q.z],a=cross(u,v),b=cross(u,a);return v.map((x,i)=>x+2*(q.w*a[i]+b[i]));}
const inverse=q=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
const fail=message=>{throw new Error(`Surface motion scene: ${message}`);};

export function normalizeSurfaceMotionScene(value){
  const config=normalizeSurfaceMotion(value),r=value?.render||{};
  const bounded=(v,name,min,max,integer=false)=>{if(!Number.isFinite(v)||v<min||v>max||integer&&!Number.isInteger(v))fail(`invalid render.${name}`);return v;};
  const color=r.color??'#DEDCD4';if(typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))fail('render.color must be #RRGGBB');
  return{...config,render:{color,apronWidth:bounded(r.apronWidth??3,'apronWidth',0,100),segments:bounded(r.segments??128,'segments',16,512,true),radialSegments:bounded(r.radialSegments??24,'radialSegments',1,128,true)}};
}

/** Local Y-up static render/collision mesh, including the actual flat apron. */
export function axisymmetricSurfaceMesh(value){
  const config=normalizeSurfaceMotionScene(value),s=config.surface,r=config.render,positions=[],indices=[];
  const vertex=(x,y,z)=>{const n=positions.length/3;positions.push(x,y,z);return n;};
  const ring=(radius,height)=>Array.from({length:r.segments},(_,i)=>{const angle=i/r.segments*Math.PI*2;return vertex(radius*Math.cos(angle),height,-radius*Math.sin(angle));});
  const connect=(a,b)=>{for(let i=0;i<r.segments;i++){const j=(i+1)%r.segments;indices.push(a[i],b[i],a[j],a[j],b[i],b[j]);}};
  const rings=[];for(let j=0;j<=r.radialSegments;j++){const radius=s.minRadius+(s.rimRadius-s.minRadius)*j/r.radialSegments;rings.push(ring(radius,surfaceProfile(s,radius).height));if(j)connect(rings[j-1],rings[j]);}
  // The tiny central cap closes the rendered/collision mesh. The model's
  // minRadius remains a free edge and can hand the actor to this real cap.
  const center=vertex(0,surfaceProfile(s,s.minRadius).height,0);for(let i=0;i<r.segments;i++)indices.push(center,rings[0][i],rings[0][(i+1)%r.segments]);
  if(r.apronWidth>0){const height=surfaceProfile(s,s.rimRadius).height;connect(ring(s.rimRadius,height),ring(s.rimRadius+r.apronWidth,height));}
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++){const axis=i%3;lo[axis]=Math.min(lo[axis],positions[i]);hi[axis]=Math.max(hi[axis],positions[i]);}
  return{positions,indices,color:r.color,bounds:lo.map((x,i)=>hi[i]-x),boundCenter:lo.map((x,i)=>(x+hi[i])/2),kind:'axisymmetric-surface',apronWidth:r.apronWidth};
}

/** Exact lower support for the ordinary collider shapes LabWorld creates. */
function lowerColliderY(collider){
  const shape=collider.shape,d=rotate([0,-1,0],inverse(collider.rotation())),t=shape.type,S=RAPIER.ShapeType;let support;
  if(t===S.Ball)support=shape.radius;
  else if(t===S.Cuboid||t===S.RoundCuboid){const e=shape.halfExtents;support=Math.abs(d[0])*e.x+Math.abs(d[1])*e.y+Math.abs(d[2])*e.z+(shape.borderRadius||0);}
  else if(t===S.Cylinder||t===S.RoundCylinder)support=Math.abs(d[1])*shape.halfHeight+Math.hypot(d[0],d[2])*shape.radius+(shape.borderRadius||0);
  else if(t===S.Cone||t===S.RoundCone)support=Math.max(d[1]*shape.halfHeight,-d[1]*shape.halfHeight+Math.hypot(d[0],d[2])*shape.radius)+(shape.borderRadius||0);
  else if(t===S.Capsule)support=Math.abs(d[1])*shape.halfHeight+shape.radius;
  else if(shape.vertices){support=-Infinity;for(let i=0;i<shape.vertices.length;i+=3)support=Math.max(support,d[0]*shape.vertices[i]+d[1]*shape.vertices[i+1]+d[2]*shape.vertices[i+2]);support+=shape.borderRadius||0;}
  else fail('the selected collider has no supported finite upright envelope');
  if(!Number.isFinite(support))fail('the selected body has an invalid collider envelope');
  return collider.translation().y-support;
}

/** Adapter domain: one ideal upright point proxy, then ordinary dynamic Rapier. */
export class SurfaceMotionScene {
  constructor(lab,value){
    this.lab=lab;const authored=normalizeSurfaceMotionScene(value),entity=lab.find(authored.body),g=arr(lab.world.gravity);
    if(!entity?.body||entity.soft||entity.fixed||entity.kinematic||!entity.body.isDynamic()||!entity.colliders?.length)fail('select one free ordinary rigid body with colliders');
    if(lab.settings.experiment!=='blank')fail('use a blank scene for the constrained surface model');
    if(Math.abs(g[0])+Math.abs(g[2])>1e-9||g[1]>0)fail('gravity must point down world Y');
    if(lab.connections.some(c=>c.aEntity===entity||c.bEntity===entity)||(lab.settings.assemblies||[]).some(a=>a.bonds.some(b=>b.a===entity.id||b.b===entity.id)))fail('the selected body cannot belong to joints or breakable assemblies');
    if(entity.phenomenonRole||entity.spec?.deformable?.enabled!==false&&entity.spec?.deformable||entity.spec?.buoyancy?.enabled!==false&&entity.spec?.buoyancy)fail('the selected body already belongs to another physical model');
    if(lab.settings.windSpeed||lab.settings.atmosphere?.enabled)fail('disable wind and atmosphere for this isolated constrained model');
    if(norm(arr(entity.body.userForce()))>1e-7||norm(arr(entity.body.userTorque()))>1e-7||norm(arr(entity.body.angvel()))>1e-7)fail('the upright point proxy requires no initial torque, external force or angular velocity');
    this.entity=entity;this.originalRotation={...entity.body.rotation()};this.savedColliders=entity.colliders.map(c=>({collider:c,enabled:c.isEnabled()}));
    const center=arr(entity.body.worldCom()),translation=arr(entity.body.translation()),minimumY=Math.min(...entity.colliders.map(lowerColliderY));
    this.poseOffset=[translation[0]-center[0],translation[1]-minimumY,translation[2]-center[2]];this.localAnchor=rotate(this.poseOffset.map(x=>-x),inverse(this.originalRotation));
    this.config=normalizeSurfaceMotionScene({...authored,mass:entity.body.mass(),gravity:-g[1]*entity.body.gravityScale()});this.model=new SurfaceMotion(this.config);this.released=false;this._pendingRelease=false;
    this.surfaceId=`surface-motion-${entity.id}`;if(lab.find(this.surfaceId))fail('generated surface identifier already exists');
    const mesh=axisymmetricSurfaceMesh(this.config),surface=lab.addRigid({id:this.surfaceId,name:'Поверхность и площадка выхода',asset:'custom',parts:[],position:this.config.origin.slice(),fixed:true,material:'ceramic',mass:1});
    const descriptor=RAPIER.ColliderDesc.trimesh(new Float32Array(mesh.positions),new Uint32Array(mesh.indices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(this.config.drive.friction).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(20);
    const collider=lab.world.createCollider(descriptor,surface.body);surface.colliders.push(collider);lab.colliderEntities.set(collider.handle,surface);surface.renderSurface=mesh;surface.phenomenonRole='surface-motion-support';surface.editable=false;surface.generated=true;this.surfaceEntity=surface;
    entity.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);entity.kinematic=true;entity.phenomenonRole='surface-motion-point-proxy';
    for(const {collider:c}of this.savedColliders)c.setEnabled(false);
    const p=add(this.model.position(),this.poseOffset);entity.body.setTranslation(vec(p),true);entity.body.setLinvel(vec(this.model.velocity()),true);entity.body.setAngvel({x:0,y:0,z:0},true);
    if(this.model.phase==='ballistic')this._pendingRelease=true;
    lab.world.propagateModifiedBodyPositionsToColliders();
  }
  beforeStep(dt){
    if(this.released)return;const body=this.entity.body;
    if(!body.isValid())fail('the controlled body was removed; rebuild this scene');
    if(!body.isKinematic()||this.entity.colliders.some(c=>c.isEnabled()))fail('the constrained body mode changed; rebuild this scene');
    const mass=this.entity.colliders.reduce((sum,c)=>sum+c.mass(),0),g=arr(this.lab.world.gravity);
    if(Math.abs(mass-this.config.mass)>Math.max(1e-5,this.config.mass*1e-5)||Math.abs(-g[1]*body.gravityScale()-this.config.gravity)>1e-7||Math.abs(g[0])+Math.abs(g[2])>1e-9)fail('mass or gravity changed; rebuild the constrained model');
    if(this.lab.settings.windSpeed||this.lab.settings.atmosphere?.enabled||this.lab.connections.some(c=>c.aEntity===this.entity||c.bEntity===this.entity))fail('wind, atmosphere and joints cannot be combined with the constrained model');
    if(norm(arr(body.userForce()))>1e-7||norm(arr(body.userTorque()))>1e-7)fail('external forces cannot be combined with the constrained point model');
    const state=this.model.step(dt),p=add(state.position,this.poseOffset);body.setNextKinematicTranslation(vec(p));body.setNextKinematicRotation(this.originalRotation);this._pendingRelease=state.phase==='ballistic';
  }
  afterStep(){
    if(this.released||!this._pendingRelease)return;const body=this.entity.body,state=this.model.snapshot();
    // This state ALREADY includes the remainder of the just-completed dt.
    // Switch only after world.step: no second gravity advance in this frame.
    for(const {collider,enabled}of this.savedColliders)collider.setEnabled(enabled);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);body.recomputeMassPropertiesFromColliders();this.entity.kinematic=false;body.setTranslation(vec(add(state.position,this.poseOffset)),true);body.setRotation(this.originalRotation,true);body.setLinvel(vec(state.velocity),true);body.setAngvel({x:0,y:0,z:0},true);this.released=true;this._pendingRelease=false;
    this.handoff={time:this.lab.time,position:arr(body.translation()),velocity:arr(body.linvel()),rotation:{...body.rotation()},modelRelease:structuredClone(state.release)};
  }
  snapshot(){
    const state=this.model.snapshot(),body=this.entity.body,bodyPosition=arr(body.translation()),bodyVelocity=arr(body.linvel()),base={...state,modelTime:state.time,time:this.lab.time,bodyMass:this.config.mass,effectiveGravity:this.config.gravity,proxyPoseOffset:this.poseOffset.slice(),bodyPosition,bodyVelocity,surfaceId:this.surfaceId,constrained:!this.released,handoff:this.handoff?structuredClone(this.handoff):null};
    if(!this.released)return base;
    const anchor=add(bodyPosition,rotate(this.localAnchor,body.rotation())),velocity=add(bodyVelocity,cross(arr(body.angvel()),sub(anchor,arr(body.worldCom())))),x=anchor[0]-this.config.origin[0],z=anchor[2]-this.config.origin[2],radius=Math.hypot(x,z);
    return{...base,phase:'dynamic',position:anchor,velocity,radius,height:anchor[1]-this.config.origin[1],radialSpeed:radius?(x*velocity[0]+z*velocity[2])/radius:0,azimuthSpeed:radius?(z*velocity[0]-x*velocity[2])/radius:0,normalForce:null,normal:null,energy:null,kinetic:null,potential:null,energyResidual:null,angularMomentumY:null,energyAccounting:'Constraint ledger stops at handoff; subsequent contacts and rotation are solved by Rapier.'};
  }
}
