import {spawn} from 'node:child_process';
import {settingsFor} from '../src/catalog.js';
const preview=process.argv.includes('--preview');
const ids=['thermal','soft','mechanism','orbit','flow'];
for(let i=0;i<ids.length;i++){
 if(process.argv.some(a=>a.startsWith('--only='))&&!process.argv.includes('--only='+ids[i]))continue;
 const id=ids[i];const settings=settingsFor(id,preview?(id==='soft'?2:1):0);
 settings.musicTrack={thermal:'minimal-3',soft:'minimal-5',mechanism:'pulse-2',orbit:'space-4',flow:'pulse-6'}[id];
 settings.story={title:{thermal:'1000 °C. Четыре массы.',soft:'Сжать. Отпустить. Сравнить.',mechanism:'Масса или высота?',orbit:'Один кирпич. Четыре скорости.',flow:'Вода. Масло. Сироп.'}[id],hook:{thermal:'Пройдёт ли шар сквозь лёд?',soft:'Что останется после сжатия?',mechanism:'Маленький груз взлетит выше?',orbit:'Кирпич может стать спутником?',flow:'Сколько жидкости дойдёт за 7,5 с?'}[id],question:{thermal:'Меняем только массу шара',soft:'Желе, пена или пластилин?',mechanism:'Меняем массу или высоту падения',orbit:'Меняем скорость. Старт — 100 км.',flow:'Один объём. Разная вязкость.'}[id],duration:60,tempo:'fast',camera:'auto',accent:{thermal:'#FFBD59',soft:'#D9B2FF',mechanism:'#D8FF5F',orbit:'#66D9EF',flow:'#FFBD59'}[id],effects:{slowMotion:true,eventPulse:true,reference:true,heroOutline:true,trail:id==='mechanism'||id==='orbit'}};
 console.log('SHOWCASE',id);
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/export-one.mjs'],{stdio:['pipe','inherit','inherit']});child.stdin.end(JSON.stringify({version:1,settings,objects:[],edits:{},series:!preview,preview,previewDuration:8,height:preview?720:process.argv.includes('--4k')?2160:1080,showcase:!preview,outputName:preview?`preview-v2-${id}`:`showcase-${i+1}-${id}`,jobId:`${preview?'preview':'final'}-v4-${id}`}));child.on('exit',code=>code===0?resolve():reject(new Error(`${id}: render failed`)));child.on('error',reject);});
}
