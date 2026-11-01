/** Author-owned spatial labels. This module has no renderer or engine state. */
export const SCENE_ANNOTATION_LIMITS=Object.freeze({count:64,text:80,id:120,coordinate:1e8,sizeMin:14,sizeMax:48});
const allowed=new Set(['id','text','position','anchorId','offset','color','size']);
const fail=message=>{throw new Error('Подписи в сцене: '+message);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=SCENE_ANNOTATION_LIMITS.coordinate;
function identifier(value,label){
 if(typeof value!=='string'||!value.length||value.length>SCENE_ANNOTATION_LIMITS.id||/[\s\u0000-\u001f\u007f]/u.test(value))fail(label+' — непустой идентификатор до 120 символов без пробелов.');
 return value;
}
function vector(value,label){
 if(!Array.isArray(value)||value.length!==3||![0,1,2].every(index=>finite(value[index])))fail(label+' — три конечные координаты в пределах ±100 000 000 м.');
 return value.slice();
}

/** undefined means no authored annotations. Invalid supplied data is rejected,
 * never silently repaired, truncated, assigned IDs or populated with outcomes.
 */
export function normalizeSceneAnnotations(value=[]){
 if(!Array.isArray(value)||value.length>SCENE_ANNOTATION_LIMITS.count)fail('нужен массив не более чем из 64 подписей.');
 const ids=new Set();
 return Array.from(value,(item,index)=>{
  const label=`Подпись ${index+1}`;
  if(!record(item)||Object.keys(item).some(key=>!allowed.has(key)))fail(label+': неизвестные или неверные поля.');
  const id=identifier(item.id,label);if(ids.has(id))fail('идентификаторы подписей должны быть уникальными.');ids.add(id);
  if(typeof item.text!=='string'||item.text.length>SCENE_ANNOTATION_LIMITS.text||/[\u0000-\u001f\u007f\u2028\u2029]/u.test(item.text)||!item.text.trim())fail(label+': введите однострочный текст до 80 символов.');
  const position=vector(item.position,label+', положение');
  if(typeof item.color!=='string'||!/^#[0-9a-f]{6}$/i.test(item.color))fail(label+': цвет должен иметь формат #RRGGBB.');
  if(typeof item.size!=='number'||!Number.isFinite(item.size)||item.size<SCENE_ANNOTATION_LIMITS.sizeMin||item.size>SCENE_ANNOTATION_LIMITS.sizeMax)fail(label+': размер текста — от 14 до 48.');
  const result={id,text:item.text.trim(),position,color:item.color.toUpperCase(),size:item.size};
  if(item.anchorId!==undefined){result.anchorId=identifier(item.anchorId,label+', привязка');result.offset=vector(item.offset===undefined?[0,0,0]:item.offset,label+', смещение');}
  else if(item.offset!==undefined)fail(label+': смещение требует привязки к предмету.');
  return result;
 });
}

function mappedPosition(positions,id){
 const value=positions instanceof Map?positions.get(id):record(positions)&&Object.hasOwn(positions,id)?positions[id]:undefined;
 const point=Array.isArray(value)?value:record(value)?[value.x,value.y,value.z]:null;
 return point?.length===3&&[0,1,2].every(index=>finite(point[index]))?point:null;
}

/** positions: Map or own-property record, id -> [x,y,z] or {x,y,z}.
 * Anchored labels resolve to anchor + offset; their saved position is unused.
 * Missing/non-finite anchors and out-of-bounds resolved points are omitted.
 * Returned labels are self-contained world data for both capture and playback.
 * Text is literal author text: an HTML renderer must use textContent/escaping.
 */
export function resolveSceneAnnotations(value,positions){
 const result=[];
 for(const annotation of normalizeSceneAnnotations(value)){
  let position=annotation.position;
  if(annotation.anchorId!==undefined){
   const anchor=mappedPosition(positions,annotation.anchorId);if(!anchor)continue;
   position=anchor.map((coordinate,index)=>coordinate+annotation.offset[index]);if(!position.every(finite))continue;
  }
  result.push({id:annotation.id,text:annotation.text,position:position.slice(),color:annotation.color,size:annotation.size});
 }
 return result;
}
