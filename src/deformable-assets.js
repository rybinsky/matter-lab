import RAPIER from '@dimforge/rapier3d-compat';
import {assetParts,CATALOG,MATERIALS} from './catalog.js';
import {assetSurface} from './asset-surfaces.js';

export const DEFORMABLE_LIMITS=Object.freeze({vertices:1200,triangles:2400,gridPoints:512,estimatedTetrahedra:3072});
export const DEFORMABLE_ASSETS=Object.freeze(['banana','ball','ellipsoid']);
const error=m=>{throw new Error('Мягкий предмет: '+m);};
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,-10000,10000));
const qmul=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const qrot=(p,q)=>{const t=qmul(qmul(q,{x:p[0],y:p[1],z:p[2],w:0}),{x:-q.x,y:-q.y,z:-q.z,w:q.w});return[t.x,t.y,t.z];};
function quaternion(r=[0,0,0]){if(Array.isArray(r)){if(!vec(r))error('неверный поворот.');return qmul(qmul({x:Math.sin(r[0]/2),y:0,z:0,w:Math.cos(r[0]/2)},{x:0,y:Math.sin(r[1]/2),z:0,w:Math.cos(r[1]/2)}),{x:0,y:0,z:Math.sin(r[2]/2),w:Math.cos(r[2]/2)});}if(!r||!['x','y','z','w'].every(k=>finite(r[k],-1,1)))error('неверный поворот.');const n=Math.hypot(r.x,r.y,r.z,r.w);if(n<1e-12)error('нулевой поворот.');return{x:r.x/n,y:r.y/n,z:r.z/n,w:r.w/n};}
function ellipsoid(radii){
 if(!vec(radii)||radii.some(x=>x<=0))error('нужны три положительных радиуса.');
 const lat=12,lon=24,positions=[0,radii[1],0],indices=[];
 for(let i=1;i<lat;i++){const b=Math.PI*i/lat;for(let j=0;j<lon;j++){const a=2*Math.PI*j/lon;positions.push(radii[0]*Math.sin(b)*Math.cos(a),radii[1]*Math.cos(b),radii[2]*Math.sin(b)*Math.sin(a));}}
 const bottom=positions.length/3;positions.push(0,-radii[1],0);
 for(let j=0;j<lon;j++)indices.push(0,1+j,1+(j+1)%lon);
 for(let i=0;i<lat-2;i++)for(let j=0;j<lon;j++){const a=1+i*lon+j,b=1+i*lon+(j+1)%lon;indices.push(a,a+lon,b,b,a+lon,b+lon);}
 const last=1+(lat-2)*lon;for(let j=0;j<lon;j++)indices.push(last+j,bottom,last+(j+1)%lon);
 return{positions,indices,details:[]};
}
/** Conservative topology gate. Does not assert that arbitrary input is free
 * of every geometric self-intersection: the volume mesher may reject it too. */
export function validateClosedSurface(surface){
 if(!surface||!Array.isArray(surface.positions)||!Array.isArray(surface.indices))error('нужна замкнутая треугольная поверхность.');
 if(surface.color!==undefined&&(typeof surface.color!=='string'||!/^#[a-f0-9]{6}$/i.test(surface.color)))error('цвет оболочки должен быть в формате #RRGGBB.');
 const p=surface.positions,t=surface.indices,n=p.length/3;
 if(!Number.isInteger(n)||n<4||n>DEFORMABLE_LIMITS.vertices||p.some(v=>!finite(v,-10000,10000))||t.length%3||t.length<12||t.length/3>DEFORMABLE_LIMITS.triangles||t.some(v=>!Number.isInteger(v)||v<0||v>=n))error('геометрия слишком большая или содержит неверные координаты/индексы.');
 const edges=new Map(),neighbors=Array.from({length:t.length/3},()=>[]);let volume=0;
 for(let k=0;k<t.length;k+=3){const ids=t.slice(k,k+3);if(new Set(ids).size!==3)error('в поверхности есть вырожденный треугольник.');const[a,b,c]=ids.map(i=>p.slice(i*3,i*3+3)),u=b.map((v,i)=>v-a[i]),v=c.map((w,i)=>w-a[i]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(Math.hypot(...cross)<1e-12)error('в поверхности есть треугольник нулевой площади.');volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  for(let j=0;j<3;j++){const x=ids[j],y=ids[(j+1)%3],key=x<y?x+':'+y:y+':'+x;if(!edges.has(key))edges.set(key,[]);edges.get(key).push({triangle:k/3,direction:x<y?1:-1});}
 }
 for(const uses of edges.values()){if(uses.length!==2||uses[0].direction===uses[1].direction)error('поверхность должна быть замкнутой и согласованно ориентированной.');neighbors[uses[0].triangle].push(uses[1].triangle);neighbors[uses[1].triangle].push(uses[0].triangle);}
 const visited=new Set([0]),todo=[0];while(todo.length){for(const n of neighbors[todo.pop()])if(!visited.has(n)){visited.add(n);todo.push(n);}}if(visited.size!==neighbors.length)error('нужна одна связная оболочка, а не набор пересекающихся деталей.');if(Math.abs(volume)<1e-10)error('оболочка не ограничивает положительный объём.');
 const indices=t.slice();if(volume<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 return{positions:p.slice(),indices,color:surface.color,details:structuredClone(surface.details||[]),volume:Math.abs(volume)};
}
/** Cheap UI capability predicate; no tessellation or Rapier allocation. */
export function supportsDeformableAsset(spec={}){
 if(spec.deformable?.surface)return true;
 if(spec.parts)return spec.parts.length===1&&['sphere','ellipsoid'].includes(spec.parts[0].shape);
 return DEFORMABLE_ASSETS.includes(spec.asset);
}

/** Structural validation is safe during project save, before Rapier init. */
export function validateDeformableSpec(spec={}){
 if(!spec||typeof spec!=='object'||Array.isArray(spec))error('нужны настройки предмета.');
 const c=spec.deformable??{};if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['enabled','surface','cellSize','preserveSkin','young','poisson','plasticYield','plasticCreep','plasticMax','elasticDampingRatio'].includes(k)))error('неизвестные настройки мягкого тела.');
 for(const k of ['enabled','preserveSkin'])if(c[k]!==undefined&&typeof c[k]!=='boolean')error('неверное включение мягкого тела/оболочки.');
 for(const[k,min,max]of[['cellSize',.001,1000],['young',10,1e7],['poisson',0,.49],['plasticYield',0,2],['plasticCreep',0,100],['plasticMax',0,2],['elasticDampingRatio',0,2]])if(c[k]!==undefined&&!finite(c[k],min,max))error('неверный параметр '+k+'.');
 if(spec.radii!==undefined&&(!vec(spec.radii)||spec.radii.some(v=>v<=0)))error('неверные радиусы.');
 if(c.surface)validateClosedSurface(c.surface);
 return spec;
}

/** RAPIER.init() must have completed before building the descriptor. All spec
 * fields are ordinary project data; the descriptor itself is runtime-only. */
export function buildSoftAsset(spec={}){
 validateDeformableSpec(spec);
 const config=spec.deformable||{},position=spec.position||[0,1,0],scale=spec.scale??1;
 if(!vec(position)||!finite(scale,.001,1000)||!finite(spec.mass??1,.00001,1e6))error('неверные положение, масштаб или масса.');
 let source,kind;
 if(config.surface){source=config.surface;kind='authored-closed-surface';}
 else if(spec.parts){if(spec.parts.length!==1||!['sphere','ellipsoid'].includes(spec.parts[0].shape))error('составной предмет нельзя считать замкнутым мягким телом. Нужна отдельная замкнутая оболочка.');const part=spec.parts[0];source=ellipsoid(part.shape==='sphere'?[part.d[0],part.d[0],part.d[0]]:part.d);const q=quaternion(part.r),offset=part.p||[0,0,0];source.positions=source.positions.flatMap((_,i)=>i%3?[]:qrot(source.positions.slice(i,i+3),q).map((v,k)=>v+offset[k]));source.color=part.color;kind='single-'+part.shape;}
 else if(spec.asset==='banana'){source=assetSurface('banana');kind='banana-continuous-skin';}
 else if(spec.asset==='ball'){const p=assetParts('ball')[0];source=ellipsoid([p.d[0],p.d[0],p.d[0]]);kind='sphere';}
 else if(spec.asset==='ellipsoid'){source=ellipsoid(spec.radii||[.4,.3,.25]);kind='ellipsoid';}
 else error('для этого предмета ещё нет замкнутой оболочки. Сейчас доступны банан, шар, эллипсоид или проверенная отдельная поверхность.');
 const closed=validateClosedSurface(source),q=quaternion(spec.rotation),world=[];
 for(let i=0;i<closed.positions.length;i+=3)world.push(...qrot(closed.positions.slice(i,i+3).map(v=>v*scale),q).map((v,k)=>v+position[k]));
 const lo=[0,1,2].map(k=>Math.min(...world.filter((_,i)=>i%3===k))),hi=[0,1,2].map(k=>Math.max(...world.filter((_,i)=>i%3===k))),extent=lo.map((v,k)=>hi[k]-v),cellSize=config.cellSize??Math.max(...extent)/5;
 if(!finite(cellSize,.001,1000))error('размер ячейки должен быть положительным.');const grid=extent.map(v=>Math.ceil(v/cellSize)+2),gridPoints=grid.reduce((a,b)=>a*b,1),estimatedTetrahedra=6*gridPoints;
 if(gridPoints>DEFORMABLE_LIMITS.gridPoints||estimatedTetrahedra>DEFORMABLE_LIMITS.estimatedTetrahedra)error('слишком мелкая сетка. Увеличьте размер ячейки, чтобы не перегружать студию.');
 const materialPreset=MATERIALS[spec.material]||{},young=config.young??materialPreset.young??2200,poisson=config.poisson??materialPreset.poisson??.35,plasticYield=config.plasticYield??materialPreset.plasticYield??0,plasticCreep=config.plasticCreep??materialPreset.plasticCreep??0,plasticMax=config.plasticMax??.8,damping=config.elasticDampingRatio??.25;
 if(!finite(young,10,1e7)||!finite(poisson,0,.49)||!finite(plasticYield,0,2)||!finite(plasticCreep,0,100)||!finite(plasticMax,0,2)||!finite(damping,0,2))error('неверные параметры упругости или пластичности.');
 const material=new RAPIER.SoftBodyMaterial();material.youngModulus=young;material.poissonRatio=poisson;material.elasticDampingRatio=damping;material.plasticYield=plasticYield;material.plasticCreep=plasticCreep;material.plasticMax=plasticMax;
 const preserveSkin=config.preserveSkin!==false,descriptor=RAPIER.SoftBodyDesc.volumetric(new Float32Array(world),new Uint32Array(closed.indices),cellSize,preserveSkin);if(!descriptor)error('эту оболочку не удалось заполнить устойчивой объёмной сеткой.');
 descriptor.setMass(spec.mass??1).setMaterial(material).setCellModel(RAPIER.SoftBodyCellModel.Corotational).setSolver(RAPIER.SoftBodySolver.Fem).setParticleRadius(Math.min(.025,cellSize*.12)).setAdditionalSolverIterations(3).setLinearDamping(.35).setCanSleep(false).setSkinCollision(preserveSkin);
 const originalColor=closed.color||MATERIALS[CATALOG.find(a=>a.id===spec.asset)?.mat]?.color||MATERIALS[spec.material]?.color||'#d9edc6',color=spec.appearance?.color||spec.color||originalColor;
 return{descriptor,render:{color,appearance:{color,roughness:.35,metalness:0,...spec.appearance},sourceSkin:{positions:world,indices:closed.indices,color:originalColor}},metadata:{source:kind,cellSize,preserveSkin,skinCollision:preserveSkin,grid,gridPoints,estimatedTetrahedra,originalSurfaceVertices:closed.positions.length/3,originalSurfaceTriangles:closed.indices.length/3,originalColor,omittedDetachedDetails:closed.details.length,detachedDetails:closed.details,material:{young,poisson,plasticYield,plasticCreep,plasticMax},limitations:['Compound overlapping asset parts are not implicitly unioned into a watertight body.','Detached decorative stems/tips are retained as metadata but are not attached to the FEM cells.','Custom surfaces pass manifold/topology checks; arbitrary geometric self-intersection is not exhaustively certified.']}};
}
