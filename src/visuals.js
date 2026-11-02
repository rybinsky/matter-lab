import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MATERIALS, EXPERIMENTS, assetParts } from './catalog.js';
import { quat } from './layouts.js';
import { planCamera } from './cinematography.js';
import { objectBounds, chooseHero } from './scene-analysis.js';
import { assetSurface } from './asset-surfaces.js';
import { specimenAppearance } from './lab-fixtures.js';
import {normalizeContextView,contextViewRect} from './context-view.js';
import {resolveSceneAnnotations} from './scene-annotations.js';

const finiteVector = value => value?.length === 3 && value.every(Number.isFinite);
function pointCloudBounds(points, padding = 0) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3) {
    if (![points[i], points[i + 1], points[i + 2]].every(Number.isFinite)) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], points[i + k]); hi[k] = Math.max(hi[k], points[i + k]); }
  }
  if (!Number.isFinite(lo[0])) return null;
  return { position: lo.map((v, k) => (v + hi[k]) / 2), bounds: lo.map((v, k) => Math.max(.03, hi[k] - v + padding * 2)) };
}

const geometries=new Map();
function geometry(p) {
  const key=p.shape+JSON.stringify(p.d);
  if(geometries.has(key))return geometries.get(key);
  let g;
  if(p.shape==='sphere')g=new THREE.SphereGeometry(p.d[0],32,24);
  else if(p.shape==='ellipsoid'){g=new THREE.SphereGeometry(1,28,20);g.scale(...p.d);}
  else if(p.shape==='cylinder')g=new THREE.CylinderGeometry(p.d[0],p.d[0],p.d[1],32);
  else if(p.shape==='cone')g=new THREE.ConeGeometry(p.d[0],p.d[1],32);
  else if(p.shape==='torus'){g=new THREE.TorusGeometry(p.d[0],p.d[1],12,40);g.rotateX(Math.PI/2);}
  else if(p.shape==='icosa')g=new THREE.IcosahedronGeometry(p.d[0],0);
  else g=new RoundedBoxGeometry(...p.d,2,Math.min(.035,...p.d.map(n=>n*.14)));
  geometries.set(key,g); return g;
}
export function objectVisual(parts,materialId='ceramic',color,assetId,appearance=null,surfaceOverride=null) {
  const group=new THREE.Group(),preset=MATERIALS[materialId]||MATERIALS.ceramic;
  const look=appearance||{};
  const surface=surfaceOverride||assetSurface(assetId);
  if(surface){
    const key=surfaceOverride?null:'surface:'+assetId;let g=key?geometries.get(key):null;
    if(!g){g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(surface.positions,3));g.setIndex(surface.indices);g.computeVertexNormals();if(key)geometries.set(key,g);}
    const skin=surface.finish==='skin';
    const mat=new THREE.MeshPhysicalMaterial({color:look.color??color??surface.color??preset.color,roughness:look.roughness??(skin ? .5 : preset.roughness??.5),metalness:look.metalness??(skin ? 0 : preset.metalness??0),clearcoat:skin ? .08 : 0,clearcoatRoughness:.32});
    const mesh=new THREE.Mesh(g,mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  for(const p of surface?.details||parts){
    const skin=p.finish==='skin';
    const mat=new THREE.MeshStandardMaterial({color:look.color??p.color??color??preset.color,roughness:look.roughness??p.roughness??(skin ? .5 : preset.roughness??.5),metalness:look.metalness??p.metalness??(skin ? 0 : preset.metalness??0)});
    const mesh=new THREE.Mesh(geometry(p),mat);
    mesh.position.fromArray(p.p||[0,0,0]);
    mesh.rotation.fromArray([...(p.r||[0,0,0]),'XYZ']);
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  return group;
}
export function createFluidSurface(resolution=48) {
  const material=new THREE.MeshPhysicalMaterial({color:0x72abb8,metalness:.07,roughness:.17,clearcoat:1,clearcoatRoughness:.12});
  const mc=new MarchingCubes(resolution,material,false,false,80000);
  mc.isolation=18;mc.position.set(0,2,0);mc.scale.setScalar(10);
  mc.castShadow=true;mc.receiveShadow=true;mc.frustumCulled=false;
  return mc;
}
export function updateFluidSurface(mc,particles) {
  mc.reset();
  for(const p of particles)mc.addBall(p.x/10+.5,(p.y-2)/10+.5,p.z/10+.5,.011,12);
  mc.update();
}

export class LabView {
  constructor(container,{onSelect=()=>{},onTransform=()=>{}}={}) {
    this.container=container;this.onSelect=onSelect;this.onTransform=onTransform;this.interactionEnabled=true;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e8e8e0');
    this.scene.fog=new THREE.Fog('#e8e8e0',28,65);
    this.camera=new THREE.PerspectiveCamera(40,1,.05,150);
    this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.annotationLayer=document.createElement('div');this.annotationLayer.className='lab-annotation-layer';this.annotationLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';container.append(this.annotationLayer);this.annotationNodes=new Map();
    const pmrem=new THREE.PMREMGenerator(this.renderer);
    this.scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;this.scene.environmentIntensity=.6;pmrem.dispose();
    const hemi=new THREE.HemisphereLight('#ffffff','#a5b0a0',1.15);this.scene.add(hemi);
    const key=new THREE.DirectionalLight('#fff6e5',2.8);key.position.set(-5,12,7);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:.2,far:45});key.shadow.normalBias=.025;key.shadow.bias=-.00015;key.shadow.radius=4;this.scene.add(key);
    const fill=new THREE.DirectionalLight('#d6e4eb',.85);fill.position.set(8,5,-5);this.scene.add(fill);this.studioLights={key,fill,hemi};
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:'#e8e8e0',roughness:.9}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.04;ground.receiveShadow=true;ground.userData.isFloor=true;this.scene.add(ground);
    const grid=new THREE.GridHelper(26,52,'#c3c9be','#d6d9d0');grid.position.y=-.018;grid.material.transparent=true;grid.material.opacity=.45;this.grid=grid;this.scene.add(grid);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.maxPolarAngle=Math.PI*.98;this.controls.minDistance=.03;this.controls.maxDistance=120;
    this.transform=new TransformControls(this.camera,this.renderer.domElement);this.transform.setSize(.7);this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed',e=>{this.controls.enabled=this.interactionEnabled&&!e.value;});
    this.transform.addEventListener('objectChange',()=>{if(this.interactionEnabled)this.onTransform(this.selected,this.transform.object);});
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.models=new Map();
    this.outline=new THREE.BoxHelper(new THREE.Object3D(),'#d67b54');this.outline.visible=false;this.scene.add(this.outline);
    let down;
    this.renderer.domElement.addEventListener('pointerdown',e=>{down=this.interactionEnabled?[e.clientX,e.clientY]:null;});
    this.renderer.domElement.addEventListener('pointerup',e=>{
      if(!this.interactionEnabled||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5||this.transform.dragging||this.transform.axis)return;
      const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);const hits=this.raycaster.intersectObjects([...this.models.values()],true);
      if(hits.length){let o=hits[0].object;while(o&&!o.userData.entityId)o=o.parent;if(o)this.onSelect(o.userData.entityId);}
      else this.onSelect(null);
    });
    new ResizeObserver(()=>this.resize()).observe(container);this.resize();
    this.setCamera('impact');
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  setInteractionEnabled(enabled){
    this.interactionEnabled=!!enabled;this.controls.enabled=!!enabled;this.transform.enabled=!!enabled;
    if(!enabled){this.transform.detach();this.outline.visible=false;}
  }
  setTheme(dark){
    this.dark=dark;const space=this.lab?.settings.experiment==='orbit',background=dark?'#192f40':'#e8e8e0';
    this.scene.background.set(space?'#111d33':background);this.scene.fog=space?null:new THREE.Fog(background,28,65);
    for(const o of this.scene.children)if(o.userData.isFloor)o.material.color.set(dark?'#294757':'#e8e8e0');
    this.grid.material.color?.set(dark?'#7694a1':'#c3c9be');this.grid.material.opacity=dark?.18:.45;
    if(this.lab?.settings.environment)this.setEnvironment(this.lab.settings.environment);
  }
  setEnvironment(environment){
    if(!environment||this.lab?.settings.experiment==='orbit')return;
    const presets={studio:{background:'#0d1019',floor:'#1a2130',keyColor:'#fff0dc',fillColor:'#9fc8ff'},gallery:{background:'#e7e3db',floor:'#d8d2c4',keyColor:'#fff9ec',fillColor:'#c3d9ee'},arena:{background:'#13182d',floor:'#242d47',keyColor:'#ffe3bf',fillColor:'#72d6e4'}};
    const env=typeof environment==='string'?presets[environment]:{...presets[environment.id],...environment};if(!env?.background)return;
    this.scene.background.set(env.background);this.scene.fog=new THREE.Fog(env.background,50,140);
    this.scene.children.filter(o=>o.userData.isFloor).forEach(o=>{o.material.color.set(env.floor);o.material.roughness=env.roughness??.6;});
    this.studioLights.key.color.set(env.keyColor);this.studioLights.key.intensity=3.4;this.studioLights.fill.color.set(env.fillColor);this.studioLights.fill.intensity=.75;this.studioLights.hemi.intensity=.8;
    this.renderer.toneMappingExposure=1.05*2**(env.exposure||0);this.scene.environmentIntensity=.5;
  }
  frameObjects(objects){
    if(!objects.length)return;const bounds=new THREE.Box3();
    for(const o of objects){const p=new THREE.Vector3(...o.position);bounds.expandByPoint(p.clone().addScalar((o.scale||1)*.8));bounds.expandByPoint(p.clone().addScalar(-(o.scale||1)*.8));}
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const distance=Math.max(size.y,size.x/this.camera.aspect,size.z)*1.35/Math.tan(Math.PI/9);
    this.camera.position.copy(center).add(new THREE.Vector3(1,.8,1.3).normalize().multiplyScalar(Math.max(3,distance)));
    this.controls.target.copy(center);this.controls.update();
  }
  frameScene(id){
    const models=id?[...this.models.values()].filter(model=>model.userData.entityId===id):[...this.models.values()];
    const bounds=new THREE.Box3();for(const model of models){model.updateWorldMatrix(true,true);bounds.expandByObject(model,true);}
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3()),radius=Math.max(.025,bounds.getSize(new THREE.Vector3()).length()/2),halfAngle=Math.atan(Math.tan(this.camera.fov*Math.PI/360)*Math.min(1,this.camera.aspect));
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();if(!direction.lengthSq())direction.set(1,.6,1.8).normalize();
    this.controls.target.copy(center);this.camera.position.copy(center).addScaledVector(direction,radius/Math.sin(halfAngle)*1.12);this.controls.update();
  }
  clearLayoutPreview(){
    if(!this.layoutPreview)return;this.scene.remove(this.layoutPreview);this.layoutPreview.traverse(o=>o.material?.dispose());this.layoutPreview=null;
  }
  applyRecordedFrame(frame,take){
    this.recordedAnnotations=frame.annotations||[];
    this.recordedContext=normalizeContextView(take.contextView||take.settings?.contextView);
    const decode=str=>{const s=atob(str),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return new Float32Array(b.buffer);};
    const poses=decode(frame.poses);
    for(let i=0;i<take.entities.length;i++){const model=this.models.get(take.entities[i].id),k=i*7;if(model){model.position.set(poses[k],poses[k+1],poses[k+2]);model.quaternion.set(poses[k+3],poses[k+4],poses[k+5],poses[k+6]);model.traverse(m=>{if(m.material?.emissive){const highlight=frame.editorial?.enabled!==false&&frame.editorial?.theme!=='minimal'&&frame.editorial?.metricUnit==='предметов'&&frame.measuredChanges?.includes(take.entities[i].id);m.material.emissive.set(highlight?frame.editorial.accent:'#000000');m.material.emissiveIntensity=highlight?.35:0;}});}}
    for(const[id,str]of Object.entries(frame.vertices||{})){const mesh=this.models.get(id);if(mesh?.geometry?.attributes.position){mesh.geometry.attributes.position.array.set(decode(str));mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeVertexNormals();}}
    if(this.fluidMesh&&frame.fluidParticles){const p=decode(frame.fluidParticles),matrix=new THREE.Matrix4();this.fluidMesh.count=p.length/3;for(let i=0;i<p.length;i+=3){matrix.makeTranslation(p[i],p[i+1],p[i+2]);this.fluidMesh.setMatrixAt(i/3,matrix);}this.fluidMesh.instanceMatrix.needsUpdate=true;}
    if(frame.thermal){const glow=Math.max(0,(frame.thermal.temperature-380)/500);this.models.get('hot-ball')?.traverse(o=>{if(o.material){o.material.emissive.set('#e34e12');o.material.emissiveIntensity=glow;}});}
    if(frame.penetration)this.applyHeating(frame.penetration);
    if(frame.camera){this.camera.fov=frame.camera.fov||40;this.camera.position.fromArray(frame.camera.position);this.controls.target.fromArray(frame.camera.target);this.camera.lookAt(this.controls.target);this.camera.updateProjectionMatrix();}
  }
  previewLayout(objects){
    this.clearLayoutPreview();const group=new THREE.Group();
    for(const o of objects){const model=objectVisual(o.parts||assetParts(o.asset),o.material,o.color,o.asset);model.position.fromArray(o.position);model.scale.setScalar(o.scale||1);const q=quat(o.rotation);model.quaternion.set(q.x,q.y,q.z,q.w);model.traverse(m=>{if(m.material){m.material.color.set('#61d6ec');m.material.transparent=true;m.material.opacity=.48;m.material.depthWrite=false;}});group.add(model);}
    this.layoutPreview=group;this.scene.add(group);this.frameObjects(objects);
  }
  setCamera(id) {
    const ex=EXPERIMENTS.find(e=>e.id===id)||EXPERIMENTS[0];
    this.camera.position.fromArray(ex.views);this.controls.target.fromArray(ex.target);this.controls.update();this.basePosition=this.camera.position.clone();this.baseTarget=this.controls.target.clone();
  }
  load(lab,resetCamera=true) {
    this.transform.detach();this.selected=null;this.outline.visible=false;
    for(const model of this.models.values()){this.scene.remove(model);model.traverse(o=>{if(o.material)o.material.dispose();});}
    this.models.clear();
    if(this.fluidMesh){this.scene.remove(this.fluidMesh);this.fluidMesh.geometry.dispose();this.fluidMesh.material.dispose();this.fluidMesh=null;}
    this.lab=lab;this.recordedContext=undefined;this.recordedAnnotations=undefined;this.lastLiveCamera=null;this.liveCameraMode=null;this.liveCameraBounds=new Map();this.liveCameraSample=null;
    const space=lab.settings.experiment==='orbit';this.setTheme(this.dark);this.grid.visible=space?false:lab.settings.showGrid;
    this.scene.children.filter(o=>o.userData.isFloor).forEach(o=>o.visible=!space);
    for(const e of lab.entities)this.add(e);
    for(const e of lab.softs){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(e.soft.meshVertices(0).slice(),3));g.setIndex(new THREE.BufferAttribute(e.soft.meshIndices(0).slice(),1));g.computeVertexNormals();
      const preset=MATERIALS[e.material],appearance={...specimenAppearance(e.material),...e.sourceAppearance,...e.appearance};
      const mesh=new THREE.Mesh(g,new THREE.MeshPhysicalMaterial({color:appearance.color||preset.color,roughness:appearance.roughness??preset.roughness,clearcoat:appearance.clearcoat??.25,metalness:appearance.metalness??0,side:THREE.DoubleSide}));
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.userData.entityId=e.id;this.scene.add(mesh);this.models.set(e.id,mesh);
    }
    for(const surface of lab.surfaces||[]){const data=surface.geometry(),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));g.setIndex(new THREE.BufferAttribute(data.indices,1));g.computeVertexNormals();const mat=new THREE.MeshStandardMaterial({color:surface.appearance?.color||surface.color||MATERIALS[surface.material].color,roughness:surface.appearance?.roughness??(surface.material==='ice'?.2:.4),metalness:surface.appearance?.metalness??(surface.material==='ice'?.15:0),side:THREE.DoubleSide});const mesh=new THREE.Mesh(g,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.userData.entityId=surface.id;this.scene.add(mesh);this.models.set(surface.id,mesh);}
    if(lab.fluid){this.fluidMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(.068,14,10),new THREE.MeshPhysicalMaterial({color:MATERIALS[lab.settings.material].color,roughness:.16,metalness:.18,clearcoat:1}),900);this.fluidMesh.count=0;this.fluidMesh.castShadow=true;this.fluidMesh.receiveShadow=true;this.fluidMesh.frustumCulled=false;this.scene.add(this.fluidMesh);}
    if(resetCamera){this.setCamera(lab.settings.experiment);if(lab.settings.experiment==='blank'&&!lab.settings.cameraRig?.points?.length)this.frameScene();}
    this.sync(true);
  }
  add(e) {
    if(e.id==='ground'||e.renderHidden)return;
    if(e.soft){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(e.soft.meshVertices(0).slice(),3));g.setIndex(new THREE.BufferAttribute(e.soft.meshIndices(0).slice(),1));g.computeVertexNormals();const appearance={...specimenAppearance(e.material),...e.sourceAppearance,...e.appearance},m=new THREE.MeshPhysicalMaterial({color:appearance.color||MATERIALS[e.material].color,roughness:appearance.roughness??MATERIALS[e.material].roughness,metalness:appearance.metalness??0,clearcoat:appearance.clearcoat??.25,side:THREE.DoubleSide});const mesh=new THREE.Mesh(g,m);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.userData.entityId=e.id;this.models.set(e.id,mesh);this.scene.add(mesh);return;}
    const group=objectVisual(e.visualParts||e.parts,e.material,e.color,e.asset||e.spec?.asset,e.appearance,e.renderSurface);group.scale.setScalar(e.scale);group.userData.entityId=e.ownerId||e.rigOwnerId||e.id;this.models.set(e.id,group);this.scene.add(group);this.syncEntity(e);
  }
  syncEntity(e){const m=this.models.get(e.id);if(!m||!e.body||e.renderHidden)return;const p=e.body.translation(),q=e.body.rotation();m.position.set(p.x,p.y,p.z);m.quaternion.set(q.x,q.y,q.z,q.w);}
  sync(force=false){
    if(!this.lab)return;
    for(const e of this.lab.entities)if(e.id!=='ground'&&!this.models.has(e.id))this.add(e);
    for(const e of this.lab.entities)this.syncEntity(e);
    for(const e of this.lab.softs){const m=this.models.get(e.id);if(m){m.geometry.attributes.position.array.set(e.soft.meshVertices(0));m.geometry.attributes.position.needsUpdate=true;m.geometry.computeVertexNormals();}}
    for(const surface of this.lab.surfaces||[]){const m=this.models.get(surface.id);if(m){const data=surface.geometry();m.geometry.attributes.position.array.set(data.vertices);m.geometry.attributes.position.needsUpdate=true;m.geometry.computeVertexNormals();}}
    if(this.lab.thermal){const model=this.models.get('hot-ball');const glow=Math.max(0,(this.lab.thermal.temperature-380)/500);model?.traverse(o=>{if(o.material){o.material.emissive.set('#e34e12');o.material.emissiveIntensity=glow;}});}
    if(this.lab.penetration)this.applyHeating(this.lab.penetration.snapshot());
    if(this.fluidMesh){const matrix=new THREE.Matrix4();this.fluidMesh.count=this.lab.fluid.particles.length;this.lab.fluid.particles.forEach((p,i)=>{matrix.makeTranslation(p.x,p.y,p.z);this.fluidMesh.setMatrixAt(i,matrix);});this.fluidMesh.instanceMatrix.needsUpdate=true;}
    this.frameCount=(this.frameCount||0)+1;
    if(this.selected){const model=this.selectionModel(this.selected);if(model)this.outline.setFromObject(model);}
  }
  applyHeating(state){const glow=Math.max(0,Math.min(1,(state.temperature-450)/700));this.models.get(state.projectileId)?.traverse(o=>{if(o.material?.emissive){o.material.emissive.set('#f16219');o.material.emissiveIntensity=Math.pow(glow,1.7);}});}
  selectionModel(id){
    if(this.models.has(id))return this.models.get(id);
    const owned=[...this.models.values()].filter(model=>model.userData.entityId===id);
    if(!owned.length)return null;
    const bounds=new THREE.Box3();for(const model of owned){model.updateWorldMatrix(true,true);bounds.expandByObject(model,true);}
    if(bounds.isEmpty())return null;
    this.selectionProxy||=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));
    bounds.getCenter(this.selectionProxy.position);bounds.getSize(this.selectionProxy.scale);this.selectionProxy.updateWorldMatrix(true,false);
    return this.selectionProxy;
  }
  select(id,editable=true){if(!this.interactionEnabled)return;this.selected=id;const model=this.selectionModel(id);this.transform.detach();this.outline.visible=!!model;if(model){this.outline.setFromObject(model);const e=this.lab.find(id);if(editable&&e?.body&&!e.fixed&&!e.kinematic&&!e.phenomenonRole&&this.models.has(id))this.transform.attach(model);}}
  setGrid(on){this.grid.visible=on;}
  cameraPreset(name){
    if(name==='top'){this.camera.position.set(0,19,.01);this.controls.target.set(0,0,0);}
    else if(name==='front'){this.camera.position.set(0,4,16);this.controls.target.set(0,1,0);}
    else this.setCamera(this.lab.settings.experiment);
    this.controls.update();
  }
  liveCameraObjects(){
    const lab=this.lab,objects=[],previous=this.liveCameraSample,dt=previous?lab.time-previous.time:0;
    const velocity=(id,position,fallback=[0,0,0])=>{const p=previous?.positions.get(id);return p&&dt>1e-6?position.map((v,k)=>(v-p[k])/dt):fallback;};
    for(const e of lab.entities){
      if(e.id==='ground'||!e.body||e.body.isEnabled?.()===false)continue;
      const p=e.body.translation(),q=e.body.rotation(),v=e.body.linvel(),position=[p.x,p.y,p.z];
      if(!finiteVector(position))continue;
      if(!this.liveCameraBounds.has(e.id))this.liveCameraBounds.set(e.id,objectBounds(e));
      objects.push({id:e.id,position,bounds:this.liveCameraBounds.get(e.id),quaternion:[q.x,q.y,q.z,q.w],velocity:e.kinematic?velocity(e.id,position,[v.x,v.y,v.z]):[v.x,v.y,v.z],fixed:e.fixed,mass:e.body.mass()});
    }
    for(const e of lab.softs){
      const box=pointCloudBounds(e.soft.meshVertices(0));
      if(box)objects.push({id:e.id,...box,velocity:velocity(e.id,box.position),fixed:false,mass:e.spec?.mass||3});
    }
    if(lab.fluid?.particles.length){
      // Follow a moving cluster, independent of the chute's direction or axes.
      const active=lab.fluid.particles.filter(p=>[p.x,p.y,p.z].every(Number.isFinite)).slice().sort((a,b)=>Math.hypot(b.vx||0,b.vy||0,b.vz||0)-Math.hypot(a.vx||0,a.vy||0,a.vz||0)).slice(0,30);
      const box=pointCloudBounds(active.flatMap(p=>[p.x,p.y,p.z]),lab.fluid.radius||.065);
      if(box)objects.push({id:'fluid',...box,velocity:['vx','vy','vz'].map(k=>active.reduce((sum,p)=>sum+(Number.isFinite(p[k])?p[k]:0),0)/active.length),fixed:false});
    }
    if(!previous||dt>1e-6||dt<0)this.liveCameraSample={time:lab.time,positions:new Map(objects.map(o=>[o.id,o.position.slice()]))};
    return objects;
  }
  renderAnnotations(){
    const labels=this.recordedAnnotations===undefined?resolveSceneAnnotations(this.lab?.settings.annotations,new Map([...(this.lab?.entities||[]),...(this.lab?.softs||[])].map(e=>[e.id,this.lab.position(e.id)]))):this.recordedAnnotations;
    const size=this.renderer.getSize(new THREE.Vector2()),active=new Set();this.camera.updateMatrixWorld();
    for(const a of labels){active.add(a.id);let node=this.annotationNodes.get(a.id);if(!node){node=document.createElement('span');node.style.cssText='position:absolute;white-space:nowrap;transform:translate(-50%,-50%);padding:3px 7px;border-radius:4px;background:#101923bb;font-weight:600;line-height:1.3;box-shadow:0 1px 5px #0002';this.annotationNodes.set(a.id,node);this.annotationLayer.append(node);}if(node.textContent!==a.text)node.textContent=a.text;const p=new THREE.Vector3(...a.position).project(this.camera);node.hidden=p.z< -1||p.z>1||!Number.isFinite(p.x)||Math.abs(p.x)>1||Math.abs(p.y)>1;node.style.left=(p.x*.5+.5)*size.x+'px';node.style.top=(-p.y*.5+.5)*size.y+'px';node.style.color=a.color;node.style.fontSize=Math.max(9,a.size*size.x/1080)+'px';}
    for(const[id,node]of this.annotationNodes)if(!active.has(id)){node.remove();this.annotationNodes.delete(id);}
  }
  render(){
    if(this.autoMode&&this.autoMode!=='free'&&this.lab?.time>0){
      const lab=this.lab,settings=lab.settings,objects=this.liveCameraObjects();
      const focusId=settings.story?.heroId||settings.focusId||this.selected||(lab.fluid?'fluid':lab.softs[0]?.id);
      const hero=chooseHero(objects,focusId);
      const byId=new Map(objects.map(o=>[o.id,o]));
      const latest=lab.impacts?.filter(e=>lab.time-e.t>=0&&lab.time-e.t<1.2&&(!hero||e.participants?.includes(hero.id))).sort((a,b)=>b.t-a.t||b.strength-a.strength)[0];
      let event=latest?{...latest,time:latest.t,participants:(latest.participants||[]).filter(id=>byId.has(id))}:null;
      let obstacles=[],viewDirection;
      if(lab.orbit){
        const radius=lab.orbit.planet.radius/lab.orbit.unit;
        const central=lab.entities.find(e=>e.fixed&&e.parts?.some(p=>p.shape==='sphere'&&Math.abs(p.d[0]*(e.scale||1)-radius)<Math.max(1e-5,radius*.001)));
        const centre=central?byId.get(central.id):null;
        viewDirection=[0,0,1];
        if(lab.time>=.5&&centre){
          // A declared central body is context, not a decorative prop. Protect
          // both complete volumes; their fit already keeps the camera outside.
          event={type:'context',time:lab.time-.8,participants:[hero?.id,centre.id].filter(Boolean)};
        }else obstacles=[{id:centre?.id,position:centre?.position||[0,0,0],radius}];
      }
      const style={dolly:'auto',auto:'auto',follow:'follow',orbit:'orbit'}[this.autoMode]||'auto';
      const previous=this.liveCameraMode===this.autoMode&&this.lastLiveCamera?.time<=lab.time?this.lastLiveCamera:undefined;
      const shot=planCamera({time:lab.time,duration:Number(settings.story?.duration)||60,aspect:this.camera.aspect,objects,focusId:hero?.id,event,style,previous,obstacles,viewDirection,safeFrame:{top:.08,bottom:.08,left:.08,right:.08}});
      if(finiteVector(shot.position)&&finiteVector(shot.target)&&Number.isFinite(shot.fov)){
        this.camera.position.fromArray(shot.position);this.controls.target.fromArray(shot.target);this.camera.fov=shot.fov;this.camera.updateProjectionMatrix();
        this.lastLiveCamera={...shot,time:lab.time};this.liveCameraMode=this.autoMode;
      }
    }
    this.controls.update();this.renderer.render(this.scene,this.camera);
    const context=this.recordedContext===undefined?normalizeContextView(this.lab?.settings.contextView):this.recordedContext;
    if(context){
      const size=this.renderer.getSize(new THREE.Vector2()),r=contextViewRect(context,size.x,size.y);
      this.contextCamera??=new THREE.PerspectiveCamera();Object.assign(this.contextCamera,{fov:context.fov,aspect:this.camera.aspect,near:.005,far:500});this.contextCamera.position.fromArray(context.position);this.contextCamera.lookAt(new THREE.Vector3(...context.target));this.contextCamera.updateProjectionMatrix();
      this.renderer.setScissorTest(true);this.renderer.setViewport(r.x,r.y,r.width,r.height);this.renderer.setScissor(r.x,r.y,r.width,r.height);this.renderer.render(this.scene,this.contextCamera);this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,size.x,size.y);
    }
    this.renderAnnotations();
  }
  screenshot(){this.render();return this.renderer.domElement.toDataURL('image/png');}
}

let thumbRenderer,thumbScene,thumbCamera;
const thumbs=new Map();
export function thumbnail(asset) {
  if(thumbs.has(asset.id))return thumbs.get(asset.id);
  if(!thumbRenderer){
    thumbRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});thumbRenderer.setSize(160,112);thumbRenderer.setPixelRatio(1.2);thumbRenderer.toneMapping=THREE.ACESFilmicToneMapping;thumbRenderer.toneMappingExposure=1.2;
    thumbScene=new THREE.Scene();thumbScene.add(new THREE.HemisphereLight('#ffffff','#a5b0a0',1.65));const l=new THREE.DirectionalLight('#fff7e8',2.5);l.position.set(-4,8,5);thumbScene.add(l);
    thumbCamera=new THREE.PerspectiveCamera(35,160/112,.01,100);
  }
  const model=objectVisual(assetParts(asset.id),asset.mat,undefined,asset.id);thumbScene.add(model);
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const scale=Math.max(size.x,size.y,size.z);thumbCamera.position.copy(center).add(new THREE.Vector3(1.8,1.25,2.2).multiplyScalar(scale));thumbCamera.lookAt(center);
  thumbRenderer.render(thumbScene,thumbCamera);const data=thumbRenderer.domElement.toDataURL('image/webp');thumbs.set(asset.id,data);thumbScene.remove(model);model.traverse(o=>o.material?.dispose());return data;
}
