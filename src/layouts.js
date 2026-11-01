// Reusable scene construction: patterns produce transforms, independent of assets
// and physics. A source can be one object or an arbitrary compound selection.
export const PATTERNS=[
 {id:'grid',name:'Объёмная решётка',hint:'Ряды, стены, башни, стеллажи',icon:'grid-3x3'},
 {id:'line',name:'Линия',hint:'Любое направление и шаг',icon:'move-up-right'},
 {id:'ring',name:'Кольцо',hint:'Дуги, арены, круговые цепочки',icon:'circle-dashed'},
 {id:'helix',name:'Спираль',hint:'Радиус, обороты, набор высоты',icon:'orbit'},
 {id:'stairs',name:'Ступени',hint:'Каскады, лестницы, диагонали',icon:'chart-no-axes-column-increasing'},
 {id:'scatter',name:'Заполнение области',hint:'Воспроизводимый случайный разброс',icon:'scatter-chart'},
];
const rad=d=>d*Math.PI/180;
export const qmul=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
export function quat(r=[0,0,0]){if(!Array.isArray(r))return r;const [x,y,z]=r.map(a=>a/2),c1=Math.cos(x),c2=Math.cos(y),c3=Math.cos(z),s1=Math.sin(x),s2=Math.sin(y),s3=Math.sin(z);return{x:s1*c2*c3+c1*s2*s3,y:c1*s2*c3-s1*c2*s3,z:c1*c2*s3+s1*s2*c3,w:c1*c2*c3-s1*s2*s3};}
export function rotate(p,q){const v=qmul(qmul(q,{x:p[0],y:p[1],z:p[2],w:0}),{x:-q.x,y:-q.y,z:-q.z,w:q.w});return[v.x,v.y,v.z];}
function random(seed){let s=Number(seed)>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function fixedFor(s,source){
 if(s.fixedMode==='fixed')return true;
 if(s.fixedMode==='dynamic')return false;
 if(s.fixedMode==='preserve')return source.fixed;
 // Old saved generators used a boolean override. Keep their explicit intent.
 return s.fixed??source.fixed;
}
// These are already physical SI values after the source's own geometry scale.
// A further copy scale changes lengths/areas/volumes, while dimensionless Cd
// and the declared material/appearance remain author-owned and unchanged.
function scaledPhysicalSource(source,factor){
 const copy=structuredClone(source);
 if(copy.buoyancy){
  if(copy.buoyancy.volume!==undefined)copy.buoyancy.volume*=factor**3;
  if(copy.buoyancy.referenceArea!==undefined)copy.buoyancy.referenceArea*=factor**2;
  if(copy.buoyancy.center)copy.buoyancy.center=copy.buoyancy.center.map(v=>v*factor);
 }
 return copy;
}
export function layoutPoints(s){
 const count=s.count.map(n=>Math.max(1,Math.min(30,Math.floor(n)||1))),step=s.step.map(n=>Number(n)||0),points=[];
 const push=(p,index,angle=0)=>points.push({p,index,angle});
 if(s.pattern==='grid')for(let y=0;y<count[1];y++)for(let z=0;z<count[2];z++)for(let x=0;x<count[0];x++)push([x*step[0],y*step[1],z*step[2]],points.length);
 else if(s.pattern==='line'||s.pattern==='stairs')for(let i=0;i<count[0];i++)push([i*step[0],i*step[1],i*step[2]],i);
 else if(s.pattern==='ring'||s.pattern==='helix')for(let i=0;i<count[0];i++){
   const fraction=s.pattern==='ring'?i/count[0]:i/Math.max(1,count[0]-1),a=fraction*Math.PI*2*(s.pattern==='helix'?s.turns||2:1);
   push([Math.cos(a)*s.radius,s.pattern==='helix'?i*step[1]:0,Math.sin(a)*s.radius],i,s.align?a+Math.PI/2:0);
 }
 else if(s.pattern==='scatter'){const rnd=random(s.seed);for(let i=0;i<count[0];i++)push([(rnd()-.5)*s.extent[0],rnd()*s.extent[1],(rnd()-.5)*s.extent[2]],i,s.align?rnd()*Math.PI*2:0);}
 return points;
}
export function buildLayout(s,sources){
 const points=layoutPoints(s);if(points.length*sources.length>150)throw new Error('В одном построении доступно до 150 предметов. Уменьшите количество копий.');
 const rng=random(s.seed),root=quat((s.rotation||[0,0,0]).map(rad)),jitter=s.jitter||0,angle=s.angleJitter||0,variation=s.scaleJitter||0;
 const result=[];
 for(const cell of points){
  const turn=quat((s.turn||[0,0,0]).map((v,i)=>rad(v)*cell.index+(i===1?cell.angle:0)));
  const local=cell.p.map(v=>v+(rng()-.5)*2*jitter),location=rotate(local,root);
  for(let i=0;i<sources.length;i++){
   const source=sources[i],spread=rotate(rotate(source.offset||[0,0,0],turn),root),scaleFactor=Math.max(.1,1+(rng()-.5)*2*variation);
   const orient=qmul(qmul(root,turn),qmul(quat([0,rad((rng()-.5)*2*angle),0]),quat(source.rotation)));
   result.push({...scaledPhysicalSource(source,scaleFactor),offset:undefined,id:`${s.id}-${cell.index}-${i}`,generatorId:s.id,position:location.map((v,k)=>v+spread[k]+s.origin[k]),rotation:orient,scale:(source.scale||1)*scaleFactor,mass:(source.mass||1)*scaleFactor**3,fixed:fixedFor(s,source),velocity:s.velocity||undefined});
  }
 }
 return result;
}

/**
 * Copy a graph of bodies with one coherent transform per copy.
 * sourceId (or id) identifies each template body. Connection endpoints use
 * those ids; connection.point is relative to the same origin as source.offset,
 * not an absolute scene coordinate. The composer converts world points once.
 * Only internal relationships are cloned. External relationships are reported
 * explicitly, never silently attached to the original scene or guessed.
 * buildLayout() remains the compatible geometry-only, per-object variant.
 */
export function buildLayoutAssembly(s,sources,sourceConnections=[]){
 const points=layoutPoints(s);
 if(points.length*sources.length>150)throw new Error('В одном построении доступно до 150 предметов. Уменьшите количество копий.');
 const sourceIndices=new Map();
 sources.forEach((source,index)=>{
  const id=source.sourceId||source.id;if(!id)return;
  if(sourceIndices.has(id))throw new Error(`В источнике повторяется идентификатор «${id}». Выберите разные предметы.`);
  sourceIndices.set(id,index);
 });
 const warnings=[],internal=[];
 for(const[connectionIndex,connection]of sourceConnections.entries()){
  const a=sourceIndices.get(connection.a),b=sourceIndices.get(connection.b);
  if(a===undefined||b===undefined){
   const label=connection.name||connection.id||`${connection.a} → ${connection.b||'пространство'}`;
   warnings.push(`Связь «${label}» не скопирована: ${!connection.b?'точка подвеса в пространстве не входит в группу':'оба связанных предмета должны входить в группу'}.`);
   continue;
  }
  if(a===b)throw new Error(`Связь «${connection.id||connectionIndex+1}» соединяет предмет с самим собой.`);
  internal.push({connection,connectionIndex,a,b});
 }
 if(points.length*internal.length>150)throw new Error('В одном построении доступно до 150 связей. Уменьшите количество копий.');
 const rng=random(s.seed),root=quat((s.rotation||[0,0,0]).map(rad)),jitter=s.jitter||0,angle=s.angleJitter||0,variation=s.scaleJitter||0;
 const objects=[],connections=[];
 for(const cell of points){
  const turn=quat((s.turn||[0,0,0]).map((v,i)=>rad(v)*cell.index+(i===1?cell.angle:0)));
  const local=cell.p.map(v=>v+(rng()-.5)*2*jitter),location=rotate(local,root).map((v,i)=>v+s.origin[i]);
  const scaleFactor=Math.max(.1,1+(rng()-.5)*2*variation);
  const orientation=qmul(qmul(root,turn),quat([0,rad((rng()-.5)*2*angle),0]));
  const transformPoint=p=>rotate(p.map(v=>v*scaleFactor),orientation).map((v,i)=>v+location[i]);
  const ids=sources.map((source,index)=>`${s.id}-${cell.index}-${index}`);
  for(const[sourceIndex,source]of sources.entries()){
   const copy=scaledPhysicalSource(source,scaleFactor);delete copy.sourceId;delete copy.offset;
   objects.push({...copy,id:ids[sourceIndex],generatorId:s.id,
    position:transformPoint(source.offset||[0,0,0]),rotation:qmul(orientation,quat(source.rotation)),
    scale:(source.scale||1)*scaleFactor,mass:(source.mass||1)*scaleFactor**3,
    fixed:fixedFor(s,source),...(s.velocity?{velocity:s.velocity.slice()}:{}),
   });
  }
  for(const{connection,connectionIndex,a,b}of internal){
   const copy={...structuredClone(connection),id:`${s.id}-${cell.index}-joint-${connectionIndex}`,generatorId:s.id,a:ids[a],b:ids[b]};
   if(connection.point)copy.point=transformPoint(connection.point);
   if(connection.length!==undefined)copy.length=connection.length*scaleFactor;
   for(const key of ['anchorA','anchorB'])if(connection[key])copy[key]=connection[key].map(v=>v*scaleFactor);
   connections.push(copy);
  }
 }
 return{objects,connections,warnings};
}
