export const ENVIRONMENTS=[
 {id:'studio',name:'Ночная студия',description:'Глубокий фон, тёплый контровой свет',background:'#0d1019',floor:'#1a2130',keyColor:'#fff0dc',fillColor:'#9fc8ff',exposure:0,saturation:1.06,roughness:.57},
 {id:'gallery',name:'Светлая галерея',description:'Светлый циклорама, мягкие тени',background:'#e7e3db',floor:'#d8d2c4',keyColor:'#fff9ec',fillColor:'#c3d9ee',exposure:.08,saturation:1.04,roughness:.64},
 {id:'arena',name:'Кинетическая арена',description:'Индиго, бирюзовый и янтарный свет',background:'#13182d',floor:'#242d47',keyColor:'#ffe3bf',fillColor:'#72d6e4',exposure:.1,saturation:1.13,roughness:.5},
];
const hex=(v,d)=>/^#[a-f0-9]{6}$/i.test(v||'')?v:d;
export function normalizeEnvironment(input){
 if(!input)return null;const raw=typeof input==='string'?{id:input}:input;
 const preset=ENVIRONMENTS.find(e=>e.id===raw.id)||ENVIRONMENTS[0];
 return{...preset,background:hex(raw.background,preset.background),floor:hex(raw.floor,preset.floor),keyColor:hex(raw.keyColor,preset.keyColor),fillColor:hex(raw.fillColor,preset.fillColor),exposure:Number.isFinite(raw.exposure)?Math.max(-1,Math.min(1,raw.exposure)):preset.exposure};
}
