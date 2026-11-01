import assert from 'node:assert/strict';
import {DEFAULT_TRACK_PARAMETERS,normalizeTrackParameters,bezierPoint,bezierTangent,sampleTrack,buildTrack,trackParametersFromSpec,trackObjects,compileTrackDraft} from '../src/track-builder.js';
import {initializePhysics,LabWorld} from '../src/physics.js';
import {settingsFor} from '../src/catalog.js';
import {validateProject} from '../src/validation.js';
let checks=0;const check=(test,message)=>{assert(test,message);checks++;},near=(a,b,tolerance,message)=>check(Math.abs(a-b)<=tolerance,message+`: ${a} vs ${b}`),clone=structuredClone;
const source=clone(DEFAULT_TRACK_PARAMETERS),snapshot=clone(source),sample=sampleTrack(source),body=buildTrack(source,{id:'course'});
assert.deepEqual(source,snapshot);checks++;
assert.deepEqual(bezierPoint(source.points,0),source.points[0]);assert.deepEqual(bezierPoint(source.points,1),source.points[3]);checks+=2;
assert.deepEqual(bezierTangent(source.points,0),source.points[1].map((v,i)=>3*(v-source.points[0][i])));checks++;
for(const count of[8,32,64]){const body=buildTrack({...source,segments:count});check(body.parts.length===count*3&&body.parts.length<=200,'Three ordinary boxes per segment');check(body.fixed&&body.asset==='custom','Static ordinary custom body');}
for(const invalid of[{segments:7},{segments:65},{segments:8.5},{width:0},{wallHeight:4},{thickness:0},{friction:-1},{yaw:Infinity},{points:[[0,0],[0,0],[0,0],[0,0]]},{points:[[0,2],[-1,1],[2,0],[3,0]]},{color:'red'},{origin:[0,NaN,0]},{unknown:true}]){assert.throws(()=>buildTrack({...source,...invalid}));checks++;}
const heading=buildTrack({...source,origin:[2,3,-4],yaw:73},{id:'heading'});near(heading.rotation[1],73*Math.PI/180,1e-15,'Heading uses degrees once');assert.deepEqual(heading.position,[2,3,-4]);checks++;
const rotated=(point,body)=>{const c=Math.cos(body.rotation[1]),s=Math.sin(body.rotation[1]);return[body.position[0]+c*point[0]+s*point[2],body.position[1]+point[1],body.position[2]-s*point[0]+c*point[2]];};
const endpoint=rotated([...source.points[3],0],heading);near(endpoint[0],2+Math.cos(73*Math.PI/180)*4,1e-12,'Endpoint transformed by body heading');near(endpoint[2],-4-Math.sin(73*Math.PI/180)*4,1e-12,'Endpoint Z transformed by body heading');
// Every floor sample lies inside its box face; every miter-height sample is
// covered by at least one adjacent wall. This tests geometry, not metadata.
const inside=(part,point,eps=1e-9)=>{const a=part.r[2],dx=point[0]-part.p[0],dy=point[1]-part.p[1],local=[Math.cos(a)*dx+Math.sin(a)*dy,-Math.sin(a)*dx+Math.cos(a)*dy,point[2]-part.p[2]];return local.every((v,k)=>Math.abs(v)<=part.d[k]/2+eps);};
for(let i=0;i<sample.segments.length;i++){const segment=sample.segments[i];for(const p of[segment.a,segment.b])check(inside(body.parts[i*3],[p[0],p[1],0]),'Floor surface endpoints covered');}
for(let i=1;i<sample.points.length-1;i++){
 const angle=(sample.segments[i-1].angle+sample.segments[i].angle)/2,n=[-Math.sin(angle),Math.cos(angle)],p=sample.points[i];
 for(const h of[0,.05,.12,.23])for(const side of[-1,1]){const point=[p[0]+n[0]*h,p[1]+n[1]*h,side*(source.width+source.thickness)/2];check(inside(body.parts[(i-1)*3+(side===-1?1:2)],point)||inside(body.parts[i*3+(side===-1?1:2)],point),'No holes across wall joint height');}
}
const reverse=buildTrack({...source,points:source.points.map(p=>[-p[0],p[1]])});check(reverse.parts[0].p[1]<((source.points[0][1]+bezierPoint(source.points,1/32)[1])/2),'Reverse-X floor faces upward');
const project={version:1,name:'Unrelated scene',objects:[],edits:{},settings:{...settingsFor('blank'),focusId:'old',story:{enabled:false},cameraRig:{mode:'keys',points:[]}}},before=clone(project),added=compileTrackDraft(project,source),id=added.objects[0].id;
assert.deepEqual(project,before);checks++;validateProject(added);check(trackObjects(added).length===1,'Authoring metadata survives ordinary project validation');
const edited=compileTrackDraft(added,{...source,points:[[0,3],[1,2],[3,.8],[5,.8]],yaw:40},{id});check(edited.objects.length===1&&edited.objects[0].id===id,'Editing preserves stable identity');assert.deepEqual(edited.settings,added.settings);checks++;
assert.deepEqual(trackParametersFromSpec(JSON.parse(JSON.stringify(edited.objects[0]))),normalizeTrackParameters({...source,points:[[0,3],[1,2],[3,.8],[5,.8]],yaw:40}));checks++;
const moved=clone(edited.objects[0]);moved.position=[9,2,7];moved.rotation=[0,.6,0];moved.scale=2;const reopened=trackParametersFromSpec(moved);near(reopened.width,source.width*2,0,'Reopen current scaled width');near(reopened.yaw,.6*180/Math.PI,1e-12,'Reopen current yaw');assert.deepEqual(reopened.origin,[9,2,7]);checks++;
assert.throws(()=>trackParametersFromSpec({...moved,rotation:[.2,.6,0]}));checks++;
const gizmoMoved={...moved,rotation:{x:0,y:Math.sin(.6/2),z:0,w:Math.cos(.6/2)}},gizmoReopened=trackParametersFromSpec(gizmoMoved);near(gizmoReopened.yaw,.6*180/Math.PI,1e-12,'Viewport quaternion reopens unchanged heading');assert.deepEqual(gizmoReopened.origin,moved.position);checks++;
assert.throws(()=>trackParametersFromSpec({...moved,rotation:{x:Math.sin(.2),y:0,z:0,w:Math.cos(.2)}}));checks++;
const withEdits=clone(added);withEdits.edits[id]={position:[7,0,8],rotation:[0,.5,0],scale:1.5,appearance:{color:'#445566'},friction:.2};const editedAgain=compileTrackDraft(withEdits,trackParametersFromSpec(trackObjects(withEdits)[0]),{id});check(!editedAgain.edits[id]&&editedAgain.objects[0].position[0]===7,'Merged edits reopen without stale geometry/transform override');assert.deepEqual(withEdits.edits[id].position,[7,0,8]);checks++;
await initializePhysics();const results=[];
for(const yaw of[0,37])for(const hz of[120,240]){
 const input={...source,segments:64,yaw,origin:[-.5,0,1]},track=buildTrack(input,{id:'run-track'}),first=sampleTrack(input).segments[0],normal=[-Math.sin(first.angle),Math.cos(first.angle)],r=.08,mass=650*4/3*Math.PI*r**3,start=rotated([first.a[0]+normal[0]*r,first.a[1]+normal[1]*r,0],track),ball={id:'rolling',asset:'custom',parts:[{shape:'sphere',d:[r],p:[0,0,0],color:'#F5E8C8'}],position:start,mass,material:'wood',friction:.45,restitution:0,linearDamping:0,angularDamping:0},p={version:1,objects:[track,ball],edits:{},settings:{...settingsFor('blank'),autoLaunch:false,gravity:9.81}};validateProject(p);const w=new LabWorld(p.settings,p.objects,p.edits),e=w.find('rolling'),initial=mass*9.81*start[1];let maxEnergy=initial,arrival=null,maxLateral=0;
 try{for(let i=1;i<=8*hz;i++){w.step(1/hz);const pos=e.body.translation(),v=e.body.linvel(),spin=e.body.angvel(),dx=pos.x-track.position[0],dz=pos.z-track.position[2],angle=yaw*Math.PI/180,localX=Math.cos(angle)*dx-Math.sin(angle)*dz,localZ=Math.sin(angle)*dx+Math.cos(angle)*dz;maxEnergy=Math.max(maxEnergy,mass*9.81*pos.y+.5*mass*(v.x*v.x+v.y*v.y+v.z*v.z)+.2*mass*r*r*(spin.x*spin.x+spin.y*spin.y+spin.z*spin.z));if(localX<4){maxLateral=Math.max(maxLateral,Math.abs(localZ));check(Math.abs(localZ)<input.width/2-r+.006,'Sphere stays laterally inside real U-gutter');check(pos.y>-.001,'No escape through floor before finish');}if(localX>=4){arrival=i/hz;break;}}
  check(arrival!==null,'Real Rapier sphere reaches track end');check(maxEnergy/initial<=1.01,'No unexpected mechanical energy gain');results.push({yaw,hz,arrival,maxLateral,maxEnergyRatio:maxEnergy/initial});
 }finally{w.dispose();}
}
console.log(JSON.stringify({checks,physics:results,scope:'New pure builder only: ordinary fixed boxes, no engine changes. UI draft/cancel/stale workflow requires browser integration review.'}));
