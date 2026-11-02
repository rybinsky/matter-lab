export const READOUT_VARIABLES=Object.freeze([
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
]);
/** Observations only. The author chooses their wording and display interval. */
export function modelReadouts(lab){
 const state=lab.penetration?.snapshot()||lab.thermal?.snapshot()||lab.orbit?.snapshot();
 const seconds=Number.isFinite(state?.elapsed)?state.elapsed:lab.time;
 const result={physicalSeconds:seconds,physicalMilliseconds:seconds*1000,physicalMinutes:seconds/60};
 if(Number.isFinite(state?.temperature))result.temperature=state.temperature;
 if(Number.isFinite(state?.depth))result.depthCm=state.depth*100;
 if(Number.isFinite(state?.velocity??state?.speed))result.modelSpeed=state.velocity??state.speed;
 const surface=lab.surfaceMotion?.snapshot();
 if(surface){for(const[key,field]of Object.entries({azimuthSpeed:'azimuthSpeed',surfaceHeight:'height',surfaceRadius:'radius',upslopeSpeed:'upslopeSpeed',drivePower:'propulsionPower'}))if(Number.isFinite(surface[field]))result[key]=surface[field];}
 return result;
}
