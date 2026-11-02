import RAPIER from '@dimforge/rapier3d-compat';
import { MATERIALS, CATALOG, assetParts, settingsFor } from './catalog.js';
import { CentralGravity, HeatPenetration } from './phenomena.js';
import { compressionFixtureParts } from './lab-fixtures.js';
import { buildSoftAsset } from './deformable-assets.js';
import { BreakableAssemblies, copyContactForceEvent } from './breakable-assemblies.js';
import { normalizeConnectionVisual, createConnectionSurface } from './connection-visuals.js';
import { PenetrationScene } from './penetration-scene.js';
import { UniformAtmosphere, normalizeBuoyancy } from './atmosphere.js';
import { modelReadouts } from './measurement-readouts.js';
import { SurfaceMotionScene } from './surface-motion-scene.js';
import { createMotionRig } from './motion-rig.js';

let initialization;
export async function initializePhysics() {
  initialization ||= RAPIER.init();
  await initialization;
  return RAPIER;
}
const v = (a) => ({x:a[0],y:a[1],z:a[2]});
function validateDamping(values){for(const key of ['linearDamping','angularDamping'])if(values[key]!==undefined&&(!Number.isFinite(values[key])||values[key]<0||values[key]>100))throw new Error(`Затухание ${key}: задайте число от 0 до 100.`);}
function validateAppearance(value){
 if(value===undefined||value===null)return;
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['color','roughness','metalness'].includes(k)))throw new Error('Некорректные настройки внешнего вида.');
 if(value.color!==undefined&&(typeof value.color!=='string'||!/^#[\da-f]{6}$/i.test(value.color)))throw new Error('Цвет предмета должен быть в формате #RRGGBB.');
 for(const key of ['roughness','metalness'])if(value[key]!==undefined&&(!Number.isFinite(value[key])||value[key]<0||value[key]>1))throw new Error('Параметры поверхности должны быть от 0 до 1.');
}
const qmul=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
export function quaternion(e=[0,0,0]) {
  if(!Array.isArray(e)){const length=Math.hypot(e.x,e.y,e.z,e.w);if(!Number.isFinite(length)||length<1e-9)throw new Error('Некорректный поворот предмета');return{x:e.x/length,y:e.y/length,z:e.z/length,w:e.w/length};}
  const x=e[0]/2,y=e[1]/2,z=e[2]/2;
  return qmul(qmul({x:Math.sin(x),y:0,z:0,w:Math.cos(x)},{x:0,y:Math.sin(y),z:0,w:Math.cos(y)}),{x:0,y:0,z:Math.sin(z),w:Math.cos(z)});
}
export function launchVector(speed, azimuth, elevation) {
  const a=azimuth*Math.PI/180,e=elevation*Math.PI/180;
  return {x:speed*Math.sin(a)*Math.cos(e),y:speed*Math.sin(e),z:speed*Math.cos(a)*Math.cos(e)};
}
function colliderFor(part, scale=1) {
  const d=part.d.map(n=>n*scale);
  if(part.shape==='sphere') return RAPIER.ColliderDesc.ball(d[0]);
  if(part.shape==='ellipsoid'){
    const vertices=[];for(let j=0;j<=8;j++){const b=j/8*Math.PI;for(let k=0;k<16;k++){const a=k/16*Math.PI*2;vertices.push(d[0]*Math.sin(b)*Math.cos(a),d[1]*Math.cos(b),d[2]*Math.sin(b)*Math.sin(a));}}
    return RAPIER.ColliderDesc.convexHull(new Float32Array(vertices));
  }
  if(part.shape==='cylinder') return RAPIER.ColliderDesc.cylinder(d[1]/2,d[0]);
  if(part.shape==='cone') return RAPIER.ColliderDesc.cone(d[1]/2,d[0]);
  if(part.shape==='icosa') return RAPIER.ColliderDesc.ball(d[0]*.87);
  if(part.shape==='torus') return null;
  return RAPIER.ColliderDesc.cuboid(d[0]/2,d[1]/2,d[2]/2);
}
function volume(p) {
  if(p.shape==='sphere'||p.shape==='icosa') return 4/3*Math.PI*p.d[0]**3;
  if(p.shape==='ellipsoid')return 4/3*Math.PI*p.d[0]*p.d[1]*p.d[2];
  if(p.shape==='cylinder') return Math.PI*p.d[0]**2*p.d[1];
  if(p.shape==='cone') return Math.PI*p.d[0]**2*p.d[1]/3;
  if(p.shape==='torus') return 2*Math.PI**2*p.d[0]*p.d[1]**2;
  return p.d.reduce((a,b)=>a*b,1);
}

export class LabWorld {
  constructor(settings, objects=[], edits={}) {
    this.settings={...settings};
    // The heated sphere's mass belongs to the heat model as well as its body.
    if(settings.experiment==='thermal'&&edits['hot-ball']?.mass)this.settings.mass=edits['hot-ball'].mass;
    this.world=new RAPIER.World({x:0,y:-this.settings.gravity,z:0});
    try{
    this.world.timestep=1/120;
    this.world.integrationParameters.numSolverIterations=10;
    this.events=new RAPIER.EventQueue(true);
    this.entities=[]; this.softs=[]; this.impacts=[]; this.time=0;this.colliderEntities=new Map();this.lastContact=new Map();this.measurementOrigins=new Map();this.measured=new Map();
    this.serial=0; this.actions=[]; this.added=objects;this.surfaces=[];this.orbiters=[];this.connections=[];
    this.addRigid({id:'ground',name:'Пол студии',parts:[{shape:'box',d:[2000,.24,2000],p:[0,0,0]}],position:[0,-.15,0],fixed:true,material:'ceramic',color:'#e7e5dc',floor:true});
    this.build();
    for(const spec of objects)if(!edits[spec.id]?.deleted)this.addRigid({...spec,...edits[spec.id]});
    this.applyEdits(edits);
    for(const connection of settings.connections||[])this.connect(connection);
    for(const emitter of settings.emitters||[])this.prepareEmitter(emitter);
    this.breakables=settings.assemblies?.length?new BreakableAssemblies({world:this.world,entitiesById:new Map(this.entities.map(e=>[e.id,e])),assemblies:settings.assemblies}):null;
    this.fractureEvents=this.breakables?.events||[];
    this.penetration=settings.penetration?new PenetrationScene(this,settings.penetration):null;
    this.atmosphere=new UniformAtmosphere({world:this.world,getEntities:()=>this.entities,settings:settings.atmosphere,legacyWindSpeed:settings.windSpeed||0});
    this.surfaceMotion=settings.surfaceMotion?new SurfaceMotionScene(this,settings.surfaceMotion):null;
    this.motionRigs=[];
    for(const entity of [...this.entities])if(entity.spec?.visualRig){const rig=createMotionRig(this,entity,entity.spec.visualRig);this.motionRigs.push(rig);rig.update(0,this.surfaceMotion?.entity===entity?this.surfaceMotion.snapshot():{phase:'dynamic'});}
    this.resetMeasurements();
    }catch(error){this.dispose();throw error;}
  }
  addRigid(spec) {
    if(spec.buoyancy!==undefined)normalizeBuoyancy(spec.buoyancy);
    if(spec.buoyancy&&spec.buoyancy.enabled!==false&&(spec.asset==='softcube'||spec.deformable&&spec.deformable.enabled!==false))throw Error('Постоянный вытесненный объём атмосферы поддерживается только у твёрдых тел.');
    if(spec.deformable&&spec.deformable.enabled!==false)return this.addDeformable(spec);
    if(spec.asset==='softcube')return this.addSoftCube(spec);
    const id=spec.id||`object-${++this.serial}`;
    const asset=CATALOG.find(o=>o.id===spec.asset);
    const mat=MATERIALS[spec.material||asset?.mat||'ceramic'];
    const parts=spec.parts||assetParts(spec.asset||'cube');
    validateAppearance(spec.appearance);
    const appearance=spec.appearance?structuredClone(spec.appearance):null;
    const scale=spec.scale??1;
    const position=spec.position||[0,2,0];
    let desc=spec.fixed||spec.renderOnly ? RAPIER.RigidBodyDesc.fixed() : spec.kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(...position).setRotation(quaternion(spec.rotation));
    validateDamping(spec);
    const dynamic=!spec.fixed&&!spec.kinematic&&!spec.renderOnly;
    desc.setLinearDamping(spec.linearDamping??(dynamic ? .055 : 0)).setAngularDamping(spec.angularDamping??(dynamic ? .12 : 0));
    if(dynamic)desc.setCcdEnabled(true);
    const body=this.world.createRigidBody(desc);
    const colliders=[];
    const totalVol=parts.reduce((sum,p)=>sum+volume(p),0);
    const mass=spec.mass??asset?.mass??Math.max(.08,totalVol*scale**3*mat.density*.12);
    for(const part of spec.renderOnly?[]:parts) {
      if(part.shape==='torus') {
        for(let i=0;i<16;i++) {
          const a=i*Math.PI/8;
          const parentQ=quaternion(part.r);
          const radius=part.d[0]*scale;
          const local={x:Math.cos(a)*radius,y:0,z:Math.sin(a)*radius};
          const rotated=rotate(local,parentQ);
          const p=part.p||[0,0,0];
          const c=RAPIER.ColliderDesc.ball(part.d[1]*scale).setTranslation(rotated.x+p[0]*scale,rotated.y+p[1]*scale,rotated.z+p[2]*scale).setMass(mass*volume(part)/totalVol/16).setFriction(spec.friction??mat.friction??.4).setRestitution(spec.restitution??mat.restitution??.2);
          c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(20);
          colliders.push(this.world.createCollider(c,body));
        }
      } else {
        const c=colliderFor(part,scale);
        const p=part.p||[0,0,0];
        c.setTranslation(p[0]*scale,p[1]*scale,p[2]*scale).setRotation(quaternion(part.r)).setMass(mass*volume(part)/totalVol).setFriction(spec.friction??mat.friction??.5).setRestitution(spec.restitution??mat.restitution??.2);
        c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(20);
        colliders.push(this.world.createCollider(c,body));
      }
    }
    if(spec.velocity) body.setLinvel(v(spec.velocity),true);
    if(spec.angularVelocity)body.setAngvel(v(spec.angularVelocity),true);
    const entity={id,name:spec.name||asset?.name||'Объект',asset:spec.asset||'custom',body,colliders,parts,visualParts:spec.visualParts,material:spec.material||asset?.mat||'ceramic',color:spec.color,appearance,scale,fixed:!!spec.fixed||!!spec.renderOnly,kinematic:!!spec.kinematic,renderOnly:!!spec.renderOnly,spec:{...spec,id,...(spec.appearance===undefined?{}:{appearance:structuredClone(appearance)})}};
    this.entities.push(entity);for(const c of colliders)this.colliderEntities.set(c.handle,entity);this.measurementOrigins.set(id,position.slice());
    return entity;
  }
  addAsset(asset,position,extra={}) { return this.addRigid({asset,position,...extra}); }
  addSoftCube(spec){
    validateAppearance(spec.appearance);const appearance=spec.appearance?structuredClone(spec.appearance):null;
    const id=spec.id||`soft-${++this.serial}`,preset=MATERIALS[spec.material||'jelly'];
    const p=spec.position||[0,2,0],scale=spec.scale||1,m=new RAPIER.SoftBodyMaterial();
    m.youngModulus=preset.young||1400;m.poissonRatio=preset.poisson||.35;m.elasticDampingRatio=preset.damping||.3;m.plasticYield=preset.plasticYield||0;m.plasticCreep=preset.plasticCreep||0;m.plasticMax=.9;
    const desc=RAPIER.SoftBodyDesc.cuboid(v(p),{x:.7*scale,y:.7*scale,z:.7*scale},5,5,5).setMass(spec.mass||3).setCellModel(RAPIER.SoftBodyCellModel.Corotational).setSolver(RAPIER.SoftBodySolver.Constraints).setMaterial(m).setParticleRadius(.025).setAdditionalSolverIterations(8).setLinearDamping(.35).setCanSleep(false);
    const soft=this.world.createSoftBody(desc),entity={id,name:preset.name,soft,material:spec.material||'jelly',parts:[],asset:'softcube',scale,appearance,spec:{...spec,id,asset:'softcube',...(spec.appearance===undefined?{}:{appearance:structuredClone(appearance)})},fixed:false};this.softs.push(entity);return entity;
  }
  addDeformable(spec){
    if(spec.fixed||spec.kinematic)throw new Error('Мягкое тело должно быть свободным. Фиксация отдельных частиц пока не задана в проекте.');
    validateAppearance(spec.appearance);validateDamping(spec);
    const material=spec.material||'jelly',built=buildSoftAsset({...spec,material}),currentParticles=this.softs.reduce((sum,e)=>sum+e.soft.numParticles(),0);
    if(currentParticles+built.metadata.gridPoints>2048)throw new Error('Слишком много мягких частиц в одной сцене. Увеличьте ячейки или уменьшите число мягких предметов.');
    if(spec.linearDamping!==undefined)built.descriptor.setLinearDamping(spec.linearDamping);
    const soft=this.world.createSoftBody(built.descriptor),id=spec.id||`soft-${++this.serial}`,asset=CATALOG.find(a=>a.id===spec.asset),appearance=spec.appearance?structuredClone(spec.appearance):null;
    const sourceAppearance={color:spec.color||built.metadata.originalColor,roughness:.35,metalness:0},entity={id,name:spec.name||asset?.name||'Мягкий предмет',soft,asset:spec.asset||'custom',parts:spec.parts||[],material:spec.material||'jelly',color:sourceAppearance.color,appearance,sourceAppearance,softRender:{color:sourceAppearance.color,appearance:sourceAppearance,sourceSkin:built.render.sourceSkin},renderAppearance:{...sourceAppearance,...appearance},originalColor:built.metadata.originalColor,sourceSkin:built.render.sourceSkin,deformableMetadata:built.metadata,scale:spec.scale??1,fixed:false,kinematic:false,colliders:[],spec:{...spec,id,material,mass:spec.mass??1,...(spec.appearance===undefined?{}:{appearance:structuredClone(appearance)})}};
    for(let i=0;i<soft.numMeshes();i++){const collider=soft.meshCollider(i);if(collider){collider.setFriction(spec.friction??MATERIALS[entity.material]?.friction??.5);collider.setRestitution(spec.restitution??MATERIALS[entity.material]?.restitution??.1);collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);collider.setContactForceEventThreshold(20);entity.colliders.push(collider);this.colliderEntities.set(collider.handle,entity);}}
    if(spec.velocity||spec.angularVelocity){const center=soft.centerOfMass(),linear=spec.velocity||[0,0,0],w=spec.angularVelocity||[0,0,0];for(let i=0;i<soft.numParticles();i++){const p=soft.particlePosition(i),r=[p.x-center.x,p.y-center.y,p.z-center.z];soft.setParticleVelocity(i,{x:linear[0]+w[1]*r[2]-w[2]*r[1],y:linear[1]+w[2]*r[0]-w[0]*r[2],z:linear[2]+w[0]*r[1]-w[1]*r[0]});}}
    this.softs.push(entity);return entity;
  }
  connect(spec){
    const visual=normalizeConnectionVisual(spec.visual),id=spec.id||`connection-${++this.serial}`;
    if(this.connections.some(c=>c.id===id))throw new Error(`Связь «${id}» уже существует.`);
    const label=spec.id||`${spec.a} → ${spec.b||'пространство'}`,a=this.find(spec.a);
    if(!a?.body)throw new Error(`Связь «${label}»: первый предмет «${spec.a}» не найден или не является твёрдым телом.`);
    const worldAnchor=spec.b===undefined||spec.b===null||spec.b===''||spec.b==='world';
    let b=worldAnchor?null:this.find(spec.b);
    if(!worldAnchor&&!b?.body)throw new Error(`Связь «${label}»: второй предмет «${spec.b}» не найден или не является твёрдым телом. Для опоры в пространстве выберите её явно.`);
    if(b===a)throw new Error(`Связь «${label}»: нельзя связать предмет с самим собой.`);
    if(worldAnchor){const p=a.body.translation();b=this.addRigid({id:`anchor-${id}`,name:'Точка подвеса',position:spec.point||[p.x,p.y+1.8,p.z],fixed:true,material:'metal',parts:[{shape:'sphere',d:[.07],p:[0,0,0],color:'#dc8960'}]});}
    const pa=a.body.translation(),pb=b.body.translation();const qa=a.body.rotation(),qb=b.body.rotation();
    const anchor=spec.point? v(spec.point):worldAnchor?pb:{x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2,z:(pa.z+pb.z)/2};
    const local=(p,q)=>rotate({x:anchor.x-p.x,y:anchor.y-p.y,z:anchor.z-p.z},{x:-q.x,y:-q.y,z:-q.z,w:q.w});
    let aa=local(pa,qa),ab=local(pb,qb);const axis=spec.axis==='x'?{x:1,y:0,z:0}:spec.axis==='z'?{x:0,y:0,z:1}:{x:0,y:1,z:0};
    let data;
    if(spec.type==='spring'){const length=Math.hypot(pa.x-pb.x,pa.y-pb.y,pa.z-pb.z);data=RAPIER.JointData.spring(spec.length??length,spec.stiffness??120,spec.damping??8,{x:0,y:0,z:0},{x:0,y:0,z:0});}
    else if(spec.type==='rope'){
      const endpoint=(value)=>{const p=value??[0,0,0];if(!Array.isArray(p)||p.length!==3||!p.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000))throw Error('Точка крепления верёвки: три конечные локальные координаты в метрах.');return v(p);};
      aa=endpoint(spec.anchorA);ab=endpoint(spec.anchorB);const wa=rotate(aa,qa),wb=rotate(ab,qb),length=spec.length??Math.hypot(pa.x+wa.x-pb.x-wb.x,pa.y+wa.y-pb.y-wb.y,pa.z+wa.z-pb.z-wb.z);
      if(!Number.isFinite(length)||length<=0||length>10000)throw Error('Максимальная длина верёвки: больше 0 и до 10 000 м.');
      data=RAPIER.JointData.rope(length,aa,ab);
    }
    else if(spec.type==='hinge')data=RAPIER.JointData.revolute(aa,ab,axis);
    else if(spec.type==='ball')data=RAPIER.JointData.spherical(aa,ab);
    else data=RAPIER.JointData.fixed(aa,{x:0,y:0,z:0,w:1},ab,qmul({x:-qb.x,y:-qb.y,z:-qb.z,w:qb.w},qa));
    const joint=this.world.createImpulseJoint(data,a.body,b.body,true);joint.setContactsEnabled(false);
    const connection={...spec,id,type:spec.type||'fixed',visual,joint,aEntity:a,bEntity:b,localA:spec.type==='spring'?[0,0,0]:[aa.x,aa.y,aa.z],localB:spec.type==='spring'?[0,0,0]:[ab.x,ab.y,ab.z]};
    this.connections.push(connection);const surface=createConnectionSurface(connection);if(surface)this.surfaces.push(surface);return joint;
  }
  prepareEmitter(spec){
    const count=Math.max(1,Math.min(50,spec.count||12));const position=spec.position||[0,5,0];
    for(let i=0;i<count;i++){
      const entity=this.addAsset(spec.asset||'ball',[position[0],-100-i,position[2]],{id:`${spec.id}-${i}`,mass:spec.mass||1,material:spec.material||'rubber',scale:spec.scale||.6});
      entity.body.setEnabled(false);
      this.actions.push({time:(spec.delay||.3)+i*(spec.interval||.45),run:()=>{entity.body.setEnabled(true);const p=[position[0]+Math.sin(i*2.399)*.35,position[1],position[2]+Math.cos(i*2.399)*.35];entity.body.setTranslation(v(p),true);this.measurementOrigins.set(entity.id,p);entity.body.setLinvel(launchVector(spec.speed||0,spec.azimuth||180,spec.elevation||0),true);}});
    }
  }
  setMaterial(id,materialId,recolor=false) {
    const e=this.find(id),preset=MATERIALS[materialId];if(!e||!preset)return;
    e.material=materialId;e.spec.material=materialId;
    if(!e.soft&&recolor){e.color=preset.color;e.spec.color=preset.color;e.parts=e.parts.map(p=>({...p,color:preset.color}));}
    if(e.soft){
      const m=new RAPIER.SoftBodyMaterial();
      if(e.deformableMetadata){const config=e.spec.deformable||{};m.youngModulus=config.young??preset.young??2200;m.poissonRatio=config.poisson??preset.poisson??.35;m.elasticDampingRatio=config.elasticDampingRatio??.25;m.plasticYield=config.plasticYield??preset.plasticYield??0;m.plasticCreep=config.plasticCreep??preset.plasticCreep??0;m.plasticMax=config.plasticMax??.8;}
      else{m.youngModulus=preset.young||1400;m.poissonRatio=preset.poisson||.35;m.elasticDampingRatio=preset.damping||.3;m.plasticYield=preset.plasticYield||0;m.plasticCreep=preset.plasticCreep||0;m.plasticMax=.9;}
      e.soft.setMaterial(m);
    } else for(const c of e.colliders){c.setFriction(e.spec.friction??preset.friction??.5);c.setRestitution(e.spec.restitution??preset.restitution??.2);}
  }
  setContact(id,values){const e=this.find(id);if(!e?.body&&!e?.deformableMetadata)return;for(const key of ['friction','restitution'])if(values[key]!==undefined){e.spec[key]=values[key];for(const c of e.colliders)c[key==='friction'?'setFriction':'setRestitution'](values[key]);}if(e.body)e.body.wakeUp();else e.soft.wakeUp();}
  setDamping(id,values){
    const e=this.find(id);if(!e?.body)return;validateDamping(values);
    for(const key of ['linearDamping','angularDamping'])if(values[key]!==undefined){e.body[key==='linearDamping'?'setLinearDamping':'setAngularDamping'](values[key]);e.spec[key]=values[key];}
    e.body.wakeUp();
  }
  setAppearance(id,appearance=null){
    const e=this.find(id);if(!e?.body&&!e?.soft)return;validateAppearance(appearance);
    // Only render metadata changes. Original parts, body and colliders stay put.
    e.appearance=appearance?structuredClone(appearance):null;
    e.spec.appearance=structuredClone(e.appearance);
    if(e.sourceAppearance)e.renderAppearance={...e.sourceAppearance,...e.appearance};
  }
  applyEdits(edits={}){
    for(const[id,edit]of Object.entries(edits)){
      const e=this.find(id);if(!e)continue;if(edit.deleted){this.remove(id);continue;}
      if(edit.position){if(e.body)e.body.setTranslation(v(edit.position),true);else if(e.soft&&(!e.deformableMetadata||!e.spec.position?.every((v,i)=>v===edit.position[i])))this.moveSoft(id,v(edit.position));}
      if(edit.rotation&&e.body)e.body.setRotation(quaternion(edit.rotation),true);
      if(typeof edit.fixed==='boolean'&&e.body){e.fixed=edit.fixed;e.body.setBodyType(edit.fixed?RAPIER.RigidBodyType.Fixed:e.kinematic?RAPIER.RigidBodyType.KinematicPositionBased:RAPIER.RigidBodyType.Dynamic,true);}
      if(edit.material)this.setMaterial(id,edit.material,edit.appearanceFromMaterial===true);
      if(Object.hasOwn(edit,'appearance'))this.setAppearance(id,edit.appearance);
      if(edit.mass)this.setMass(id,edit.mass);
      this.setContact(id,edit);
      this.setDamping(id,edit);
      if(edit.velocity&&e.body)e.body.setLinvel(v(edit.velocity),true);
      if(edit.angularVelocity&&e.body)e.body.setAngvel(v(edit.angularVelocity),true);
    }
  }
  setMass(id,mass){const e=this.find(id);if(!e?.body||e.fixed)return;const previous=e.colliders.reduce((s,c)=>s+c.mass(),0);for(const c of e.colliders)c.setMass(mass*(previous>0?c.mass()/previous:1/e.colliders.length));e.body.recomputeMassPropertiesFromColliders();e.spec.mass=mass;}
  addBox(name,d,position,extra={}) { return this.addRigid({name,parts:[{shape:'box',d,p:[0,0,0]}],position,...extra}); }
  find(id) { return this.entities.find(e=>e.id===id)||this.softs.find(e=>e.id===id); }
  position(id){const e=this.find(id);if(e?.body)return e.body.translation();if(e?.soft){const a=e.soft.particlePositions(),n=a.length/3;let x=0,y=0,z=0;for(let i=0;i<a.length;i+=3){x+=a[i];y+=a[i+1];z+=a[i+2];}return{x:x/n,y:y/n,z:z/n};}return null;}
  moveSoft(id,position){const e=this.find(id),p=this.position(id);if(!e?.soft||!p)return;const a=e.soft.particlePositions().slice();for(let i=0;i<a.length;i+=3){e.soft.setParticlePosition(i/3,{x:a[i]+position.x-p.x,y:a[i+1]+position.y-p.y,z:a[i+2]+position.z-p.z});e.soft.setParticleVelocity(i/3,{x:0,y:0,z:0});}e.spec.position=[position.x,position.y,position.z];}
  remove(id) {
    const e=this.find(id); if(!e||id==='ground') return false;
    this.breakables?.retireBody(id);
    if(e.soft) {for(const c of e.colliders||[])this.colliderEntities.delete(c.handle);this.world.removeSoftBody(e.soft); this.softs=this.softs.filter(x=>x.id!==id); }
    else {for(const c of e.colliders)this.colliderEntities.delete(c.handle);this.world.removeRigidBody(e.body); this.entities=this.entities.filter(x=>x.id!==id);}
    for(const c of this.connections)if(c.aEntity.id===id||c.bEntity.id===id)c.broken=true;
    this.connections=this.connections.filter(c=>c.aEntity.id!==id&&c.bEntity.id!==id);
    this.measurementOrigins.delete(id);this.measured.delete(id);
    return true;
  }
  launch(id='projectile',settings=this.settings) {
    const e=this.find(id); if(!e?.body||e.fixed) return;
    if(this.settings.experiment==='orbit'){
      e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
      const model=new CentralGravity({...this.settings,speed:settings.speed});
      this.orbiters=this.orbiters.filter(o=>o.entity.id!==id);this.orbiters.push({model,entity:e});this.orbit=model;this.launched=true;return;
    }
    e.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
    e.body.setLinvel(launchVector(settings.speed,settings.azimuth,settings.elevation),true);
    e.kinematic=false;
    this.launched=true;
  }
  build() {
    const s=this.settings;
    if(s.experiment==='impact') this.buildRoom();
    if(s.experiment==='cascade') this.buildCascade();
    if(s.experiment==='mechanism') this.buildMechanism();
    if(s.experiment==='soft') this.buildSoft();
    if(s.experiment==='flow') this.buildFlow();
    if(s.experiment==='thermal') this.buildThermal();
    if(s.experiment==='orbit') this.buildOrbit();
  }
  buildRoom() {
    const s=this.settings;
    this.addAsset('table',[0,.86,0],{id:'table',mass:20,material:'wood'});
    this.addAsset('chair',[-2,.96,.45],{id:'chair-left',rotation:[0,.35,0],mass:5});
    this.addAsset('chair',[2,.96,-.2],{id:'chair-right',rotation:[0,-.6,0],mass:5});
    this.addAsset('shelf',[-3.7,1.43,-2.4],{mass:12});
    this.addAsset('stool',[3.2,.53,2.1],{mass:4});
    this.addAsset('bowl',[-.65,1.97,.1],{id:'bowl',mass:1.1,material:'ceramic'});
    this.addAsset('mug',[.62,2.15,-.3],{mass:.5,material:'ceramic'});
    for(let j=0;j<3;j++)this.addAsset('book',[.4,1.9+j*.22,.3],{mass:.6,rotation:[0,j*.13,0]});
    for(let i=0;i<5;i++)this.addAsset('brick',[(i-2)*.77,.18,-2.2],{mass:1.1,material:'ceramic'});
    this.addAsset('ball',[0,2.1,4.25],{id:'projectile',name:'Снаряд',material:s.material,mass:s.mass||12,scale:1.3,kinematic:true,color:s.material==='metal'?'#667d7c':'#d47d54'});
    this.actions.push({time:.45,run:()=>this.launch()});
  }
  buildCascade() {
    const s=this.settings;
    const gap=s.gap||.38;
    for(let branch=0;branch<2;branch++)for(let i=0;i<20;i++) {
      const z=3.5-i*gap;
      const x=(branch===0?-1:1)*(1.1+Math.sin(i*.19)*.55);
      const yaw=(branch===0?1:-1)*Math.atan(.55*.19*Math.cos(i*.19)/gap);
      this.addAsset('domino',[x,.51,z],{id:`domino-${branch}-${i}`,material:s.material,mass:s.material==='cork'?.12:.45,rotation:[0,yaw,0]});
    }
    this.addAsset('ball',[-1.1,.62,5.15],{id:'projectile',material:'rubber',scale:.8,mass:2,kinematic:true});
    this.addAsset('ball',[1.1,.62,5.15],{id:'projectile-b',material:'rubber',scale:.8,mass:2,kinematic:true});
    this.actions.push({time:.35,run:()=>{this.launch('projectile',{speed:3.5,azimuth:180,elevation:0});this.launch('projectile-b',{speed:3.5,azimuth:180,elevation:0});}});
    for(let j=0;j<3;j++)for(let k=0;k<3-j;k++)this.addAsset('cube',[k*.56-.6,j*.54+.28,3.5-20*gap-.6],{scale:.52,mass:.35,material:'wood'});
  }
  buildMechanism() {
    const s=this.settings;
    const base=this.addBox('Опора рычага',[1.3,.72,.38],[0,.36,0],{fixed:true,material:'metal',color:'#456c7e'});
    const lever=this.addBox('Рычаг',[1.6,.16,4.4],[0,.81,0],{id:'lever',mass:8,material:'wood',color:'#dbab68'});
    this.world.createImpulseJoint(RAPIER.JointData.revolute({x:0,y:.45,z:0},{x:0,y:0,z:0},{x:1,y:0,z:0}),base.body,lever.body,true).setContactsEnabled(false);
    this.addBox('Упор рычага',[1.65,.10,.15],[0,.065,-2.12],{fixed:true,material:'metal'});
    this.addBox('Упор рычага',[1.65,.10,.15],[0,.065,2.12],{fixed:true,material:'metal'});
    this.addAsset('ball',[0,1.25,-1.65],{id:'payload',name:'Подбрасываемый груз',mass:.8,scale:.65,material:'rubber',color:'#57b9bf'});
    const drop=this.addAsset('ball',[0,.89+.55+(s.dropHeight||2.4),1.65],{id:'projectile',name:'Падающий груз',mass:s.mass,scale:1.1,material:'metal',color:'#e77c43',kinematic:true});
    this.actions.push({time:.4,run:()=>{drop.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);drop.body.setLinvel({x:0,y:0,z:0},true);drop.kinematic=false;}});
    this.payloadApex=1.25;
  }
  buildSoft() {
    const s=this.settings, mat=MATERIALS[s.material]||MATERIALS.jelly;
    this.addBox('Стол пресса',[4,.3,3.4],[0,.16,0],{fixed:true,material:'metal',color:'#344e4b',visualParts:compressionFixtureParts('table')});
    const m=new RAPIER.SoftBodyMaterial();
    m.youngModulus=mat.young||1400; m.poissonRatio=mat.poisson||.35;
    m.elasticDampingRatio=mat.damping??.25;
    m.plasticYield=mat.plasticYield||0; m.plasticCreep=mat.plasticCreep||0; m.plasticMax=.9;
    const desc=RAPIER.SoftBodyDesc.cuboid({x:0,y:1.055,z:0},{x:.7,y:.7,z:.7},5,5,5)
      .setMass(3).setCellModel(RAPIER.SoftBodyCellModel.Corotational)
      .setSolver(RAPIER.SoftBodySolver.Constraints).setMaterial(m).setParticleRadius(.025)
      .setAdditionalSolverIterations(8).setLinearDamping(.35).setCanSleep(false);
    const soft=this.world.createSoftBody(desc);
    this.softs.push({id:'specimen',name:mat.name,soft,material:s.material,parts:[],spec:{id:'specimen',asset:'softcube',material:s.material},fixed:false});
    const press=this.addBox('Плита пресса',[2.5,.24,2.5],[0,2.4,0],{id:'press',kinematic:true,material:'metal',color:'#ced2c4',visualParts:compressionFixtureParts('press')});
    for(const x of [-1.65,1.65])this.addBox('Направляющая',[.10,3.7,.1],[x,1.95,-1.2],{fixed:true,material:'metal',visualParts:compressionFixtureParts('guide',{side:Math.sign(x)})});
    this.addBox('Траверса',[3.55,.16,.24],[0,3.75,-1.2],{fixed:true,material:'metal',visualParts:compressionFixtureParts('beam')});
    this.press=press;
  }
  buildFlow() {
    const s=this.settings, theta=s.slope*Math.PI/180;
    const y=1.9;
    this.addBox('Дно желоба',[2.5,.14,6.3],[0,y,.4],{fixed:true,rotation:[-theta,0,0],material:'ceramic',color:'#d2d4c7'});
    for(const x of [-1.25,1.25])this.addBox('Борт желоба',[.1,.65,6.3],[x,y+.3,.4],{fixed:true,rotation:[-theta,0,0],material:'ceramic',color:'#c4cbbe'});
    this.addAsset('basin',[0,.56,-4.1],{fixed:true,material:'ceramic',scale:.9,color:'#527b75'});
    for(const x of [-.9,.9])this.addBox('Ножка',[.12,1.8,.12],[x,.9,.4],{fixed:true,material:'metal'});
    this.addAsset('funnel-bin',[0,5.3,2.95],{id:'fluid-source',name:'Источник потока',fixed:true,scale:.75,material:'metal',color:'#6e9eac'});
    this.fluid=new ParticleFluid(s);
  }
  buildThermal(){
    this.thermal=new HeatPenetration(this.settings);
    const t=this.thermal;
    this.thermalEntity=this.addRigid({id:'hot-ball',name:'Раскалённый шар',parts:[{shape:'sphere',d:[t.r],p:[0,0,0],color:'#ed571e'}],position:[0,t.y,0],kinematic:true,material:'metal',mass:t.mass});
    this.addBox('Основание',[1.05,.08,.85],[0,.04,-.06],{fixed:true,material:'metal',color:'#29475c'});
    for(const x of [-.30,.30])this.addBox('Опора льда',[.07,.15,.45],[x,.145,-.13],{fixed:true,material:'ceramic'});
    this.surfaces.push({id:'ice-cutaway',name:'Лёд в разрезе',material:'ice',geometry:()=>this.thermal.geometry()});
  }
  buildOrbit(){
    this.world.gravity={x:0,y:0,z:0};
    this.orbit=new CentralGravity(this.settings);
    const radius=this.orbit.planet.radius/this.orbit.unit;
    this.addRigid({id:'planet',name:this.orbit.planet.name,parts:[{shape:'sphere',d:[radius],p:[0,0,0],color:'#9faeb6'}],position:[0,0,0],fixed:true,material:'ceramic'});
    const entity=this.addAsset(this.settings.orbitAsset||'brick',this.orbit.position(),{id:'projectile',name:'Орбитальный снаряд',kinematic:true,scale:.36,mass:this.settings.mass||3,material:'rubber',color:'#f2804f'});
    this.orbiters.push({model:this.orbit,entity});
    this.surfaces.push({id:'orbit-trail',name:'Траектория',material:'rubber',color:'#55c5d8',geometry:()=>this.orbit.geometry()});
  }
  step(dt=1/120) {
    this.time+=dt;
    for(const action of this.actions)if(!action.done&&this.time>=action.time){action.done=true;action.run();}
    if(this.press) {
      const t=this.time, down=Math.min(this.settings.depth||1.15,1.55);
      let y=2.4;
      if(t>.6&&t<2.6)y=2.4-down*Math.min(1,(t-.6)/1.6);
      else if(t>=2.6&&t<3.4)y=2.4-down;
      else if(t>=3.4&&t<4.8)y=2.4-down*(1-(t-3.4)/1.4);
      this.press.body.setNextKinematicTranslation({x:0,y,z:0});
    }
    this.world.timestep=dt;
    this.surfaceMotion?.beforeStep(dt);
    this.atmosphere?.setLegacyWindSpeed(this.settings.windSpeed||0);
    if(this.settings.windSpeed&&this.settings.experiment!=='orbit')for(const e of this.entities)if(!e.fixed&&!e.kinematic&&e.body.isEnabled()&&!this.atmosphere?.ownsAerodynamics(e)){
      const b=e.body,vel=b.linvel(),wind=this.settings.windSpeed;const dx=wind-vel.x,dy=-vel.y,dz=-vel.z,speed=Math.hypot(dx,dy,dz),area=Math.max(.03,Math.min(4,e.parts.reduce((s,p)=>s+volume(p),0)**(2/3)*e.scale*e.scale));
      b.resetForces(false);const force=.5*1.225*.8*area*speed;b.addForce({x:force*dx,y:force*dy,z:force*dz},true);
    }
    this.atmosphere?.beforeStep(dt);
    this.breakables?.beforeStep(dt);
    // Buoyancy is already in userForce when the graph samples external loads.
    // The separate drag half-impulses also enter its approximate load ledger.
    const graphLoads=loads=>{if(this.breakables)for(const[id,force]of loads||[]){const old=this.breakables.baseLoads.get(id);if(old)this.breakables.baseLoads.set(id,old.map((v,i)=>v+force[i]));}};
    const contactLoads=this.breakables?[]:null;
    this.world.step(this.events);
    this.surfaceMotion?.afterStep();
    this.events.drainContactForceEvents(event=>{
      if(contactLoads)contactLoads.push(copyContactForceEvent(event));
      const a=this.colliderEntities.get(event.collider1()),b=this.colliderEntities.get(event.collider2()),force=event.totalForceMagnitude();
      const bodyMass=e=>e?.fixed?0:(e?.body?.mass()??e?.soft?.mass()??0),threshold=Math.max(60,(bodyMass(a)+bodyMass(b))*this.settings.gravity*2.5);
      const key=[a?.id||'',b?.id||''].sort().join(':');
      if(this.impacts.length<2000&&force>threshold&&this.time-(this.lastContact.get(key)||-1)>.09){
        const pa=a?.body?.translation()||(a?.soft?this.position(a.id):null),pb=b?.body?.translation()||(b?.soft?this.position(b.id):null);this.lastContact.set(key,this.time);
        this.impacts.push({t:this.time,type:'impact',strength:Math.min(1,force*dt/50),participants:[a?.id,b?.id].filter(Boolean),position:pa&&pb?[(pa.x+pb.x)/2,(pa.y+pb.y)/2,(pa.z+pb.z)/2]:[0,1,0]});
      }
    });
    this.atmosphere?.afterStep(dt);graphLoads(this.atmosphere?.dragForces);
    this.breakables?.afterStep(dt,this.time,contactLoads);
    if(this.fluid)this.fluid.step(dt,this.time);
    if(this.thermal){this.thermal.step(dt);this.thermalEntity.body.setTranslation({x:0,y:this.thermal.y,z:0},true);}
    this.penetration?.update(this.time);
    for(const {model,entity}of this.orbiters){model.step(dt);const p=model.position();entity.body.setTranslation({x:p[0],y:p[1],z:p[2]},true);}
    if(this.payloadApex!==undefined){const payload=this.find('payload');if(payload)this.payloadApex=Math.max(this.payloadApex,payload.body.translation().y);}
    for(const e of this.entities)if(!e.internal&&!e.fixed&&e.id!==this.measurementFocus&&e.body.isEnabled()){
      const p=e.body.translation(),start=this.measurementOrigins.get(e.id);if(start&&!this.measured.has(e.id)&&Math.hypot(p.x-start[0],p.y-start[1],p.z-start[2])>this.measurementThreshold)this.measured.set(e.id,this.time);
    }
    for(const rig of this.motionRigs||[])rig.update(dt,this.surfaceMotion?.entity===rig.entity?this.surfaceMotion.snapshot():{phase:'dynamic'});
  }
  resetMeasurements(focusId=(this.settings.comparison?.enabled===true?this.settings.comparison.targetId:'')||this.settings.focusId||'',threshold=this.settings.story?.movementThreshold??.2){
    this.measurementFocus=focusId;this.measurementThreshold=Number.isFinite(threshold)?Math.max(.01,Math.min(2,threshold)):.2;this.measured.clear();this.measurementOrigins.clear();
    for(const e of this.entities)if(!e.internal){const p=e.body.translation();this.measurementOrigins.set(e.id,[p.x,p.y,p.z]);}
  }
  measuredChanges(){return[...this.measured].filter(([id,t])=>this.time-t<.35).map(([id])=>id);}
  stats() {
    let energy=0,moving=0;
    for(const e of this.entities)if(!e.fixed&&!e.kinematic){const vv=e.body.linvel();const w=e.body.angvel();const speed2=vv.x**2+vv.y**2+vv.z**2;energy+=.5*e.body.mass()*speed2;if(speed2+w.x*w.x+w.y*w.y+w.z*w.z>.015)moving++;}
    const scope=this.settings.measurement?.objectIds;
    const movedObjects=Array.isArray(scope)&&scope.length?scope.filter(id=>this.measured.has(id)).length:this.measured.size;
    const breakage=this.breakables?{loadModel:'contact-graph',total:this.breakables.bonds.length,broken:this.breakables.bonds.filter(b=>b.broken).length,retired:this.breakables.bonds.filter(b=>b.retired).length}:undefined;
    return {...(breakage?{breakage,breakEvents:this.fractureEvents.filter(e=>this.time-e.time<.1).map(e=>({...e}))}:{}),time:this.time,objects:this.entities.filter(e=>!e.internal).length-1+this.softs.length,moving,energy,particles:this.fluid?.particles.length||0,apex:this.payloadApex,movedObjects,readouts:modelReadouts(this),...(this.atmosphere?.settings.enabled?{atmosphere:this.atmosphere.snapshot()}: {}),...(this.surfaceMotion?{surfaceMotion:this.surfaceMotion.snapshot()}: {})};
  }
  assemblyState(){return this.breakables?.snapshot()||null;}
  dispose(){const world=this.world,events=this.events;try{for(const rig of this.motionRigs||[])rig.dispose();this.motionRigs=[];this.breakables?.dispose();}finally{this.breakables=null;this.world=null;this.events=null;try{world?.free();}finally{events?.free();}}}
}

function rotate(v,q) {
  const ix=q.w*v.x+q.y*v.z-q.z*v.y,iy=q.w*v.y+q.z*v.x-q.x*v.z,iz=q.w*v.z+q.x*v.y-q.y*v.x,iw=-q.x*v.x-q.y*v.y-q.z*v.z;
  return {x:ix*q.w+iw*-q.x+iy*-q.z-iz*-q.y,y:iy*q.w+iw*-q.y+iz*-q.x-ix*-q.z,z:iz*q.w+iw*-q.z+ix*-q.y-iy*-q.x};
}

// Clavet-style double-density relaxation. This is a separate, simplified fluid
// model; the prepared chute and basin are one-way collision boundaries.
export class ParticleFluid {
  constructor(settings) {
    this.settings=settings;this.particles=[];this.emitted=0;this.clock=0;
    this.h=.27;this.radius=.065;this.viscosity=MATERIALS[settings.material]?.viscosity??.03;
    this.seed=settings.seed||42;
    for(let n=0;n<40;n++)this.particles.push({x:(n%4-1.5)*.11,y:4.66+Math.floor(n/8)*.09,z:2.9+Math.floor(n%8/4)*.12,vx:0,vy:0,vz:-.1,ox:0,oy:0,oz:0});
  }
  rand(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  floor(z){return 1.9+Math.tan(this.settings.slope*Math.PI/180)*(z-.4)+.07;}
  constrain(p) {
    const r=this.radius;
    if(p.z>-2.55&&p.z<3.5){
      p.x=Math.max(-1.15+r,Math.min(1.15-r,p.x));
      const bed=this.floor(p.z)+r;
      if(p.y<bed){const slope=Math.tan(this.settings.slope*Math.PI/180),penetration=p.y-bed,denom=1+slope*slope;p.y-=penetration/denom;p.z+=penetration*slope/denom;}
    } else if(p.z<=-2.55) {
      p.x=Math.max(-1.68+r,Math.min(1.68-r,p.x));
      p.z=Math.max(-5.36+r,p.z);
      p.y=Math.max(.12+r,p.y);
    }
    p.y=Math.max(.1,p.y);
    p.x=Math.max(-2.3,Math.min(2.3,p.x));
  }
  step(dt,time) {
    this.clock+=dt;
    if(this.clock<1/120-1e-8)return;
    const hdt=this.clock; this.clock=0;
    const p=this.particles,h=this.h,h2=h*h;
    const target=Math.min(840,Math.max(0,Math.floor((Math.min(time,6.3)-.3)*140)));
    while(p.length<target){const n=p.length;p.push({x:(n%4-1.5)*.125+(this.rand()-.5)*.008,y:Math.max(4.6,this.floor(3)+.7)+Math.floor(n%16/4)*.095,z:2.9+this.rand()*.12,vx:0,vy:0,vz:-.25,ox:0,oy:0,oz:0});}
    for(const a of p){a.ox=a.x;a.oy=a.y;a.oz=a.z;a.vy-=this.settings.gravity*hdt;a.x+=a.vx*hdt;a.y+=a.vy*hdt;a.z+=a.vz*hdt;}
    for(let iteration=0;iteration<2;iteration++){
      const cells=new Map();
      const key=(x,y,z)=>`${x},${y},${z}`;
      for(let i=0;i<p.length;i++){const a=p[i],k=key(Math.floor(a.x/h),Math.floor(a.y/h),Math.floor(a.z/h));if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}
      for(let i=0;i<p.length;i++) {
        const a=p[i],cx=Math.floor(a.x/h),cy=Math.floor(a.y/h),cz=Math.floor(a.z/h);let density=0,near=0;const neighbors=[];
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of cells.get(key(cx+x,cy+y,cz+z))||[])if(i!==j){
          const b=p[j],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,dist2=dx*dx+dy*dy+dz*dz;
          if(dist2<h2&&dist2>1e-10){const dist=Math.sqrt(dist2),q=1-dist/h;density+=q*q;near+=q*q*q;neighbors.push([j,dx/dist,dy/dist,dz/dist,q]);}
        }
        const pressure=60*(density-2.8),nearPressure=250*near;
        let dx=0,dy=0,dz=0;
        for(const [j,nx,ny,nz,q] of neighbors){const d=Math.max(-.0015,Math.min(.0015,hdt*hdt*(pressure*q+nearPressure*q*q)*.5));p[j].x+=nx*d;p[j].y+=ny*d;p[j].z+=nz*d;dx-=nx*d;dy-=ny*d;dz-=nz*d;}
        a.x+=dx;a.y+=dy;a.z+=dz;
      }
      for(const a of p)this.constrain(a);
    }
    for(const a of p){a.vx=(a.x-a.ox)/hdt;a.vy=(a.y-a.oy)/hdt;a.vz=(a.z-a.oz)/hdt;}
    // Frame-rate-independent local XSPH smoothing; high viscosity also damps
    // motion relative to the channel floor instead of changing gravity.
    const alpha=1-Math.exp(-this.viscosity*34*hdt);
    const cells=new Map();
    for(let i=0;i<p.length;i++){const a=p[i],k=`${Math.floor(a.x/h)},${Math.floor(a.y/h)},${Math.floor(a.z/h)}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}
    const velocities=p.map(a=>[a.vx,a.vy,a.vz]);
    for(let i=0;i<p.length;i++){
      const a=p[i];let sx=0,sy=0,sz=0,sw=0;const cx=Math.floor(a.x/h),cy=Math.floor(a.y/h),cz=Math.floor(a.z/h);
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of cells.get(`${cx+x},${cy+y},${cz+z}`)||[])if(i!==j){const b=p[j],d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);if(d<h){const w=1-d/h;sx+=velocities[j][0]*w;sy+=velocities[j][1]*w;sz+=velocities[j][2]*w;sw+=w;}}
      if(sw){a.vx+=(sx/sw-a.vx)*alpha;a.vy+=(sy/sw-a.vy)*alpha;a.vz+=(sz/sw-a.vz)*alpha;}
      if(a.z>-2.55&&Math.abs(a.y-this.floor(a.z)-this.radius)<.07){const slope=Math.tan(this.settings.slope*Math.PI/180),norm=Math.hypot(1,slope),ny=1/norm,nz=-slope/norm,vn=a.vy*ny+a.vz*nz;a.vy-=vn*ny;a.vz-=vn*nz;const drag=Math.exp(-this.viscosity*14*hdt);a.vx*=drag;a.vz*=drag;}
      if(a.z<=-2.55&&a.y<.12+this.radius+.06)a.vy=Math.min(.1,Math.max(0,a.vy));
      const speed=Math.hypot(a.vx,a.vy,a.vz);if(speed>6){a.vx*=6/speed;a.vy*=6/speed;a.vz*=6/speed;}
    }
  }
}
