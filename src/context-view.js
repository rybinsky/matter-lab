/** A second view observes the same scene and simulation time as the main camera. */
export function normalizeContextView(value){
 if(value==null||value.enabled===false)return null;
 if(typeof value!=='object'||Array.isArray(value)||value.enabled!==undefined&&typeof value.enabled!=='boolean')throw Error('Некорректный дополнительный ракурс.');
 const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||v.some(n=>!Number.isFinite(n)||Math.abs(n)>10000))throw Error(`Дополнительный ракурс: ${name}.`);return v.slice();};
 const position=vector(value.position,'координаты камеры'),target=vector(value.target,'точка наблюдения');
 if(Math.hypot(...position.map((x,i)=>x-target[i]))<.015)throw Error('Дополнительная камера слишком близко к точке наблюдения.');
 const fov=value.fov??40,size=value.size??.35;
 if(!Number.isFinite(fov)||fov<15||fov>90||!Number.isFinite(size)||size<.2||size>.48)throw Error('Дополнительный ракурс: угол 15–90°, размер 20–48% кадра.');
 const corner=value.corner??'bottom-right';if(!['bottom-right','bottom-left','top-right','top-left'].includes(corner))throw Error('Выберите угол для дополнительного ракурса.');
 const label=value.label??'';if(typeof label!=='string'||label.length>80||/[\u0000-\u001f]/.test(label))throw Error('Название дополнительного ракурса — до 80 символов.');
 return{enabled:true,position,target,fov,size,corner,label};
}
export function contextViewRect(value,width,height){
 const config=normalizeContextView(value);if(!config)return null;
 const margin=Math.min(width,height)*.035,w=width*config.size,h=height*config.size;
 return{x:config.corner.endsWith('right')?width-margin-w:margin,y:config.corner.startsWith('top')?height-margin-h:margin,width:w,height:h};
}
