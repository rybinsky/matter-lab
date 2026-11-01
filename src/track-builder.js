/** Authoring-only planar cubic track. Output is ordinary fixed Rapier boxes. */
export const TRACK_LIMITS=Object.freeze({segmentsMin:8,segmentsMax:64,partsMax:200,coordinate:1000,origin:10000,widthMin:.08,widthMax:8,wallHeightMin:.03,wallHeightMax:3,thicknessMin:.005,thicknessMax:.5,maxTurnDegrees:60});
export const DEFAULT_TRACK_PARAMETERS=Object.freeze({version:1,name:'Кривой желоб',points:Object.freeze([[0,2],[.8,1.8],[2.8,.25],[4,.25]].map(Object.freeze)),origin:Object.freeze([0,0,0]),yaw:0,segments:32,width:.38,wallHeight:.24,thickness:.035,friction:.45,color:'#28B8C3'});
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),fail=message=>{throw Error('Желоб: '+message);};
const number=(v,label,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(`${label}: от ${min} до ${max}.`);return v;};
const vector=(value,length,label,limit)=>{if(!Array.isArray(value)||value.length!==length||![...Array(length).keys()].every(i=>typeof value[i]==='number'&&Number.isFinite(value[i])&&Math.abs(value[i])<=limit))fail(label+': нужны конечные координаты в допустимых пределах.');return value.slice();};
export function normalizeTrackParameters(input={}){
 if(!record(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_TRACK_PARAMETERS,k)))fail('неизвестные параметры.');
 const p={...DEFAULT_TRACK_PARAMETERS,...input};if(p.version!==1)fail('поддерживается версия 1.');
 if(typeof p.name!=='string'||!p.name.trim()||p.name.length>120||/[\u0000-\u001f\u007f]/.test(p.name))fail('название — от 1 до 120 символов без переносов.');
 if(!Array.isArray(p.points)||p.points.length!==4||![0,1,2,3].every(i=>Array.isArray(p.points[i])))fail('задайте четыре точки X/Y.');
 const segments=number(p.segments,'число сегментов',8,64);if(!Number.isInteger(segments))fail('число сегментов должно быть целым.');
 if(typeof p.color!=='string'||!/^#[a-f0-9]{6}$/i.test(p.color))fail('цвет должен иметь формат #RRGGBB.');
 return{version:1,name:p.name.trim(),points:p.points.map(v=>vector(v,2,'Точка',TRACK_LIMITS.coordinate)),origin:vector(p.origin,3,'Положение',TRACK_LIMITS.origin),yaw:number(p.yaw,'азимут, °',-3600,3600),segments,width:number(p.width,'внутренняя ширина, м',.08,8),wallHeight:number(p.wallHeight,'высота стенок, м',.03,3),thickness:number(p.thickness,'толщина, м',.005,.5),friction:number(p.friction,'трение',0,2),color:p.color.toUpperCase()};
}
export function bezierPoint(points,t){const a=1-t;return[0,1].map(i=>a*a*a*points[0][i]+3*a*a*t*points[1][i]+3*a*t*t*points[2][i]+t*t*t*points[3][i]);}
export function bezierTangent(points,t){const a=1-t;return[0,1].map(i=>3*a*a*(points[1][i]-points[0][i])+6*a*t*(points[2][i]-points[1][i])+3*t*t*(points[3][i]-points[2][i]));}
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),between=(x,a,b)=>x>=Math.min(a,b)-1e-10&&x<=Math.max(a,b)+1e-10;
function intersects(a,b,c,d){const u=cross(a,b,c),v=cross(a,b,d),w=cross(c,d,a),z=cross(c,d,b);if(u*v<0&&w*z<0)return true;return[[u,c,a,b],[v,d,a,b],[w,a,c,d],[z,b,c,d]].some(([s,p,x,y])=>Math.abs(s)<1e-10&&between(p[0],x[0],y[0])&&between(p[1],x[1],y[1]));}
export function sampleTrack(input={}){
 const parameters=normalizeTrackParameters(input),points=Array.from({length:parameters.segments+1},(_,i)=>bezierPoint(parameters.points,i/parameters.segments)),segments=[];
 const px=parameters.points.map(p=>p[0]),normalSign=Math.sign(px[3]-px[0])||1,A=px[3]-3*px[2]+3*px[1]-px[0],B=2*(px[2]-2*px[1]+px[0]),C=px[1]-px[0],checks=[0,1];if(Math.abs(A)>1e-12&&-B/(2*A)>0&&-B/(2*A)<1)checks.push(-B/(2*A));
 if(checks.some(t=>(A*t*t+B*t+C)*normalSign< -1e-10))fail('кривая не должна возвращаться по X. Разверните её азимутом или измените точки.');
 for(let i=0;i<parameters.segments;i++){const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-5)fail('есть вырожденный участок. Разведите контрольные точки.');segments.push({a,b,length,angle:Math.atan2(b[1]-a[1],b[0]-a[0])});}
 for(let i=0;i<segments.length;i++)for(let j=i+2;j<segments.length;j++)if(intersects(segments[i].a,segments[i].b,segments[j].a,segments[j].b))fail('траектория пересекает себя. Разведите контрольные точки.');
 const turns=segments.slice(1).map((s,i)=>Math.atan2(Math.sin(s.angle-segments[i].angle),Math.cos(s.angle-segments[i].angle)));
 if(turns.some(t=>Math.abs(t)>TRACK_LIMITS.maxTurnDegrees*Math.PI/180))fail('слишком резкий поворот. Увеличьте число сегментов или измените точки.');
 return{parameters,points,segments,turns,normalSign,length:segments.reduce((sum,s)=>sum+s.length,0)};
}
export function buildTrack(input={}, {id='track'}={}){
 if(typeof id!=='string'||!id||id.length>160||/[\s\u0000-\u001f\u007f]/.test(id))fail('неверный идентификатор.');
 const {parameters:p,segments,turns,normalSign}=sampleTrack(input),parts=[];
 for(const[s,segment]of segments.entries()){
  const {a,b,length,angle}=segment,n=[-Math.sin(angle)*normalSign,Math.cos(angle)*normalSign],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  // Overlap covers the miter wedge up to the full wall height. Merely adding
  // a fixed tiny seam allowance leaves holes at curved joints.
  const turn=Math.max(Math.abs(turns[s-1]||0),Math.abs(turns[s]||0)),overlap=2*Math.max(p.wallHeight,p.thickness)*Math.tan(turn/2)+p.thickness*.2;
  const box=(d,position)=>({shape:'box',d,p:position,r:[0,0,angle],color:p.color});
  parts.push(box([length+overlap,p.thickness,p.width+2*p.thickness],[mid[0]-n[0]*p.thickness/2,mid[1]-n[1]*p.thickness/2,0]));
  for(const side of[-1,1])parts.push(box([length+overlap,p.wallHeight,p.thickness],[mid[0]+n[0]*p.wallHeight/2,mid[1]+n[1]*p.wallHeight/2,side*(p.width+p.thickness)/2]));
 }
 return{id,asset:'custom',name:p.name,fixed:true,kinematic:false,position:p.origin.slice(),rotation:[0,p.yaw*Math.PI/180,0],scale:1,parts,material:'metal',friction:p.friction,restitution:0,appearance:{color:p.color,roughness:.35,metalness:.35},track:p};
}
/** Reopen a moved/scaled track in its current world location. Pitch/roll would
 * violate this builder's vertical-plane domain and are not silently discarded. */
export function trackParametersFromSpec(spec){
 if(!record(spec)||!spec.track)fail('у выбранного предмета нет параметров желоба.');
 const p=normalizeTrackParameters(spec.track),scale=spec.scale??1;number(scale,'масштаб',.001,1000);
 const rotation=spec.rotation??[0,p.yaw*Math.PI/180,0];let yaw;
 if(Array.isArray(rotation)){
  if(rotation.length!==3||rotation.some(v=>!Number.isFinite(v))||Math.abs(Math.sin(rotation[0]))>1e-8||Math.abs(Math.sin(rotation[2]))>1e-8||Math.cos(rotation[0])<0||Math.cos(rotation[2])<0)fail('редактор поддерживает азимут без наклона X/Z.');yaw=rotation[1];
 }else{
  // The viewport gizmo persists quaternions even for a translation-only edit.
  if(!record(rotation)||!['x','y','z','w'].every(k=>typeof rotation[k]==='number'&&Number.isFinite(rotation[k])))fail('неверный поворот предмета.');
  const length=Math.hypot(rotation.x,rotation.y,rotation.z,rotation.w);if(length<1e-12)fail('неверный поворот предмета.');const{x,y,z,w}=Object.fromEntries(['x','y','z','w'].map(k=>[k,rotation[k]/length]));
  if(Math.abs(2*(x*y-w*z))>1e-8||Math.abs(2*(y*z+w*x))>1e-8||1-2*(x*x+z*z)<1-1e-8)fail('редактор поддерживает азимут без наклона X/Z.');yaw=Math.atan2(2*(w*y-x*z),1-2*(y*y+z*z));
 }
 return normalizeTrackParameters({...p,name:spec.name??p.name,points:p.points.map(v=>v.map(x=>x*scale)),origin:spec.position??p.origin,yaw:yaw*180/Math.PI,width:p.width*scale,wallHeight:p.wallHeight*scale,thickness:p.thickness*scale,friction:spec.friction??p.friction,color:spec.appearance?.color??p.color});
}
export function trackObjects(project){return(project?.objects||[]).map(o=>({...structuredClone(o),...structuredClone(project.edits?.[o.id]||{})})).filter(o=>!o.deleted&&o.track);}
export function compileTrackDraft(project,input,{id}={}){
 if(!record(project)||!Array.isArray(project.objects))fail('нужен проект с предметами.');const next=structuredClone(project),existing=id?next.objects.findIndex(o=>o.id===id):-1;
 if(id&&existing<0)fail('редактируемый предмет удалён. Откройте окно заново.');
 if(existing<0){if(next.objects.length>=150)fail('в сцене уже 150 предметов.');let n=1;const used=new Set(next.objects.map(o=>o.id));while(used.has('track-'+n))n++;const body=buildTrack(input,{id:'track-'+n});next.objects.push(body);return next;}
 const merged={...next.objects[existing],...next.edits?.[id]};if(!merged.track||merged.deleted)fail('выбранный желоб недоступен.');
 const built=buildTrack(input,{id}),body={...merged,...built,appearance:{...merged.appearance,...built.appearance}};delete body.visualParts;next.objects[existing]=body;if(next.edits)delete next.edits[id];return next;
}
