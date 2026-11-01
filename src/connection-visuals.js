const length=v=>Math.hypot(...v);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(v,s)=>v.map(x=>x*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(v,fallback=[0,1,0])=>length(v)>1e-10?mul(v,1/length(v)):fallback;
const rotate=(v,q)=>{const u=[q.x,q.y,q.z],uv=cross(u,v),uuv=cross(u,uv);return add(v,add(mul(uv,2*q.w),mul(uuv,2)));};

export function normalizeConnectionVisual(input){
 if(input===undefined||input===null||input===false)return null;
 const value=input===true?{enabled:true}:input;
 if(typeof value!=='object'||Array.isArray(value))throw new Error('Некорректный внешний вид связи.');
 if(value.enabled!==undefined&&typeof value.enabled!=='boolean')throw new Error('Видимость связи должна быть включена или выключена.');
 if(value.enabled===false)return null;
 const color=value.color??'#CFB375',radius=value.radius??.012,coils=value.coils??8;
 if(typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))throw new Error('Цвет связи: #RRGGBB.');
 if(!Number.isFinite(radius)||radius<.00025||radius>1)throw new Error('Радиус связи: от 0,00025 до 1 м.');
 if(!Number.isInteger(coils)||coils<3||coils>16)throw new Error('Число витков: от 3 до 16.');
 return{enabled:true,color,radius,coils};
}

/** Anchors stored when the real joint is made; never inferred from a later pose. */
export function connectionAnchors(connection){
 const one=(entity,local)=>{
  if(!entity?.body||entity.body.isValid?.()===false)return null;
  const p=entity.body.translation(),q=entity.body.rotation();return add([p.x,p.y,p.z],rotate(local||[0,0,0],q));
 };
 return[one(connection.aEntity,connection.localA),one(connection.bEntity,connection.localB)];
}

function tubeIndices(segments,sides){
 const indices=[];
 for(let j=0;j<segments;j++)for(let i=0;i<sides;i++){const a=j*sides+i,b=j*sides+(i+1)%sides,c=(j+1)*sides+i,d=(j+1)*sides+(i+1)%sides;indices.push(a,c,b,b,c,d);}
 return new Uint32Array(indices);
}

/** Weightless render geometry driven only by the solver's actual anchors. */
export function createConnectionSurface(connection){
 const look=normalizeConnectionVisual(connection.visual);if(!look)return null;
 const spring=connection.type==='spring',rope=connection.type==='rope',segments=spring?look.coils*12:rope?1:18,sides=8;
 const vertices=new Float32Array((segments+1)*sides*3),indices=tubeIndices(segments,sides);
 let last=[0,0,0];
 return{id:`connection-visual-${connection.id}`,kind:'connection',material:rope?'rubber':'metal',color:look.color,appearance:{roughness:rope?.85:.27,metalness:rope?0:.8},
  geometry(){
   const [a,b]=connectionAnchors(connection),active=a&&b&&!connection.broken&&connection.joint?.isValid?.()!==false;
   if(a)last=a;
   if(!active){for(let i=0;i<vertices.length;i+=3)vertices.set(last,i);return{vertices,indices};}
   const delta=sub(b,a),distance=length(delta),axis=unit(delta),n=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0])),v=unit(cross(axis,n));
   const coilRadius=Math.max(look.radius*2.5,Math.min(distance*.09,look.radius*6));
   const path=[];
   for(let j=0;j<=segments;j++){
    const t=j/segments,angle=t*Math.PI*2*(spring?look.coils:1);
    if(spring){const envelope=Math.min(1,t*12,(1-t)*12),offset=add(mul(n,Math.cos(angle)*coilRadius*envelope),mul(v,Math.sin(angle)*coilRadius*envelope));path.push(add(add(a,mul(delta,t)),offset));}
    else if(rope)path.push(add(a,mul(delta,t)));
    else path.push(add(a,add(mul(n,Math.cos(angle)*look.radius*3.5),mul(v,Math.sin(angle)*look.radius*3.5))));
   }
   for(let j=0;j<=segments;j++){
    const tangent=unit(sub(path[Math.min(segments,j+1)],path[Math.max(0,j-1)]),axis),normal=unit(cross(tangent,Math.abs(tangent[1])<.9?[0,1,0]:[1,0,0])),binormal=unit(cross(tangent,normal));
    for(let i=0;i<sides;i++){const angle=i/sides*Math.PI*2,point=add(path[j],add(mul(normal,Math.cos(angle)*look.radius),mul(binormal,Math.sin(angle)*look.radius)));vertices.set(point,(j*sides+i)*3);}
   }
   return{vertices,indices};
  }
 };
}
