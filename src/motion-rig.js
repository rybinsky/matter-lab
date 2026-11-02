import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export const MOTION_RIG_PREFIX='__motion-rig:';
const UP=new THREE.Vector3(0,1,0),TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=x=>x*x*(3-2*x);
const vector=(value,fallback=[0,0,0])=>new THREE.Vector3(...(Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)?value:fallback));
const plain=v=>({x:v.x,y:v.y,z:v.z}),quat=q=>({x:q.x,y:q.y,z:q.z,w:q.w});
const color={shirt:'#18BCAF',panel:'#67E4D5',shorts:'#18364E',shoe:'#F0F3F0',sole:'#263E52',accent:'#FF835C',skin:'#C88F6C',hair:'#253344'};
const box=(d,p,c)=>({shape:'box',d,p,color:c}),sphere=(r,p,c)=>({shape:'sphere',d:[r],p,color:c}),cylinder=(r,h,p,c,rotation)=>({shape:'cylinder',d:[r,h],p,color:c,...(rotation?{r:rotation}:{})});
const scaled=(parts,s)=>parts.map(part=>({...part,d:part.d.map(v=>v*s),p:part.p.map(v=>v*s)}));

/** A collision proxy, not a biomechanical model. Its local origin is the feet. */
export function runnerActorSpec({id='runner',name='Бегун',height=1.75,mass=70,position=[0,0,0],...extra}={}){
 if(!Number.isFinite(height)||height<.5||height>3||!Number.isFinite(mass)||mass<=0)throw Error('Бегун: нужны положительная масса и рост от0,5до3м.');
 const s=height/1.75;
 return{id,name,asset:'custom',material:'wood',mass,position,parts:[box([.34*s,height,.24*s],[0,height/2,0],'#657A89')],friction:.6,restitution:0,...extra,visualRig:{...(extra.visualRig||{}),type:'runner',height,orientation:extra.visualRig?.orientation??'alongVelocity'}};
}
export function createRunnerActor(id,options={}){return runnerActorSpec({...options,id});}

function torsoParts(s){return scaled([
 box([.32,.19,.20],[0,-.055,0],color.shorts),box([.30,.12,.19],[0,.055,0],color.shirt),
 box([.37,.43,.22],[0,.295,0],color.shirt),sphere(.078,[-.17,.44,0],color.shirt),sphere(.078,[.17,.44,0],color.shirt),
 box([.14,.34,.006],[0,.30,.113],color.panel),box([.006,.28,.004],[0,.35,.119],'#E5FBF7'),
 box([.12,.015,.006],[.10,.31,.116],color.accent),cylinder(.052,.10,[0,.59,0],color.skin),
 sphere(.115,[0,.745,0],color.skin),sphere(.081,[0,.684,.006],color.skin),
 cylinder(.116,.05,[0,.85,-.008],color.hair),box([.22,.015,.10],[0,.827,.10],color.hair),
 box([.16,.10,.025],[0,.75,-.103],color.hair),
 ],s);}
function limbParts(kind,length,s){
 const h=length/s;
 if(kind==='thigh')return scaled([cylinder(.064,h,[0,0,0],color.skin),cylinder(.081,.18,[0,-h/2+.09,0],color.shorts),sphere(.061,[0,h/2,0],color.skin)],s);
 if(kind==='shin')return scaled([cylinder(.044,h,[0,0,0],color.skin),cylinder(.049,.11,[0,h/2-.055,0],'#EAF0EE'),sphere(.044,[0,-h/2,0],color.skin)],s);
 if(kind==='upper-arm')return scaled([cylinder(.055,h,[0,0,0],color.shirt),sphere(.052,[0,-h/2,0],color.shirt),sphere(.043,[0,h/2,0],color.skin)],s);
 return scaled([cylinder(.035,h,[0,0,0],color.skin),sphere(.033,[0,h/2,0],color.skin),box([.065,.09,.045],[0,h/2+.035,.012],color.skin)],s);
}
function shoeParts(s){return scaled([
 box([.12,.045,.27],[0,-.072,.055],color.sole),box([.116,.067,.24],[0,-.025,.06],color.shoe),
 box([.105,.035,.07],[0,-.025,-.04],color.accent),box([.075,.007,.09],[0,.012,.045],'#627C8E'),
 ...[-.025,0,.025].map(z=>box([.082,.006,.006],[0,.017,.045+z],'#F7FAF8')),
 ],s);}

function twoBone(a,b,upper,lower,bendDirection){
 const delta=b.clone().sub(a),distance=clamp(delta.length(),.00001,upper+lower-.00001),direction=delta.normalize();
 const along=(upper*upper-lower*lower+distance*distance)/(2*distance),rise=Math.sqrt(Math.max(0,upper*upper-along*along));
 let bend=bendDirection.clone().addScaledVector(direction,-bendDirection.dot(direction));if(bend.lengthSq()<1e-8)bend=new THREE.Vector3(1,0,0).cross(direction);bend.normalize();
 return a.clone().addScaledVector(direction,along).addScaledVector(bend,rise);
}

/** Render-only segmented runner driven by a physical body's snapshot.
 * No root transform, collider, velocity, mass, force, torque or joint is written.
 * Helpers are ordinary captured poses with no colliders; gait is illustration.
 */
export function createMotionRig(lab,entity,config=entity?.spec?.visualRig){
 if(!lab?.world||!Array.isArray(lab.entities)||!entity?.body)throw Error('Для фигуры нужен физический мир и корневое тело.');
 const options={type:'runner',height:1.75,orientation:'alongVelocity',...config};
 if(options.type!=='runner'||!Number.isFinite(options.height)||options.height<.5||options.height>3||!['alongVelocity','body'].includes(options.orientation))throw Error('Некорректный визуальный бегун.');
 const height=options.height,s=height/1.75,stride=options.strideLength??1.35*s;
 if(!Number.isFinite(stride)||stride<.25||stride>4)throw Error('Длина визуального шага — от0,25до4м.');
 const oldParts=entity.visualParts,hadParts=Object.hasOwn(entity,'visualParts'),oldHidden=entity.renderHidden,hadHidden=Object.hasOwn(entity,'renderHidden');
 const helpers=[],rootParts=torsoParts(s),prefix=MOTION_RIG_PREFIX+entity.id+':';
 if(lab.entities.some(e=>e.id.startsWith(prefix)))throw Error('Визуальная фигура этого предмета уже создана.');
 entity.visualParts=rootParts.map(part=>({...part,p:[part.p[0],part.p[1]+height/2,part.p[2]]}));entity.renderHidden=true;
 function helper(name,parts){
  const id=prefix+name;if(lab.entities.some(e=>e.id===id))throw Error('Визуальная фигура этого предмета уже создана.');
  const p=entity.body.translation(),body=lab.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y,p.z));
  const e={id,name:'Визуальная фигура · '+name,asset:'custom',body,colliders:[],parts,material:'rubber',appearance:{roughness:.68,metalness:0},scale:1,fixed:true,kinematic:true,internal:true,editable:false,selectable:false,renderOnly:true,rigOwnerId:entity.id,spec:{id,internal:true,renderOnly:true,rigOwnerId:entity.id,fixed:true,kinematic:true}};
  lab.entities.push(e);helpers.push(e);return e;
 }
 const core=helper('torso-head',rootParts),links={};
 const lengths={thigh:.39*s,shin:.38*s,upperArm:.29*s,forearm:.27*s};
 for(const side of['left','right']){
  links[side]={thigh:helper(side+'-thigh',limbParts('thigh',lengths.thigh,s)),shin:helper(side+'-shin',limbParts('shin',lengths.shin,s)),shoe:helper(side+'-shoe',shoeParts(s)),upperArm:helper(side+'-upper-arm',limbParts('upper-arm',lengths.upperArm,s)),forearm:helper(side+'-forearm',limbParts('forearm',lengths.forearm,s))};
 }
 let disposed=false,distance=0,phase=0,blend=0,yaw=0,visualBasis=new THREE.Quaternion(),lastPhase=null,releaseOffset=null,contactBodyQ=null;
 const offset=new THREE.Vector3(0,height/2,0),origin=new THREE.Vector3();
 const worldPoint=(local,basis)=>local.clone().add(offset).applyQuaternion(basis).add(origin);
 function pose(e,position,rotation){e.body.setTranslation(plain(position),false);e.body.setRotation(quat(rotation),false);e.body.setNextKinematicTranslation(plain(position));e.body.setNextKinematicRotation(quat(rotation));}
 function bone(e,a,b,basis){const start=worldPoint(a,basis),end=worldPoint(b,basis),direction=end.clone().sub(start).normalize();pose(e,start.add(end).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(UP,direction));}
 const api={entity,height,helpers,
  update(dt,snapshot={}){
   if(disposed)return;dt=Number.isFinite(dt)?clamp(dt,0,.2):0;
   if(!snapshot||typeof snapshot!=='object')snapshot={};
   const bodyQ=entity.body.rotation(),physicalQ=new THREE.Quaternion(bodyQ.x,bodyQ.y,bodyQ.z,bodyQ.w),p=entity.body.translation(),v=entity.body.linvel();
   origin.copy(vector(snapshot.bodyPosition,[p.x,p.y,p.z]));const velocity=vector(snapshot.bodyVelocity??snapshot.velocity,[v.x,v.y,v.z]),speed=velocity.length(),contact=snapshot.phase==='contact';
   const enabled=entity.body.isEnabled();for(const e of helpers)e.body.setEnabled(enabled);if(!enabled)return;
   if(contact){
    distance+=speed*dt;phase=(phase+TAU*speed*dt/stride)%TAU;releaseOffset=null;
    if(options.orientation==='alongVelocity'){
     if(Math.hypot(velocity.x,velocity.z)>1e-5){const target=Math.atan2(velocity.x,velocity.z),difference=Math.atan2(Math.sin(target-yaw),Math.cos(target-yaw));yaw+=difference*(dt===0||lastPhase!=='contact'?1:1-Math.exp(-dt/.10));}
     visualBasis.setFromAxisAngle(UP,yaw);
    }else visualBasis.copy(physicalQ);
    contactBodyQ=physicalQ.clone();
   }else{
    if(!releaseOffset)releaseOffset=(contactBodyQ||physicalQ).clone().invert().multiply(visualBasis);
    visualBasis.copy(physicalQ).multiply(releaseOffset);
   }
   const desired=contact?clamp(speed/.7,0,1):0;blend+= (desired-blend)*(dt===0?1:1-Math.exp(-dt/.10));
   const bob=.018*s*Math.cos(phase*2)*blend,lean=(.10+Math.min(.10,speed*.015))*blend,coreLocal=new THREE.Quaternion().setFromEuler(new THREE.Euler(lean,0,.025*Math.sin(phase)*blend)),coreQ=visualBasis.clone().multiply(coreLocal);
   const corePosition=offset.clone().add(new THREE.Vector3(0,bob,0)).applyQuaternion(visualBasis).add(origin);pose(core,corePosition,coreQ);
   const normal=vector(snapshot.normal,[0,1,0]).normalize(),support=vector(snapshot.position,[p.x,p.y,p.z]);
   for(const[side,sign]of[['left',-1],['right',1]]){
    const u=((phase/TAU+(sign>0?.5:0))%1+1)%1,stance=.42,amplitude=stride*stance/2;
    let z,lift;if(u<stance){z=amplitude*(1-2*u/stance);lift=0;}else{const t=(u-stance)/(1-stance);z=-amplitude+2*amplitude*smooth(t);lift=.16*s*Math.sin(Math.PI*t);}
    z*=blend;lift*=blend;
    const hip=new THREE.Vector3(sign*.115*s,-.07*s,0).applyQuaternion(coreLocal).add(new THREE.Vector3(0,bob,0)),ankle=new THREE.Vector3(sign*.115*s,-.775*s+lift,z);
    if(contact&&normal.y>.15){
     const ground=worldPoint(new THREE.Vector3(ankle.x,-height/2,ankle.z),visualBasis);ground.y=support.y-(normal.x*(ground.x-support.x)+normal.z*(ground.z-support.z))/normal.y+.10*s+lift;
     ankle.copy(ground.sub(origin).applyQuaternion(visualBasis.clone().invert()).sub(offset));
    }
    const reach=ankle.clone().sub(hip),maximumReach=lengths.thigh+lengths.shin-.0001;
    if(reach.length()>maximumReach)ankle.copy(hip).add(reach.setLength(maximumReach));
    const knee=twoBone(hip,ankle,lengths.thigh,lengths.shin,new THREE.Vector3(0,0,1)),leg=links[side];bone(leg.thigh,hip,knee,visualBasis);bone(leg.shin,knee,ankle,visualBasis);
    pose(leg.shoe,worldPoint(ankle,visualBasis),visualBasis.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),u<stance?0:-.18*Math.sin(Math.PI*(u-stance)/(1-stance))*blend)));
    const shoulder=new THREE.Vector3(sign*.215*s,.43*s,0).applyQuaternion(coreLocal).add(new THREE.Vector3(0,bob,0)),hand=new THREE.Vector3(sign*.24*s,.025*s,sign*.21*s*Math.cos(phase)*blend),elbow=twoBone(shoulder,hand,lengths.upperArm,lengths.forearm,new THREE.Vector3(sign*.35,0,-1));
    bone(leg.upperArm,shoulder,elbow,visualBasis);bone(leg.forearm,elbow,hand,visualBasis);
   }
   lastPhase=snapshot.phase??'dynamic';
  },
  snapshot(){return{type:'runner',height,distance,gaitPhase:phase,gaitBlend:blend,phase:lastPhase,visualOnly:true,helpers:helpers.length,rootPoseWritten:false};},
  dispose(){if(disposed)return;disposed=true;for(const helper of helpers){const index=lab.entities.indexOf(helper);if(index>=0)lab.entities.splice(index,1);if(lab.world)lab.world.removeRigidBody(helper.body);}if(hadParts)entity.visualParts=oldParts;else delete entity.visualParts;if(hadHidden)entity.renderHidden=oldHidden;else delete entity.renderHidden;},
 };
 const initial=entity.body.rotation();visualBasis.set(initial.x,initial.y,initial.z,initial.w);api.update(0,{phase:'dynamic'});return api;
}
