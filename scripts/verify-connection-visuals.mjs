import assert from 'node:assert/strict';
import {createConnectionSurface,connectionAnchors,normalizeConnectionVisual} from '../src/connection-visuals.js';
const body=(position,rotation={x:0,y:0,z:0,w:1})=>({translation:()=>({x:position[0],y:position[1],z:position[2]}),rotation:()=>rotation,isValid:()=>true});
const q={x:0,y:0,z:Math.sin(Math.PI/4),w:Math.cos(Math.PI/4)};
const c={id:'test',type:'spring',visual:{enabled:true,radius:.01,coils:6},localA:[1,0,0],localB:[0,0,0],aEntity:{body:body([2,3,0],q)},bEntity:{body:body([2,7,0])},joint:{isValid:()=>true}};
const anchors=connectionAnchors(c);assert(Math.hypot(...anchors[0].map((x,i)=>x-[2,4,0][i]))<1e-9);assert.deepEqual(anchors[1],[2,7,0]);
const surface=createConnectionSurface(c),g=surface.geometry();assert(g.vertices.every(Number.isFinite));assert(g.indices.every(i=>i<g.vertices.length/3));
const center=j=>[0,1,2].map(k=>Array.from({length:8},(_,i)=>g.vertices[(j*8+i)*3+k]).reduce((s,x)=>s+x,0)/8);
for(const[j,expected]of [[0,anchors[0]],[72,anchors[1]]])assert(Math.hypot(...center(j).map((x,i)=>x-expected[i]))<1e-6);
const before=g.vertices.slice();c.bEntity.body=body([2,8,0]);surface.geometry();assert.notDeepEqual(g.vertices,before);
c.broken=true;surface.geometry();assert(g.vertices.every((x,i)=>Math.abs(x-anchors[0][i%3])<1e-6));
assert.equal(createConnectionSurface({...c,visual:false}),null);assert.equal(normalizeConnectionVisual(undefined),null);
for(const bad of [{color:'red'},{radius:0},{coils:1},{coils:1.5},[]])assert.throws(()=>normalizeConnectionVisual(bad));
console.log('Connection visuals: actual rotated anchors, finite constant topology, moving ends, broken-link collapse and bounds passed.');

const rope=createConnectionSurface({...c,broken:false,type:'rope'}),rg=rope.geometry();assert.equal(rg.vertices.length,2*8*3);for(const [end,expected]of [[0,anchors[0]],[1,[2,8,0]]]){const center=[0,1,2].map(k=>Array.from({length:8},(_,i)=>rg.vertices[(end*8+i)*3+k]).reduce((s,x)=>s+x,0)/8);assert(Math.hypot(...center.map((v,i)=>v-expected[i]))<1e-6);}
console.log('Rope graphics reach both actual local anchors; the ideal massless constraint does not claim a solved slack shape.');
