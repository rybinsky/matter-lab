// Camera direction is independent from physics. A story contains an opening,
// a spatial reveal, a tracked action and a measured result.
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
const scaleMix=(a,b,t)=>Math.exp(Math.log(a)+(Math.log(b)-Math.log(a))*t);
export function physicalTime(movieTime,duration=15,experiment='impact'){
 const start=duration*.32,end=duration-Math.min(2.2,duration*.15);
 const maximum=experiment==='mechanism'?2.9:7.5;
 return clamp((movieTime-start)/(end-start))*maximum;
}
export function movieTimeForPhysical(t,duration=15,experiment='impact'){
 const start=duration*.32,end=duration-Math.min(2.2,duration*.15),maximum=experiment==='mechanism'?2.9:7.5;
 return start+Math.min(maximum,t)/maximum*(end-start);
}
export function direct({experiment,phase,actors={},state={},stats={},settings={},view=[8,6,12],target=[0,1.4,0]}){
 const p=clamp(phase),base=target.slice(),mode=settings.cameraMode||'dolly';
 let focusId=settings.focusId||({thermal:'hot-ball',soft:'specimen',orbit:'projectile',mechanism:'projectile',flow:'fluid-source'}[experiment]||'projectile');
 let hero=actors[focusId]||base;
 let wideScale={thermal:.96,soft:3.8,orbit:7.8,mechanism:5.6,flow:7.2,impact:6.4,cascade:8}[experiment]||7;
 let macroScale={thermal:Math.max(.08,(state.radius||.04)*3.2),soft:1.75,orbit:.28,mechanism:1.35,flow:1.35,impact:1.6,cascade:1.4}[experiment]||1.6;
 let actionTarget=base.slice(),actionScale=wideScale*.85,caption='',outcome='',label='';
 const stage=p<.13?'prepare':p<.32?'reveal':p<.84?'action':'result';
 if(experiment==='thermal'){
   actionTarget=mix([0,.59,0],hero,.5);actionScale=.62;
   caption='Лёд показан в разрезе. Одинаковая начальная температура.';
   outcome=state.passed?'Прошёл насквозь':`За ${Math.round(state.elapsed||0)} с · глубина ${((state.depth||0)*100).toFixed(1)} см`;
   label=`Шар · ${settings.mass} кг`;
 }
 if(experiment==='soft'){
   hero=actors.specimen||[0,1.0,0];base[1]=1.55;actionTarget=mix(base,hero,.78);actionScale=2.05;
   const t=stats.time||0;caption=t<.6?'Материал до нагрузки':t<2.6?'Сжимаем материал':t<3.4?'Удерживаем плиту':t<4.8?'Снимаем нагрузку':'Сравниваем восстановление';
   const recovery=Math.round((stats.softHeight||1.4)/1.4*100);
   outcome=settings.material==='clay'?`Осталась вмятина · высота ${recovery}%`:`Восстановление · высота ${recovery}%`;
   label=settings.material==='clay'?'Пластилин':settings.material==='foam'?'Мягкая пена':'Упругое желе';
 }
 if(experiment==='mechanism'){
   if((stats.time||0)>1.0){focusId='payload';hero=actors.payload||base;}
   actionTarget=mix([0,1.1,0],hero,.68);actionScale=Math.max(2.7,Math.abs(hero[1]-1.1)*.55+1.7);
   caption=(stats.time||0)<1.0?'Оранжевый груз падает на рычаг':'Голубой груз получает импульс и взлетает';
   outcome=`Подъём груза: ${Math.max(0,(stats.apex||1.25)-1.25).toFixed(2)} м`;
   label=focusId==='payload'?'Подбрасываемый груз':'Падающий груз';
 }
 if(experiment==='flow'){
   hero=actors['fluid-source']||[0,5.0,3];
   actionTarget=stats.flowFront||[0,2,0];actionScale=3.1;
   caption='Одинаковый объём. Меняем вязкость или наклон.';
   outcome=`До резервуара дошло ${stats.collected||0} из ${stats.particles||0} частиц`;
   label='Фронт потока';
 }
 if(experiment==='orbit'){
   const r=(state.planetRadius||1737400)/500000;
   const minX=Math.min(-r,hero[0]),maxX=Math.max(r,hero[0]),minY=Math.min(-r,hero[1]),maxY=Math.max(r,hero[1]);
   base[0]=(minX+maxX)/2;base[1]=(minY+maxY)/2;base[2]=0;
   wideScale=Math.max(7.4,(maxY-minY)*.59,(maxX-minX)/1.125*1.15);actionScale=wideScale;actionTarget=base.slice();
   const speed=state.initialSpeed||settings.speed,vc=state.circularSpeed||1633.504,ve=vc*Math.SQRT2;
   outcome=state.status==='impact'?'Столкновение с поверхностью':speed>=ve?'Улетает от Луны':Math.abs(speed-vc)<vc*.01?'Круговая орбита':'Эллиптическая орбита';
   caption='Вакуум. Движение определяется центральным тяготением.';label=settings.orbitAsset==='brick'?'Кирпич':'Снаряд';
 }
 let shotTarget=hero.slice(),shotScale=macroScale;
 if(p>=.12&&p<.32){const blend=smooth((p-.12)/.20);shotTarget=mix(hero,base,experiment==='orbit'?smooth((blend-.3)/.7):blend);shotScale=scaleMix(macroScale,wideScale,blend);}
 else if(p>=.32&&p<.48){const blend=smooth((p-.32)/.16);shotTarget=mix(base,actionTarget,blend);shotScale=scaleMix(wideScale,actionScale,blend);}
 else if(p>=.48&&p<.78){shotTarget=actionTarget;shotScale=actionScale;}
 else if(p>=.78){const blend=smooth((p-.78)/.16);shotTarget=mix(actionTarget,base,blend);shotScale=scaleMix(actionScale,wideScale,blend);}
 if(mode==='free'){shotTarget=base;shotScale=wideScale;}
 if(mode==='orbit'){shotTarget=base;shotScale=wideScale*.86;}
 if(mode==='follow'){shotTarget=hero;shotScale=Math.max(macroScale*2,.7);}
 let direction=view.map((x,i)=>x-target[i]);
 if(experiment==='orbit')direction=[0,0,1];
 const angle=mode==='free'||experiment==='orbit'?0:mode==='orbit'?p*.8:.08*Math.sin(p*Math.PI);
 direction=[direction[0]*Math.cos(angle)+direction[2]*Math.sin(angle),direction[1],direction[2]*Math.cos(angle)-direction[0]*Math.sin(angle)];
 const length=Math.hypot(...direction)||1;
 let distance=shotScale/Math.tan(Math.PI/9);
 if(experiment==='orbit'){
   const r=(state.planetRadius||1737400)/500000;
   distance=Math.max(distance,Math.sqrt(Math.max(0,(r*1.05)**2-shotTarget[0]**2-shotTarget[1]**2))+.25);
   shotScale=distance*Math.tan(Math.PI/9);
 }
 // Keep the hero inside the unobscured vertical frame, including the reveal.
 if(['orbit','mechanism','thermal'].includes(experiment)){
   const dir=direction.map(x=>x/length),right=[dir[2],0,-dir[0]],rn=Math.hypot(...right)||1;
   for(let k=0;k<3;k++)right[k]/=rn;
   const up=[dir[1]*right[2]-dir[2]*right[1],dir[2]*right[0]-dir[0]*right[2],dir[0]*right[1]-dir[1]*right[0]];
   const delta=hero.map((x,i)=>x-shotTarget[i]),dot=a=>delta.reduce((s,x,i)=>s+x*a[i],0),tangent=Math.tan(Math.PI/9);
   distance=Math.max(distance,dot(dir)+Math.max(Math.abs(dot(right))/(tangent*.5625*.82),Math.abs(dot(up))/(tangent*.56)));
   shotScale=distance*tangent;
 }
 const position=shotTarget.map((x,i)=>x+direction[i]/length*distance);
 return{position,target:shotTarget,scale:shotScale,hero:focusId,label,stage,caption,outcome,marker:experiment==='orbit'&&p>.25};
}
