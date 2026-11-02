// Presentation schema only. All dimensions use a 1080 × 1920 design canvas.
// Neither a preset nor its layout can change the simulated scene or its clock.
export const GRAPHICS_PRESETS=Object.freeze([
 {id:'studio',name:'Студия',description:'Крупный тезис, спокойная подпись',headline:84,weight:700,tracking:-.035,lineHeight:1.08,rule:'short'},
 {id:'poster',name:'Плакат',description:'Выразительный заголовок и цветовая линия',headline:98,weight:800,tracking:-.04,lineHeight:1.03,rule:'side'},
 {id:'technical',name:'Наблюдение',description:'Сдержанный текст, точные измерения',headline:72,weight:600,tracking:-.025,lineHeight:1.14,rule:'hairline'},
]);
export const GRAPHICS_POSITIONS=Object.freeze([{id:'top',name:'Сверху'},{id:'center',name:'По центру'},{id:'bottom',name:'Снизу'}]);
const pick=(value,items,fallback)=>items.includes(value)?value:fallback;
const number=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const CUE_GRAPHICS_KEYS=Object.freeze(['preset','position','align','scale','labelScale','metricScale']);
export const CUE_ENTRANCES=Object.freeze(['fade','cut','rise']);

export function normalizeGraphicsStyle(input){
 const g=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 return{version:1,preset:pick(g.preset,GRAPHICS_PRESETS.map(p=>p.id),'studio'),position:pick(g.position,['top','center','bottom'],'top'),align:pick(g.align,['left','center'],'left'),scale:clamp(number(g.scale,1),.8,1.5),labelScale:clamp(number(g.labelScale,1),.85,1.6),metricScale:clamp(number(g.metricScale,1),.8,1.5),tone:pick(g.tone,['auto','light','dark'],'auto'),backdrop:pick(g.backdrop,['auto','none','soft'],'auto'),showCounter:g.showCounter===true,showProgress:g.showProgress===true};
}

/** Missing cue keys inherit; normalization never injects global defaults. */
export function normalizeCueGraphics(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return{};
 const g=normalizeGraphicsStyle(input),result={};
 for(const key of CUE_GRAPHICS_KEYS)if(Object.hasOwn(input,key)&&input[key]!==undefined)result[key]=g[key];
 return result;
}
export function resolveGraphicsStyle(global,override){return normalizeGraphicsStyle({...normalizeGraphicsStyle(global),...normalizeCueGraphics(override)});}

/** Resolved tokens travel inside every captured editorial frame to native. */
export function graphicsStyleTokens(input){
 const g=normalizeGraphicsStyle(input),p=GRAPHICS_PRESETS.find(p=>p.id===g.preset),metricPosition=g.position;
 return{version:1,...g,left:84,width:900,anchorY:{top:144,center:940,bottom:1656}[g.position],anchor:{top:0,center:.5,bottom:1}[g.position],headlineSize:p.headline*g.scale,minimumSize:60*g.scale,headlineLines:3,preferredLines:2,headlineWeight:p.weight,tracking:p.tracking,lineHeight:p.lineHeight,labelSize:36*g.scale*g.labelScale,labelGap:20,rule:p.rule,ruleGap:22,metricAnchorY:metricPosition==='bottom'?144:1656,metricAnchor:metricPosition==='bottom'?0:1,metricSize:112*g.scale*g.metricScale,metricLabelSize:27*g.scale*g.metricScale,metricUnitSize:34*g.scale*g.metricScale};
}

/** Palette uses declared studio light; it never flickers with individual frames. */
export function graphicsPalette(input,{light=false}={}){
 const g=normalizeGraphicsStyle(input),darkInk=g.tone==='dark'||g.tone==='auto'&&light;
 return{ink:darkInk?'#162B3A':'#F7FAFC',muted:darkInk?'#425D6B':'#C5D2DB',shade:darkInk?'#F1F5F6':'#071321',backdrop:g.backdrop==='auto'?(darkInk?'none':'soft'):g.backdrop,darkInk};
}

// CSS values are returned as data so this module remains usable without a DOM.
export function graphicsStyleVariables(input,{light=false,layout}={}){
 const t=layout||graphicsStyleTokens(input),p=graphicsPalette(input,{light}),cqw=n=>`${n/10.8}cqw`;
 return{'--graphics-x':`${t.left/10.8}%`,'--graphics-width':`${t.width/10.8}%`,'--graphics-y':`${t.anchorY/19.2}%`,'--graphics-anchor':`${-100*t.anchor}%`,'--graphics-size':cqw(t.headlineSize),'--graphics-minimum':cqw(t.minimumSize),'--graphics-weight':String(t.headlineWeight),'--graphics-tracking':`${t.tracking}em`,'--graphics-leading':String(t.lineHeight),'--graphics-label-size':cqw(t.labelSize),'--graphics-label-gap':cqw(t.labelGap),'--graphics-rule-gap':cqw(t.ruleGap),'--graphics-metric-y':`${t.metricAnchorY/19.2}%`,'--graphics-metric-anchor':`${-100*t.metricAnchor}%`,'--graphics-metric-size':cqw(t.metricSize),'--graphics-metric-label-size':cqw(t.metricLabelSize),'--graphics-unit-size':cqw(t.metricUnitSize),'--graphics-ink':p.ink,'--graphics-muted':p.muted,'--graphics-shade':p.shade};
}
