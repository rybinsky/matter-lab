export const READOUT_VARIABLES=Object.freeze([
 {id:'maxCableTensionN',label:'Наибольшее текущее натяжение тросов, Н',precision:1},
 {id:'peakCableTensionN',label:'Пиковое натяжение тросов от начала, Н',precision:1},
 {id:'brokenCables',label:'Количество разорвавшихся тросов',precision:0},
 {id:'normalLoadN',label:'Нормальная контактная нагрузка, Н',precision:1},
 {id:'normalLoadKg',label:'Эквивалент контактной нагрузки, кг',precision:2},
 {id:'physicalSeconds',label:'Физическое время, с',precision:2},
 {id:'physicalMilliseconds',label:'Физическое время, мс',precision:2},
 {id:'physicalMinutes',label:'Физическое время, мин',precision:1},
 {id:'temperature',label:'Температура, °C',precision:0},
 {id:'depthCm',label:'Глубина, см',precision:1},
 {id:'modelSpeed',label:'Скорость, м/с',precision:1},
 {id:'azimuthSpeed',label:'Скорость по кругу, м/с',precision:2},
 {id:'surfaceHeight',label:'Высота над центром поверхности, м',precision:2},
 {id:'surfaceRadius',label:'Радиус движения, м',precision:2},
 {id:'upslopeSpeed',label:'Скорость вверх по склону, м/с',precision:2},
 {id:'drivePower',label:'Мощность привода, Вт',precision:0},
 {id:'centerOfMassHeight',label:'Высота центра масс выбранного объекта, м',precision:3},
 {id:'centerOfMassX',label:'Координата X центра масс объекта, м',precision:3},
 {id:'centerOfMassDropCm',label:'Снижение центра масс от начала, см',precision:1},
]);
/** Observations only. The author chooses their wording and display interval. */
export function modelReadouts(lab){
 const state=lab.penetration?.snapshot()||lab.thermal?.snapshot()||lab.orbit?.snapshot();
 const seconds=Number.isFinite(state?.elapsed)?state.elapsed:lab.time;
 const result={physicalSeconds:seconds,physicalMilliseconds:seconds*1000,physicalMinutes:seconds/60};
 const focus=lab.find?.(lab.settings.story?.heroId||lab.settings.focusId||'');
 if(focus?.body?.worldCom){const c=focus.body.worldCom();if(Number.isFinite(c.y))result.centerOfMassHeight=c.y;if(Number.isFinite(c.x))result.centerOfMassX=c.x;const start=lab.measurementComOrigins?.get(focus.id);if(start&&Number.isFinite(c.y))result.centerOfMassDropCm=(start[1]-c.y)*100;}
 if(Number.isFinite(state?.temperature))result.temperature=state.temperature;
 if(Number.isFinite(state?.depth))result.depthCm=state.depth*100;
 if(Number.isFinite(state?.velocity??state?.speed))result.modelSpeed=state.velocity??state.speed;
 const surface=lab.surfaceMotion?.snapshot();
 if(surface){for(const[key,field]of Object.entries({azimuthSpeed:'azimuthSpeed',surfaceHeight:'height',surfaceRadius:'radius',upslopeSpeed:'upslopeSpeed',drivePower:'propulsionPower'}))if(Number.isFinite(surface[field]))result[key]=surface[field];}
 const cables=lab.elasticCables?.snapshot().cables;if(cables?.length){result.maxCableTensionN=Math.max(...cables.map(c=>c.tension));result.peakCableTensionN=Math.max(...cables.map(c=>c.peakTension));result.brokenCables=cables.filter(c=>c.broken).length;}
 const cells=lab.contactSensors?.snapshot(lab.settings.gravity)||[],cell=cells.find(s=>s.id===lab.settings.contactSensorId)||cells[0];if(cell&&cell.status==='active'){result.normalLoadN=cell.force;if(Number.isFinite(cell.equivalentMass))result.normalLoadKg=cell.equivalentMass;}
 return result;
}
