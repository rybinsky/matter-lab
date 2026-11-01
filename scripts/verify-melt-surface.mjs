import assert from 'node:assert/strict';
import {HeatPenetration} from '../src/phenomena.js';
import {settingsFor} from '../src/catalog.js';
let size,checks=0;
for(const mass of [.005,.05,.25,1,8,30]){
 const model=new HeatPenetration({...settingsFor('thermal'),mass});
 for(const fraction of [0,.01,.15,.5,1,1.5,3,6]){
  model.depth=Math.min(model.height*.9,model.r*fraction);
  const g=model.geometry();size??=g.vertices.length;assert.equal(g.vertices.length,size,'Interpolated frames need identical topology');assert([...g.vertices].every(Number.isFinite));assert(Math.max(...g.indices)<g.vertices.length/3);
  if(model.depth>0){
   // Every cavity interval containing the tip must terminate exactly at it.
   const tipY=model.base+model.height-model.depth,ys=[];
   for(let i=0;i<g.vertices.length;i+=3)if(Math.abs(g.vertices[i])<model.r*1.01&&g.vertices[i+2]<-.00000001)ys.push(g.vertices[i+1]);
   assert(ys.every(y=>y>=tipY-1e-7),'Cavity cannot protrude below the sphere tip');
   const tipVertices=[];for(let i=0;i<g.vertices.length;i+=3)if(Math.abs(g.vertices[i])<1e-7&&Math.abs(g.vertices[i+2])<1e-7)tipVertices.push(g.vertices[i+1]);
   assert(tipVertices.some(y=>Math.abs(y-tipY)<1e-6),'Exact melt-front tip must exist');
  }
  checks++;
 }
}
console.log(`Melt surface passed: ${checks} radius/depth states, fixed ${size/3} vertices, finite geometry, exact tip and no cone below the heated sphere.`);
