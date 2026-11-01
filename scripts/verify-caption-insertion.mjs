import assert from 'node:assert/strict';
import { chooseCueInterval } from '../src/timed-captions.js';

const cue=(start,end)=>({start,end,text:'Existing caption'});
function check(cues,options,expected){
 const before=structuredClone(cues),range=chooseCueInterval(cues,options);assert.deepEqual(range,expected);assert.deepEqual(cues,before,'Choosing an interval must leave existing authored captions unchanged');
 if(range){assert(range.start>=0);assert(range.end<=(options.duration??120));assert(range.end-range.start>=.1-1e-9);for(const c of cues)assert(range.end<=c.start||range.start>=c.end,'A draft must not overlap another caption');}
 return range;
}
check([],{duration:20,time:6.25},{start:6.25,end:9.25});
check([],{duration:2,time:0},{start:0,end:2});
check([cue(0,7.6),cue(13.5,16.9)],{duration:16.9,time:16.9},{start:7.6,end:10.6});
check([cue(0,2),cue(5,8)],{duration:12,time:1},{start:2,end:5});
check([cue(0,2),cue(5,8)],{duration:12,time:5},{start:8,end:11});
check([cue(0,2),cue(5,8)],{duration:12,time:2},{start:2,end:5});
check([cue(0,2),cue(5,8)],{duration:12,time:4.75},{start:4.75,end:5});
check([cue(0,2),cue(5,12)],{duration:12,time:10},{start:2,end:5});
check([cue(1,5)],{duration:5,time:5},{start:0,end:1});
check([],{duration:4.137,time:4.1},{start:0,end:3});
const tiny=check([cue(0,4)],{duration:4.137,time:4.12},{start:4,end:4.137});assert.equal(tiny.end,4.137,'The exact rig duration must never round up');
check([cue(0,.9)],{duration:1,time:.9},{start:.9,end:1});
check([cue(0,2),cue(2,4)],{duration:4,time:0},null);
check([cue(0,1),cue(1.05,2)],{duration:2,time:1},null);
check([],{duration:.099,time:0},null);
check([],{duration:.1,time:.09},{start:0,end:.1});
check([cue(5,8),cue(0,2)],{duration:12,time:1},{start:2,end:5});
// Existing overlaps are treated as one occupied region while drafting; the
// editor's save validation still reports those authored overlaps separately.
assert.deepEqual(chooseCueInterval([cue(0,3),cue(2,5)],{duration:9,time:1}),{start:5,end:8});
console.log('Caption insertion passed: cursor/forward/wrap, occupied boundaries, fractional rig end, useful short gaps/minimum0.1, genuinely full track, stable existing authored intervals.');
