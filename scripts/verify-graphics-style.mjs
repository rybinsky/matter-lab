import assert from 'node:assert/strict';
import {GRAPHICS_PRESETS,normalizeGraphicsStyle,graphicsStyleTokens,graphicsPalette,graphicsStyleVariables} from '../src/graphics-style.js';
import {normalizedStory,editorialFrame} from '../src/storyboard.js';

const input={preset:'poster',position:'bottom',align:'center',scale:1.15,tone:'dark',backdrop:'none',showCounter:true,showProgress:true};
const before=structuredClone(input),story=normalizedStory({graphics:input,cues:[{start:0,end:2,text:'{temperature} °C · {depthCm} см',label:'Прошло {physicalSeconds} с',fade:0}],metric:'speed'});
assert.deepEqual(input,before);
assert.deepEqual(normalizedStory(JSON.parse(JSON.stringify(story))).graphics,story.graphics,'All author choices must survive project serialization');
const frame=editorialFrame({story,time:1,duration:2,stats:{heroSpeed:3,readouts:{temperature:920,depthCm:13.75,physicalSeconds:11.25}}});
assert.equal(frame.caption,'920 °C · 13,8 см');assert.equal(frame.takeLabel,'Прошло 11,25 с');assert.equal(frame.metric,'3,0');
assert.deepEqual(frame.graphics,story.graphics);assert.deepEqual(frame.graphicsLayout,graphicsStyleTokens(story.graphics));
assert.equal(frame.graphicsLayout.metricAnchor,0,'Bottom captions move the measurement to the opposite edge');
assert.equal(frame.graphicsLayout.anchor,1);
assert.deepEqual(normalizeGraphicsStyle({scale:Infinity,preset:'invented',position:[],showCounter:'true'}),normalizeGraphicsStyle());
assert.equal(normalizeGraphicsStyle({scale:50}).scale,1.5);assert.equal(normalizeGraphicsStyle({scale:-2}).scale,.8);
assert.equal(graphicsPalette({}, {light:true}).darkInk,true);assert.equal(graphicsPalette({tone:'light'}, {light:true}).darkInk,false);
assert.equal(graphicsPalette({backdrop:'none'}, {light:false}).backdrop,'none');
let combinations=0;
for(const {id} of GRAPHICS_PRESETS)for(const position of ['top','center','bottom'])for(const align of ['left','center'])for(const scale of [.8,1,1.2,1.5]){
 const g={preset:id,position,align,scale},tokens=graphicsStyleTokens(g),variables=graphicsStyleVariables(g);
 assert(tokens.left>=72&&tokens.left+tokens.width<=1008);assert(tokens.anchorY>=112&&tokens.anchorY<=1660);assert(tokens.metricAnchorY>=112&&tokens.metricAnchorY<=1660);
 assert(tokens.headlineSize>=tokens.minimumSize);assert(!Object.values(variables).some(v=>/NaN|Infinity/.test(v)));
 const sample=editorialFrame({story:{graphics:g,cues:[{start:0,end:2,text:'Обычный предмет. Новый опыт.',fade:0}]},time:1,duration:2});
 assert.equal(sample.caption,'Обычный предмет. Новый опыт.');assert.deepEqual(sample.graphicsLayout,tokens);combinations++;
}
console.log(`Graphics style passed: ${combinations} author combinations, stable serialization, shared capture tokens, opposite measurement lane and preserved live readouts.`);
