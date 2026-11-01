import assert from 'node:assert/strict';
import {normalizeSceneAnnotations,resolveSceneAnnotations,SCENE_ANNOTATION_LIMITS} from '../src/scene-annotations.js';

let cases=0;
const test=(name,run)=>{run();cases++;};
const label=(extra={})=>({id:'label-1',text:'Высота 25 см',position:[0,.25,0],color:'#f4f5f7',size:22,...extra});
const rejects=(extra,pattern)=>assert.throws(()=>normalizeSceneAnnotations([label(extra)]),pattern);

test('Optional data defaults to no labels',()=>assert.deepEqual(normalizeSceneAnnotations(),[]));
test('No invented text, IDs or results',()=>{
 rejects({id:undefined});rejects({text:undefined});rejects({position:undefined});rejects({color:undefined});rejects({size:undefined});
});
test('Canonical copy preserves author text and physical coordinates',()=>{
 const source=[label({text:'  Масса: 0 кг  ',size:14})],before=structuredClone(source),result=normalizeSceneAnnotations(source);
 assert.deepEqual(source,before);assert.equal(result[0].text,'Масса: 0 кг');assert.equal(result[0].color,'#F4F5F7');assert.equal(result[0].size,14);
 result[0].position[0]=500;assert.equal(source[0].position[0],0);
});
test('Maximum labels accepted without truncation',()=>assert.equal(normalizeSceneAnnotations(Array.from({length:64},(_,i)=>label({id:'label-'+i}))).length,64));
test('Too many labels rejected',()=>assert.throws(()=>normalizeSceneAnnotations(Array.from({length:65},(_,i)=>label({id:'label-'+i}))),/64/));
test('Supplied data must be an array',()=>{for(const value of [null,{},'labels',5])assert.throws(()=>normalizeSceneAnnotations(value));});
test('Duplicate IDs rejected',()=>assert.throws(()=>normalizeSceneAnnotations([label(),label()]),/уникаль/));
test('IDs must be nonempty bounded strings without whitespace',()=>{for(const id of ['',null,4,'has space','a\n', 'a'.repeat(121)])rejects({id});});
test('Source/live IDs retain punctuation and Unicode without renaming',()=>assert.equal(normalizeSceneAnnotations([label({anchorId:'сцена:источник-1/ячейка.2'})])[0].anchorId,'сцена:источник-1/ячейка.2'));
test('Text boundaries are strict',()=>{normalizeSceneAnnotations([label({text:'я'.repeat(80)})]);for(const text of ['', '  ','я'.repeat(81),'first\nsecond','tab\ttext','nul\0','line\u2028second'])rejects({text});});
test('Literal HTML remains author text, not executable markup',()=>assert.equal(normalizeSceneAnnotations([label({text:'<img src=x onerror=alert(1)>'})])[0].text,'<img src=x onerror=alert(1)>'));
test('Unknown schema fields rejected',()=>rejects({generatedResult:'48 см'},/неизвестн/));
test('Every numeric coordinate must be finite and within bounds',()=>{
 for(const position of [[0,NaN,0],[Infinity,0,0],[0,0,-Infinity],[1e8+1,0,0],['0',0,0],[0,0],{x:0,y:0,z:0}])rejects({position});
 assert.deepEqual(normalizeSceneAnnotations([label({position:[-1e8,0,1e8]})])[0].position,[-1e8,0,1e8]);
});
test('Styles reject invalid colors, ranges and numeric strings',()=>{
 for(const color of ['red','#fff','#fffffff','#12345g','#123456;display:none',null])rejects({color});
 for(const size of [13.99,48.01,NaN,Infinity,'22',null])rejects({size});
 assert.equal(normalizeSceneAnnotations([label({size:48})])[0].size,48);
});
test('World offsets without an anchor rejected',()=>rejects({offset:[0,1,0]},/привязк/));
test('Anchored offsets default to zero but saved position is retained',()=>{
 const value=normalizeSceneAnnotations([label({anchorId:'ball'})])[0];assert.deepEqual(value.offset,[0,0,0]);assert.deepEqual(value.position,[0,.25,0]);
});
test('Invalid anchor/offset rejected',()=>{for(const anchorId of ['',null,3,'a b'])rejects({anchorId});rejects({anchorId:'ball',offset:[0,Infinity,0]});rejects({anchorId:'ball',offset:[0,0]});rejects({anchorId:'ball',offset:null});});
test('Fixed world labels resolve without a position map',()=>assert.deepEqual(resolveSceneAnnotations([label()]),[{id:'label-1',text:'Высота 25 см',position:[0,.25,0],color:'#F4F5F7',size:22}]));
test('Map anchors use anchor plus offset, never stale saved world position',()=>{
 const source=[label({position:[900,900,900],anchorId:'ball',offset:[.1,.2,-.3]})],positions=new Map([['ball',[1,2,3]]]),before=structuredClone(source);
 const result=resolveSceneAnnotations(source,positions);assert.deepEqual(result[0].position,[1.1,2.2,2.7]);assert.deepEqual(source,before);assert.deepEqual(positions.get('ball'),[1,2,3]);
});
test('Own-property record and xyz objects supported',()=>assert.deepEqual(resolveSceneAnnotations([label({anchorId:'sphere'})],{sphere:{x:2,y:3,z:4}})[0].position,[2,3,4]));
test('Missing anchors hide labels instead of placing them at origin',()=>assert.deepEqual(resolveSceneAnnotations([label({anchorId:'missing'})],new Map()),[]));
test('Invalid live anchors hide only their own label',()=>{
 for(const point of [[NaN,0,0],[0,Infinity,0],[0,0],[1e9,0,0],null,'0,0,0'])assert.deepEqual(resolveSceneAnnotations([label({anchorId:'bad'}),label({id:'fixed'})],{bad:point}).map(item=>item.id),['fixed']);
});
test('Inherited record keys never resolve as anchors',()=>{const positions=Object.create({ball:[1,2,3]});assert.deepEqual(resolveSceneAnnotations([label({anchorId:'ball'})],positions),[]);});
test('Out-of-range sums are omitted without clamping or overflow',()=>assert.deepEqual(resolveSceneAnnotations([label({anchorId:'ball',offset:[1e8,0,0]})],{ball:[1e8,0,0]}),[]));
test('Resolution responds to moving anchor data',()=>{
 const source=[label({anchorId:'body',offset:[0,.5,0]})];assert.deepEqual(resolveSceneAnnotations(source,{body:[0,0,0]})[0].position,[0,.5,0]);assert.deepEqual(resolveSceneAnnotations(source,{body:[4,2,-1]})[0].position,[4,2.5,-1]);
});
test('Source and resolved arrays remain independent',()=>{const source=[label({anchorId:'body',offset:[0,1,0]})],map={body:[0,0,0]},result=resolveSceneAnnotations(source,map);result[0].position[0]=10;result[0].text='changed';assert.equal(source[0].text,'Высота 25 см');assert.equal(source[0].position[0],0);assert.equal(source[0].offset[0],0);assert.equal(map.body[0],0);});
test('Sparse arrays never bypass strict finite validation',()=>{
 assert.throws(()=>normalizeSceneAnnotations(new Array(1)));
 rejects({position:new Array(3)});rejects({anchorId:'body',offset:new Array(3)});
 assert.deepEqual(resolveSceneAnnotations([label({anchorId:'body'})],{body:new Array(3)}),[]);
});
assert.equal(SCENE_ANNOTATION_LIMITS.count,64);
console.log(`Scene annotations: ${cases} checks passed. Strict schema/limits, independent copies, literal author text, fixed positions, Map/record anchors, missing/non-finite anchors, safe coordinate sums. Editor DOM/native rendering acceptance remains separate.`);
