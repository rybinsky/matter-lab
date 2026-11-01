import {normalizeConnectionVisual} from './connection-visuals.js';
export const CONNECTION_TYPES=Object.freeze({hinge:'Шарнир',ball:'Шаровой шарнир',spring:'Пружина',rope:'Невесомая верёвка',fixed:'Жёсткая связь'});
const WORLD='world',world=id=>id===undefined||id===null||id===''||id===WORLD,optional=v=>v===undefined?'':String(v);
const numeric=(value,label)=>{if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()))throw Error(`${label}: введите конечное число.`);const number=Number(typeof value==='string'?value.trim().replace(',','.'):value);if(!Number.isFinite(number))throw Error(`${label}: введите конечное число.`);return number;};
const vector=(value,label)=>{if(!Array.isArray(value)||value.length!==3)throw Error(`${label}: нужны три локальные координаты в метрах.`);const result=[0,1,2].map(i=>numeric(value[i],label));if(result.some(v=>Math.abs(v)>10000))throw Error(`${label}: координаты от −10 000 до 10 000 м.`);return result;};

/** Independent modal draft; no live Rapier handles or resolved geometry. */
export function connectionForm(spec={}){
 const visual=normalizeConnectionVisual(spec.visual);
 return{visualEnabled:!!visual,visualColor:visual?.color||'#CFB375',visualRadius:String(visual?.radius??.012),visualCoils:String(visual?.coils??8),source:structuredClone(spec),name:spec.name||'',a:spec.a||'',b:world(spec.b)?WORLD:spec.b,type:spec.type||'fixed',axis:spec.axis||'y',pointEnabled:Array.isArray(spec.point),point:[0,1,2].map(i=>optional(spec.point?.[i]??0)),anchorA:[0,1,2].map(i=>optional(spec.anchorA?.[i]??0)),anchorB:[0,1,2].map(i=>optional(spec.anchorB?.[i]??0)),length:optional(spec.length),stiffness:optional(spec.stiffness),damping:optional(spec.damping)};
}
/** Pure authoring compile. A rope is unilateral maximum distance, never a
 * spring rest length. Local anchors are physical metres after object scale. */
export function connectionFromForm(form,entities=[]){
 const next=structuredClone(form.source||{}),name=String(form.name||'').trim(),ids=new Set(entities.filter(e=>e.id!=='ground'&&!e.soft&&e.asset!=='softcube'&&!(e.deformable&&e.deformable.enabled!==false)).map(e=>e.id));
 if(name.length>160||/[\u0000-\u001f\u007f]/.test(name))throw Error('Название связи — до 160 символов без переносов строки.');
 if(!ids.has(form.a))throw Error('Выберите существующий первый предмет.');
 if(!world(form.b)&&!ids.has(form.b))throw Error('Второй предмет удалён. Выберите другой предмет или пространство.');
 if(form.a===form.b)throw Error('Для связи нужны два разных предмета.');
 if(!Object.hasOwn(CONNECTION_TYPES,form.type))throw Error('Выберите тип связи.');
 next.a=form.a;next.b=world(form.b)?WORLD:form.b;next.type=form.type;
 if(name)next.name=name;else delete next.name;
 if(form.type==='hinge'){if(!['x','y','z'].includes(form.axis))throw Error('Выберите ось шарнира X, Y или Z.');next.axis=form.axis;}else delete next.axis;
 if(form.pointEnabled&&(form.type!=='rope'||world(form.b)))next.point=vector(form.point,'Точка связи в мире');else delete next.point;
 if(form.type==='rope'){next.anchorA=vector(form.anchorA,'Первое крепление верёвки');next.anchorB=vector(form.anchorB,'Второе крепление верёвки');}else{delete next.anchorA;delete next.anchorB;}
 for(const[key,label,max,zero]of[['length',form.type==='rope'?'Максимальная длина верёвки':'Длина покоя',10000,false],['stiffness','Жёсткость',1e8,false],['damping','Затухание',1e6,true]]){
  const used=form.type==='spring'||form.type==='rope'&&key==='length';if(!used||String(form[key]??'').trim()===''){delete next[key];continue;}
  const value=numeric(form[key],label);if(value>max||(zero?value<0:value<=0))throw Error(`${label}: ${zero?'от 0':'больше 0'} до ${max.toLocaleString('ru-RU')}.`);next[key]=value;
 }
 if(form.visualEnabled===true)next.visual=normalizeConnectionVisual({enabled:true,color:form.visualColor,radius:numeric(form.visualRadius,'Радиус графики связи'),coils:numeric(form.visualCoils,'Количество витков')});else if(form.visualEnabled===false&&Object.hasOwn(next,'visual'))next.visual={enabled:false};
 return next;
}
