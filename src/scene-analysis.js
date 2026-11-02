import {CATALOG} from './catalog.js';
export function objectBounds(entity){
 const asset=CATALOG.find(a=>a.id===entity.asset);if(asset)return asset.size.map(n=>n*(entity.scale||1));
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const p of entity.parts){let d=p.shape==='sphere'||p.shape==='icosa'?[p.d[0]*2,p.d[0]*2,p.d[0]*2]:p.shape==='cylinder'||p.shape==='cone'?[p.d[0]*2,p.d[1],p.d[0]*2]:p.shape==='ellipsoid'?p.d.map(n=>n*2):p.d.length===2?[(p.d[0]+p.d[1])*2,p.d[1]*2,(p.d[0]+p.d[1])*2]:p.d;for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],(p.p?.[k]||0)-d[k]/2);hi[k]=Math.max(hi[k],(p.p?.[k]||0)+d[k]/2);}}
 return lo.map((n,i)=>Number.isFinite(n)?Math.max(.03,(hi[i]-n)*(entity.scale||1)):1);
}
export function chooseHero(objects,focusId){
 return objects.find(o=>o.id===focusId)||objects.filter(o=>!o.fixed).sort((a,b)=>(b.mass||1)*Math.hypot(...(b.velocity||[0,0,0]))**2-(a.mass||1)*Math.hypot(...(a.velocity||[0,0,0]))**2)[0]||objects[0];
}
const idsOf = input => new Set((Array.isArray(input) || input instanceof Set ? [...input] : []).filter(id => typeof id === 'string' && id));
const frameTime = frame => Number.isFinite(frame?.stats?.time) ? frame.stats.time : Number.isFinite(frame?.sourceTime) ? frame.sourceTime : frame?.time;
const frameObjects = frame => Array.isArray(frame?.objects) ? frame.objects : frame?.hero?.id ? [frame.hero] : [];
const speedOf = object => Array.isArray(object?.velocity) ? Math.hypot(...object.velocity) : 0;
const positionOf = objects => {
 const positions = objects.map(object => object.position).filter(position => Array.isArray(position) && position.length === 3 && position.every(Number.isFinite));
 return positions.length ? [0, 1, 2].map(axis => positions.reduce((sum, position) => sum + position[axis], 0) / positions.length) : undefined;
};

// A measured target reaction takes precedence over an unrelated force peak.
// Object records scope the observation even if a caller's global counter also
// includes moving projectiles. Sparse samples can fall back to movedObjects.
function firstTargetReaction(samples, targets) {
 const origins = new Map();
 let hasTargetRecords = false, counterCandidate = null, previousCounter;
 for (const { frame, time } of samples) {
  const objects = frameObjects(frame).filter(object => targets.has(object.id));
  if (objects.some(object => Number.isFinite(object.distance) || Array.isArray(object.position))) hasTargetRecords = true;
  const threshold = Number.isFinite(frame.stats?.movementThreshold) ? Math.max(.01, frame.stats.movementThreshold) : .2;
  const changed = new Set((frame.measuredChanges || []).filter(id => targets.has(id)));
  for (const object of objects) {
   if (!origins.has(object.id) && Array.isArray(object.position)) origins.set(object.id, object.initialPosition || object.position);
   const origin = origins.get(object.id);
   const distance = Number.isFinite(object.distance) ? object.distance : origin && Array.isArray(object.position) ? Math.hypot(...object.position.map((value, axis) => value - origin[axis])) : 0;
   if (distance > threshold) changed.add(object.id);
  }
  if (changed.size) return {
   time, type: 'break', reason: 'observed-target-reaction', change: changed.size,
   position: positionOf(objects.filter(object => changed.has(object.id))) || positionOf(objects),
   participants: [...changed], strength: .3,
  };
  const counter = frame.stats?.movedObjects;
  if (!counterCandidate && Number.isFinite(previousCounter) && Number.isFinite(counter) && counter > previousCounter + .001) {
   counterCandidate = { time, type: 'break', reason: 'observed-target-reaction', change: counter - previousCounter, position: positionOf(objects), participants: objects.map(object => object.id), strength: .3 };
  }
  if (Number.isFinite(counter)) previousCounter = counter;
 }
 return hasTargetRecords ? null : counterCandidate;
}

/** Physical source samples only. Does not mutate event or frame arrays. */
export function salientEvent(events = [], focusId, frames = [], options = {}) {
 const targets = idsOf(options?.targetIds), initiators = idsOf(options?.initiatorIds);
 if (focusId) initiators.add(focusId);
 const samples = frames.filter(Boolean).map(frame => ({ frame, time: frameTime(frame) })).filter(sample => Number.isFinite(sample.time)).sort((a, b) => a.time - b.time);
 const metadata = new Map();
 for (const { frame } of samples) for (const object of frameObjects(frame)) if (!metadata.has(object.id)) metadata.set(object.id, object);
 const scenery = id => id === 'ground' || metadata.get(id)?.fixed === true;
 const reaction = targets.size ? firstTargetReaction(samples, targets) : null;

 // Inspect nearby source samples, not only the single exact collision frame.
 const liveContact = event => {
  if (!samples.length) return true;
  if (reaction && Math.abs(event.t - reaction.time) <= .4) return true;
  const participants = new Set(event.participants || []);
  let hasRecords = false;
  for (const { frame, time } of samples) {
   if (time < event.t - .06) continue;
   if (time > event.t + .25) break;
   for (const object of frameObjects(frame)) if (participants.has(object.id) && !object.fixed) {
    hasRecords = true;
    if (speedOf(object) > .15) return true;
   }
  }
  return !hasRecords;
 };

 const candidates = events.filter(event => event && Number.isFinite(event.t) && event.t >= (targets.size ? 0 : .2) && Array.isArray(event.participants) && event.participants.length).map(event => {
  const targetContact = event.participants.some(id => targets.has(id));
  // An explicitly chosen fixed target (including the floor) is still a valid
  // experiment. Other fixed participants are incidental scenery.
  const incidentalScenery = event.participants.some(id => scenery(id) && !targets.has(id));
  const live = liveContact(event), strength = Number.isFinite(event.strength) ? Math.max(0, Math.min(1, event.strength)) : .05;
  const initiatorContact = event.participants.some(id => initiators.has(id));
  const proximity = reaction ? 10 / (1 + Math.abs(event.t - reaction.time) * 8) : 0;
  const score = targets.size
   ? (targetContact ? 100 : initiatorContact ? 30 : 10) + proximity + (initiatorContact ? 2 : 0) + strength * 2 + 1 / (1 + event.t * .08)
   : strength * (initiatorContact ? 3 : 1) / (1 + event.t * .08);
  return { event, targetContact, incidentalScenery, live, score: score * (incidentalScenery ? .06 : 1) * (live ? 1 : .1) };
 });
 const best = list => list.slice().sort((a, b) => b.score - a.score || a.event.t - b.event.t)[0];
 if (targets.size) {
  const contact = best(candidates.filter(candidate => candidate.targetContact && !candidate.incidentalScenery && candidate.live));
  if (contact) return { ...contact.event, time: contact.event.t, reason: 'target-contact' };
  if (reaction) return reaction;
  // A failed chain may still have a useful initiating contact. A floor-force
  // peak alone is not evidence that the chosen targets reacted.
  const initiating = best(candidates.filter(candidate => !candidate.incidentalScenery && candidate.live));
  if (initiating) return { ...initiating.event, time: initiating.event.t, reason: 'initiating-contact' };
 } else {
  const contact = best(candidates);
  if (contact) return { ...contact.event, time: contact.event.t };
  let strongest = null;
  for (let index = 1; index < samples.length; index++) {
   const previous = samples[index - 1].frame.stats?.metric?.value, current = samples[index].frame.stats?.metric?.value;
   if (Number.isFinite(previous) && Number.isFinite(current)) {
    const change = Math.abs(current - previous);
    if (!strongest || change > strongest.change) strongest = { time: samples[index].time, change, type: 'break', position: samples[index].frame.hero?.position, participants: focusId ? [focusId] : [], strength: .3 };
   }
  }
  if (strongest?.change > .001) return strongest;
 }
 return { time: .6, type: 'launch', position: frames[0]?.hero?.position, participants: focusId ? [focusId] : [], strength: .1 };
}
const finiteVector = value => (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === 3 && Array.from(value).every(Number.isFinite) ? Array.from(value) : null;
function unitQuaternion(value) {
 const q = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : value && typeof value === 'object' ? [value.x,value.y,value.z,value.w] : null;
 if (!q || q.length !== 4 || !q.every(Number.isFinite)) return null;
 const length = Math.hypot(...q); return length > 1e-12 ? q.map(v => v / length) : null;
}
// A quaternion and its negation encode the same physical orientation. The
// short arc also crosses the ±pi representation boundary without a false turn.
const rotationAngle = (a,b) => 2 * Math.acos(Math.max(0,Math.min(1,Math.abs(a.reduce((sum,v,i) => sum + v*b[i],0)))));

/** Physical observations only; no experiment names or guessed collision goal. */
export function assessTake(frames = [], events = [], focusId, options = {}) {
 const samples = frames.filter(Boolean).map((frame,index) => ({frame,time:Number.isFinite(frameTime(frame))?frameTime(frame):index})).sort((a,b)=>a.time-b.time);
 if (!samples.length) return {hero:focusId,duration:0,contacts:0,maxDisplacement:0,metricRange:0,maxOrientationChange:0,angularTravel:0,maxAngularSpeed:0,hasAngularMotion:false,activeRatio:0,movedObjects:0,contactExpected:false,warnings:['Нет данных о движении для проверки.'],ready:false};
 const targets = idsOf(options.targetIds); targets.delete(focusId);
 const contactExpected = typeof options.contactExpected === 'boolean' ? options.contactExpected : options.launchConfigured === true && targets.size > 0;
 let origin,firstQ,previousQ,previousTime,previousSpeed,maxDisplacement=0,maxOrientationChange=0,angularTravel=0,angularVelocityTravel=0,maxAngularSpeed=0,angularSpeedFrames=0,activeFrames=0;
 const metricValues=[];
 for (const {frame,time} of samples) {
  const stats=frame.stats||{},objects=frameObjects(frame),hero=objects.find(o=>o.id===focusId)||(!focusId?frame.hero||objects[0]:frame.hero?.id===focusId?frame.hero:null);
  const position=finiteVector(hero?.position);if(!origin&&position)origin=finiteVector(hero?.initialPosition)||position;
  const distance=Number.isFinite(hero?.distance)?hero.distance:position&&origin?Math.hypot(...position.map((v,i)=>v-origin[i])):0;
  maxDisplacement=Math.max(maxDisplacement,Number.isFinite(stats.displacement)?stats.displacement:0,distance);
  if(Number.isFinite(stats.metric?.value))metricValues.push(stats.metric.value);
  const q=unitQuaternion(hero?.quaternion??hero?.rotation),velocity=finiteVector(hero?.angularVelocity),angularSpeed=velocity?Math.hypot(...velocity):Number.isFinite(stats.heroAngularSpeed)&&(!frame.hero||frame.hero.id===focusId)?Math.abs(stats.heroAngularSpeed):0;
  maxAngularSpeed=Math.max(maxAngularSpeed,angularSpeed);if(angularSpeed>.15)angularSpeedFrames++;
  const dt=Number.isFinite(previousTime)?time-previousTime:0;let stepAngle=0;
  if(q){firstQ??=q;maxOrientationChange=Math.max(maxOrientationChange,rotationAngle(firstQ,q));if(previousQ&&dt>0){stepAngle=rotationAngle(previousQ,q);angularTravel+=stepAngle;}previousQ=q;}
  if(dt>0&&Number.isFinite(previousSpeed))angularVelocityTravel+=(previousSpeed+angularSpeed)*dt/2;
  if((stats.heroSpeed||0)>.15||stats.moving>0||angularSpeed>.15||dt>0&&stepAngle/dt>.15)activeFrames++;
  previousTime=time;previousSpeed=angularSpeed;
 }
 // Integrating measured angular speed disambiguates sparse full revolutions;
 // a lone initial speed sample is not evidence of a sustained visible turn.
 const hasAngularMotion=angularTravel>.08||maxOrientationChange>.08||angularSpeedFrames>=2&&angularVelocityTravel>.08;
 const end=samples.at(-1),start=samples[0],metricRange=metricValues.length?Math.max(...metricValues)-Math.min(...metricValues):0,movedObjects=end.frame.stats?.movedObjects||0;
 const relevant=events.filter(e=>e&&Number.isFinite(e.t)&&e.t>=start.time-1e-7&&e.t<=end.time+1e-7&&(!focusId||e.participants?.includes(focusId))&&(e.t>.2||contactExpected));
 const expectedContacts=targets.size?relevant.filter(e=>e.participants?.some(id=>targets.has(id))):relevant,warnings=[];
 if(maxDisplacement<.05&&!hasAngularMotion&&metricRange<.02&&movedObjects===0)warnings.push('Почти нет видимого изменения. Добавьте движение или взаимодействие.');
 if(contactExpected&&!expectedContacts.length&&metricRange<.02)warnings.push('В наблюдаемом времени не найден ожидаемый контакт. Проверьте начальные условия.');
 return{hero:focusId,duration:end.time,contacts:relevant.length,expectedContacts:expectedContacts.length,contactExpected,maxDisplacement,metricRange,maxOrientationChange,angularTravel,angularVelocityTravel,maxAngularSpeed,hasAngularMotion,activeRatio:activeFrames/samples.length,movedObjects,warnings,ready:warnings.length===0};
}
