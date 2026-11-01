import { EXTRA_CATALOG, extraParts } from './extra-assets.js';
import { ORGANIC_CATALOG, organicParts } from './organic-assets.js';
import { HOUSEHOLD_CATALOG, HOUSEHOLD_CATEGORIES, householdParts } from './household-assets.js';

export const MATERIALS = {
  wood: { name: 'Дерево', color: '#b89470', density: 650, friction: .60, restitution: .22, roughness: .62, metalness: 0, family: 'Твёрдое тело' },
  ceramic: { name: 'Керамика', color: '#dfddd0', density: 2200, friction: .50, restitution: .12, roughness: .30, metalness: 0, family: 'Твёрдое тело' },
  metal: { name: 'Сталь', color: '#8c9d9d', density: 7800, friction: .35, restitution: .18, roughness: .24, metalness: .75, family: 'Твёрдое тело' },
  rubber: { name: 'Резина', color: '#ed7952', density: 1100, friction: .85, restitution: .82, roughness: .45, metalness: 0, family: 'Упругий контакт' },
  ice: { name: 'Скользкий лёд', color: '#9dcbd1', density: 917, friction: .035, restitution: .16, roughness: .18, metalness: .05, family: 'Твёрдое тело' },
  cork: { name: 'Пробка', color: '#c19c68', density: 240, friction: .75, restitution: .30, roughness: .87, metalness: 0, family: 'Твёрдое тело' },
  jelly: { name: 'Желе', color: '#ab4ff5', density: 1000, friction: .50, restitution: .12, roughness: .18, metalness: 0, young: 1400, damping: .12, poisson: .42, family: 'Мягкое тело' },
  clay: { name: 'Пластилин', color: '#ef673e', density: 1700, friction: .75, restitution: 0, roughness: .63, metalness: 0, young: 4000, damping: .5, poisson: .35, plasticYield: .055, plasticCreep: 12, family: 'Пластичное тело' },
  foam: { name: 'Мягкая пена', color: '#d4e958', density: 80, friction: .70, restitution: .05, roughness: .88, metalness: 0, young: 2200, damping: .8, poisson: .15, family: 'Мягкое тело' },
  water: { name: 'Вода · модель частиц', color: '#4baad6', density: 1000, viscosity: .03, roughness: .16, metalness: .08, family: 'Жидкость DDR' },
  oil: { name: 'Масло · модель частиц', color: '#d4ad38', density: 900, viscosity: .25, roughness: .22, metalness: .08, family: 'Жидкость DDR' },
  honey: { name: 'Сироп · модель частиц', color: '#d98632', density: 1400, viscosity: .8, roughness: .25, metalness: .08, family: 'Жидкость DDR' },
};

export const CATEGORIES = ['Все', 'Интерьер', 'Детали', 'Ёмкости', 'Механизмы', 'Формы', 'Фрукты', 'Предметы', ...HOUSEHOLD_CATEGORIES];
export const CATALOG = [
  { id:'table', name:'Обеденный стол', category:'Интерьер', mat:'wood', size:[2.8,1.8,1.65] },
  { id:'chair', name:'Стул', category:'Интерьер', mat:'wood', size:[.9,1.8,.95] },
  { id:'stool', name:'Табурет', category:'Интерьер', mat:'wood', size:[.85,1.0,.85] },
  { id:'bench', name:'Скамья', category:'Интерьер', mat:'wood', size:[2.6,1.0,.8] },
  { id:'shelf', name:'Стеллаж', category:'Интерьер', mat:'wood', size:[1.6,2.8,.7] },
  { id:'crate', name:'Деревянный ящик', category:'Интерьер', mat:'wood', size:[1,1,1] },
  { id:'book', name:'Книга', category:'Интерьер', mat:'wood', mass:.8, size:[.7,.18,1] },
  { id:'lamp', name:'Настольная лампа', category:'Интерьер', mat:'metal', size:[.8,1.2,.8] },
  { id:'brick', name:'Кирпич', category:'Детали', mat:'ceramic', size:[.75,.32,.36] },
  { id:'domino', name:'Домино', category:'Детали', mat:'ceramic', size:[.45,1.0,.15] },
  { id:'plank', name:'Доска', category:'Детали', mat:'wood', size:[2.8,.18,.5] },
  { id:'panel', name:'Панель', category:'Детали', mat:'wood', size:[2,.14,1.8] },
  { id:'beam', name:'Балка', category:'Детали', mat:'metal', size:[3,.3,.3] },
  { id:'pin', name:'Кегля', category:'Детали', mat:'ceramic', size:[.5,1.3,.5] },
  { id:'dumbbell', name:'Гантель', category:'Детали', mat:'metal', size:[1.4,.6,.6] },
  { id:'bottle', name:'Бутылка', category:'Ёмкости', mat:'ice', size:[.55,1.3,.55] },
  { id:'cup', name:'Стакан', category:'Ёмкости', mat:'ceramic', size:[.72,.85,.72] },
  { id:'mug', name:'Кружка', category:'Ёмкости', mat:'ceramic', size:[1,.85,.72] },
  { id:'bowl', name:'Миска', category:'Ёмкости', mat:'ceramic', size:[1.3,.5,1.3] },
  { id:'bucket', name:'Ведро', category:'Ёмкости', mat:'metal', size:[1.35,1.3,1.35] },
  { id:'tray', name:'Поднос', category:'Ёмкости', mat:'ceramic', size:[2,.22,1.4] },
  { id:'basin', name:'Резервуар', category:'Ёмкости', mat:'ceramic', size:[4,1.1,3] },
  { id:'wheel', name:'Колесо', category:'Механизмы', mat:'rubber', size:[1.2,1.2,.35] },
  { id:'gear', name:'Шестерня', category:'Механизмы', mat:'metal', size:[1.5,.3,1.5] },
  { id:'hammer', name:'Молот', category:'Механизмы', mat:'metal', size:[1.2,2.2,.5] },
  { id:'ramp', name:'Рампа', category:'Механизмы', mat:'wood', size:[2.4,1.2,3.6] },
  { id:'stairs', name:'Ступени', category:'Механизмы', mat:'ceramic', size:[2,1.4,2.8] },
  { id:'gate', name:'Портал', category:'Механизмы', mat:'metal', size:[3,3,.5] },
  { id:'ball', name:'Шар', category:'Формы', mat:'rubber', size:[1,1,1] },
  { id:'cube', name:'Куб', category:'Формы', mat:'ceramic', size:[1,1,1] },
  { id:'cylinder', name:'Цилиндр', category:'Формы', mat:'metal', size:[.9,1.2,.9] },
  { id:'cone', name:'Конус', category:'Формы', mat:'ceramic', size:[1,1.3,1] },
  { id:'capsule', name:'Капсула', category:'Формы', mat:'rubber', size:[.65,1.6,.65] },
  { id:'ring', name:'Кольцо', category:'Формы', mat:'metal', size:[1.3,.25,1.3] },
  { id:'icosa', name:'Многогранник', category:'Формы', mat:'ceramic', size:[1,1,1] },
  { id:'softcube', name:'Мягкий объём', category:'Формы', mat:'jelly', size:[1.8,1.8,1.8] },
  ...EXTRA_CATALOG,
  ...ORGANIC_CATALOG,
  ...HOUSEHOLD_CATALOG,
];

const B=(d,p=[0,0,0],extra={})=>({shape:'box',d,p,...extra});
const S=(radius,p=[0,0,0],extra={})=>({shape:'sphere',d:[radius],p,...extra});
const Y=(radius,height,p=[0,0,0],extra={})=>({shape:'cylinder',d:[radius,height],p,...extra});
const T=(radius,tube,p=[0,0,0],extra={})=>({shape:'torus',d:[radius,tube],p,...extra});

function vessel(r,h,thick=.06) {
  const parts=[Y(r,thick,[0,-h/2+thick/2,0])];
  for(let j=0;j<20;j++) {
    const a=j*Math.PI*2/20;
    parts.push(B([r*2*Math.tan(Math.PI/20)*1.04,h,thick],[(r-thick/2)*Math.sin(a),0,(r-thick/2)*Math.cos(a)],{r:[0,a,0]}));
  }
  return parts;
}
export function assetParts(id) {
  switch(id) {
    case 'table': return [B([2.8,.16,1.65],[0,.82,0]),...[-1.12,1.12].flatMap(x=>[-.57,.57].map(z=>B([.14,1.6,.14],[x,-.05,z])))];
    case 'chair': return [B([.9,.14,.9],[0,0,0]),B([.9,.82,.12],[0,.48,-.39]),...[-.34,.34].flatMap(x=>[-.34,.34].map(z=>B([.11,.9,.11],[x,-.48,z])))];
    case 'stool': return [Y(.43,.14,[0,.42,0]),...[-.28,.28].flatMap(x=>[-.28,.28].map(z=>B([.1,.82,.1],[x,-.04,z])))];
    case 'bench': return [B([2.6,.16,.8],[0,.42,0]),B([.18,.84,.65],[-.95,-.04,0]),B([.18,.84,.65],[.95,-.04,0])];
    case 'shelf': return [...[-.75,.75].map(x=>B([.1,2.8,.7],[x,0,0])),...[-1.3,-.45,.45,1.3].map(y=>B([1.6,.1,.7],[0,y,0]))];
    case 'crate': return [B([1,.1,1],[0,-.45,0]),B([1,.1,1],[0,.45,0]),...[-.45,.45].flatMap(x=>[-.45,.45].map(z=>B([.1,1,.1],[x,0,z]))),...[-.2,.2].flatMap(y=>[B([1,.12,.07],[0,y,-.465]),B([1,.12,.07],[0,y,.465]),B([.07,.12,1],[-.465,y,0]),B([.07,.12,1],[.465,y,0])])];
    case 'book': return [B([.7,.18,1],[0,0,0]),B([.72,.025,1.02],[0,.105,0],{color:'#476f6b'}),B([.72,.025,1.02],[0,-.105,0],{color:'#476f6b'})];
    case 'lamp': return [Y(.4,.1,[0,-.55,0]),Y(.045,.8,[0,-.12,0]),{shape:'cone',d:[.38,.35],p:[0,.45,0]}];
    case 'brick': return [B([.75,.32,.36])];
    case 'domino': return [B([.45,1,.15])];
    case 'plank': return [B([2.8,.18,.5])];
    case 'panel': return [B([2,.14,1.8])];
    case 'beam': return [B([3,.3,.3])];
    case 'pin': return [Y(.19,.12,[0,-.55,0]),S(.25,[0,-.25,0]),Y(.095,.45,[0,.12,0]),S(.15,[0,.47,0]),Y(.11,.055,[0,.25,0],{color:'#d57b56'})];
    case 'dumbbell': return [Y(.065,1.15,[0,0,0],{r:[0,0,Math.PI/2]}),Y(.3,.2,[-.53,0,0],{r:[0,0,Math.PI/2]}),Y(.3,.2,[.53,0,0],{r:[0,0,Math.PI/2]})];
    case 'bottle': return [...vessel(.28,.84).map(p=>({...p,p:[p.p[0],p.p[1]-.18,p.p[2]]})),Y(.13,.35,[0,.42,0]),Y(.145,.055,[0,.61,0],{color:'#44645d'})];
    case 'cup': return vessel(.36,.85);
    case 'mug': return [...vessel(.36,.85),T(.24,.055,[.42,0,0],{r:[Math.PI/2,0,0]})];
    case 'bowl': return vessel(.65,.5,.055);
    case 'bucket': return [...vessel(.67,1.3),T(.65,.035,[0,.65,0])];
    case 'tray': return [B([2,.08,1.4],[0,-.07,0]),...[-.68,.68].map(z=>B([2,.2,.05],[0,0,z])),...[-.98,.98].map(x=>B([.05,.2,1.4],[x,0,0]))];
    case 'basin': return [B([4,.12,3],[0,-.49,0]),...[-1.45,1.45].map(z=>B([4,1.1,.1],[0,0,z])),...[-1.95,1.95].map(x=>B([.1,1.1,3],[x,0,0]))];
    case 'wheel': return [Y(.6,.3,[0,0,0],{r:[Math.PI/2,0,0]}),Y(.2,.35,[0,0,0],{r:[Math.PI/2,0,0],color:'#aab1a7'})];
    case 'gear': return [Y(.58,.22),...Array.from({length:12},(_,j)=>{const a=j*Math.PI/6; return B([.25,.24,.22],[Math.cos(a)*.64,0,Math.sin(a)*.64],{r:[0,-a,0]});})];
    case 'hammer': return [B([1.2,.5,.5],[0,.8,0]),Y(.08,1.8,[0,-.3,0],{color:'#aa835e'})];
    case 'ramp': return [B([2.4,.14,3.6],[0,0,0],{r:[-.30,0,0]}),B([.1,.35,3.6],[-1.18,.2,0],{r:[-.3,0,0]}),B([.1,.35,3.6],[1.18,.2,0],{r:[-.3,0,0]})];
    case 'stairs': return Array.from({length:6},(_,i)=>B([2,(i+1)*.23,.48],[0,(i+1)*.115-.7,i*.46-1.15]));
    case 'gate': return [B([.16,3,.4],[-1.4,0,0]),B([.16,3,.4],[1.4,0,0]),B([3,.16,.4],[0,1.45,0])];
    case 'ball': return [S(.5)];
    case 'cube': return [B([1,1,1])];
    case 'softcube': return [B([1.8,1.8,1.8])];
    case 'cylinder': return [Y(.45,1.2)];
    case 'cone': return [{shape:'cone',d:[.5,1.3],p:[0,0,0]}];
    case 'capsule': return [Y(.325,.95),S(.325,[0,.475,0]),S(.325,[0,-.475,0])];
    case 'ring': return [T(.52,.13)];
    case 'icosa': return [{shape:'icosa',d:[.6],p:[0,0,0]}];
    default: return extraParts(id)||organicParts(id)||householdParts(id)||[B([1,1,1])];
  }
}

export const EXPERIMENTS = [
  { id:'impact', title:'Комната под ударом', subtitle:'Скорость, масса и передача импульса', tag:'Твёрдые тела', color:'#d77953', icon:'sofa', views:[8,6,12], target:[0,1.3,0], variants:[
    {label:'Мягкий бросок', detail:'4 м/с · резиновый шар', speed:4, material:'rubber'},
    {label:'Больше скорости', detail:'8 м/с · резиновый шар', speed:8, material:'rubber'},
    {label:'Тяжёлый снаряд', detail:'8 м/с · стальной шар', speed:8, material:'metal'},
    {label:'Максимальный импульс', detail:'14 м/с · стальной шар', speed:14, material:'metal'},
  ]},
  { id:'cascade', title:'Каскад и развилки', subtitle:'Домино, препятствия и цепная реакция', tag:'Конструкции', color:'#6c958a', icon:'blocks', views:[8,9,11], target:[0,.5,0], variants:[
    {label:'Плотная расстановка', detail:'Зазор 0,32 м · керамика', gap:.32, material:'ceramic'},
    {label:'Широкий шаг', detail:'Зазор 0,55 м · керамика', gap:.55, material:'ceramic'},
    {label:'Лёгкая пробка', detail:'Зазор 0,38 м · пробка', gap:.38, material:'cork'},
    {label:'Скользкая опора', detail:'Зазор 0,38 м · низкое трение', gap:.38, material:'ice'},
  ]},
  { id:'mechanism', title:'Рычаг и катапульта', subtitle:'Падение груза превращается в полёт', tag:'Механизмы', color:'#a697bc', icon:'git-fork', views:[8,5,11], target:[0,1.3,0], variants:[
    {label:'Меньше высоты', detail:'Груз 12 кг · падение с 1,2 м', mass:12, dropHeight:1.2},
    {label:'Больше высоты', detail:'Груз 12 кг · падение с 2,4 м', mass:12, dropHeight:2.4},
    {label:'Больше массы', detail:'Груз 30 кг · падение с 2,4 м', mass:30, dropHeight:2.4},
    {label:'Максимальный запуск', detail:'Груз 30 кг · падение с 3,6 м', mass:30, dropHeight:3.6},
  ]},
  { id:'soft', title:'Материал под прессом', subtitle:'Упругость, затухание и остаточная деформация', tag:'Мягкие тела', color:'#b88e78', icon:'scan-line', views:[7,5,9], target:[0,1.4,0], variants:[
    {label:'Упругое желе', detail:'Восстанавливает форму · E = 1,4 кПа', material:'jelly', depth: 1.15},
    {label:'Мягкая пена', detail:'Сильное затухание · E = 2,2 кПа', material:'foam', depth: 1.15},
    {label:'Пластилин', detail:'Остаточная деформация · порог 5,5%', material:'clay', depth: 1.15},
    {label:'Сильное сжатие', detail:'Пластилин · увеличенный ход пресса', material:'clay', depth: 1.45},
  ]},
  { id:'flow', title:'Поток по желобу', subtitle:'Частицы жидкости, вязкость и сила тяжести', tag:'Жидкости', color:'#739eab', icon:'droplets', views:[6,9,-13], target:[0,2.0,-.5], variants:[
    {label:'Вода', detail:'Малая вязкость · наклон 18°', material:'water', slope:18},
    {label:'Масло', detail:'Средняя вязкость · наклон 18°', material:'oil', slope:18},
    {label:'Вязкий сироп', detail:'Высокая вязкость · наклон 18°', material:'honey', slope:18},
    {label:'Крутой желоб', detail:'Вязкий сироп · наклон 34°', material:'honey', slope:34},
  ]},
  { id:'thermal', title:'Раскалённый шар и лёд', subtitle:'Охлаждение, теплообмен и глубина канала', tag:'Тепло и фаза',color:'#ed7547',icon:'flame',views:[1.5,1.2,2.1],target:[0,.55,0],variants:[
    {label:'Масса 250 г',detail:'1000 °C · лёд −10 °C · h = 1000 Вт/(м²·К)',mass:.25,temperature:1000,material:'metal'},
    {label:'Масса 1 кг',detail:'1000 °C · тот же коэффициент теплообмена',mass:1,temperature:1000,material:'metal'},
    {label:'Масса 4 кг',detail:'1000 °C · увеличивается и радиус шара',mass:4,temperature:1000,material:'metal'},
    {label:'Масса 8 кг',detail:'1000 °C · сравнение глубины за одинаковое время',mass:8,temperature:1000,material:'metal'},
  ]},
  { id:'orbit',title:'Кирпич на орбите Луны',subtitle:'Один старт и четыре начальные скорости',tag:'Орбитальная механика',color:'#598cce',icon:'orbit',views:[0,0,20],target:[0,0,0],variants:[
    {label:'Недостаточно скорости',detail:'Луна · высота 100 км · 1200 м/с',speed:1200,planet:'moon',altitude:100000,timeScale:90},
    {label:'Круговая орбита',detail:'Луна · высота 100 км · 1633,5 м/с',speed:1633.504,planet:'moon',altitude:100000,timeScale:1000},
    {label:'Эллиптическая орбита',detail:'Луна · высота 100 км · 1850 м/с',speed:1850,planet:'moon',altitude:100000,timeScale:1600},
    {label:'Уход от Луны',detail:'Луна · высота 100 км · 2500 м/с',speed:2500,planet:'moon',altitude:100000,timeScale:1600},
  ]},
];

export const DEFAULT_SETTINGS = {
  experiment:'impact', variant:0, gravity:9.81, speed:8, azimuth:180, elevation:0,
  material:'rubber', mass:12, friction:.5, restitution:.4, slope:18,
  gap:.38, angle:55, depth:.9, slowMotion:1, showGrid:true, showTrails:true,
  background:'studio', theme:'day', seed:42,
  temperature:1000,iceTemperature:-10,iceHeight:.7,contactH:1000,thermalTimeScale:40,
  planet:'moon',altitude:100000,timeScale:1000,orbitAsset:'brick',
  windSpeed:0,cameraMode:'dolly',renderStyle:'cinematic',audioPreset:'auto',dropHeight:2.4,
};

const STORY_RECIPES={
 impact:{title:'Один шар против комнаты',hook:'Сколько предметов сдвинет один шар?',question:'Меняем скорость и массу',metric:'moved'},
 cascade:{title:'Дойдёт ли цепная реакция до конца?',hook:'Одного толчка хватит на весь маршрут?',question:'Меняем шаг и материал',metric:'moved'},
 mechanism:{title:'Масса или высота?',hook:'Маленький груз взлетит выше?',question:'Меняем массу или высоту падения'},
 soft:{title:'Сжать. Отпустить. Сравнить.',hook:'Что останется после сжатия?',question:'Желе, пена или пластилин?'},
 flow:{title:'Вода. Масло. Сироп.',hook:'Сколько жидкости дойдёт за 7,5 с?',question:'Один объём. Разная вязкость.'},
 thermal:{title:'1000 °C. Четыре массы.',hook:'Пройдёт ли шар сквозь лёд?',question:'Меняем только массу шара'},
 orbit:{title:'Один кирпич. Четыре скорости.',hook:'Кирпич может стать спутником?',question:'Меняем скорость. Старт — 100 км.',effects:{trail:true}},
};

export function settingsFor(id, variant=0) {
  const ex=EXPERIMENTS.find(e=>e.id===id)||EXPERIMENTS[0];
  return {...DEFAULT_SETTINGS, experiment:id, variant, connections:[],emitters:[],story:{duration:60,tempo:'fast',camera:'auto',...structuredClone(STORY_RECIPES[id]||{})},...ex.variants[variant]};
}
