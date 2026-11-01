const collections=[
 {mood:'pulse',name:'Ритм',base:106,titles:['Точный импульс','Геометрия движения','Цепная реакция','Гравитационный грув','Пружинный ход','Контакт','Петля энергии','Точка удара']},
 {mood:'minimal',name:'Минимал',base:96,titles:['Чистый эксперимент','Малые формы','Мягкий механизм','Стеклянный ритм','Медленный ток','Порядок вещей','Ровная линия','Собранность']},
 {mood:'space',name:'Космос',base:88,titles:['Орбитальный шаг','За горизонтом','Свободное падение','Тихий двигатель','Лунная дуга','Предел скорости','Точка равновесия','Внешний радиус']},
 {mood:'ambient',name:'Спокойно',base:82,titles:['Тёплое стекло','Материя','Поверхность','Плавное касание','Жидкий свет','Слоёная тишина','Новая форма','После движения']},
];
const proceduralTracks=collections.flatMap((c,group)=>c.titles.map((title,i)=>({id:`${c.mood}-${i+1}`,title,mood:c.mood,collection:c.name,bpm:c.base+(i%4)*3-3,key:[0,2,5,7,9,-2,4,-3][i],pattern:(i+group)%4,seed:group*31+i*17+53,duration:60,url:`/music/${c.mood}-${i+1}.mp3`})));
// Recorded entries point to bundled assets only. Project data selects an ID;
// filenames and provenance never come from the project or a filesystem path.
const recordedTitles=[
 ['lfm-everyone-is-so-alive','Everyone is so alive',255],
 ['lfm-high-technologic-beat-explosion','High Technologic Beat Explosion',221.42859375],
 ['lfm-after-party','After Party',177],
 ['lfm-it-feels-good-to-be-alive-too','It feels good to be alive too',220.42859375],
];
const recordedTracks=recordedTitles.map(([id,title,duration])=>({
 id,title,type:'recording',mood:'pulse',collection:'Loyalty Freak Music · ROBOT DANCE !',
 artist:'Loyalty Freak Music',album:'ROBOT DANCE !',license:'CC0-1.0',
 licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',
 source:'https://loyaltyfreakmusic.com/wp-content/uploads/2020/09/Loyalty-Freak-Music-ROBOT-DANCE-.zip',
 sourceArchive:'https://loyaltyfreakmusic.com/wp-content/uploads/2020/09/Loyalty-Freak-Music-ROBOT-DANCE-.zip',
 bpm:null,duration,url:`/music/recordings/${id}.mp3`,
 recording:{filename:`${id}.wav`,sampleRate:32000,channels:2,bitDepth:16},
}));
export const TRACKS=[...proceduralTracks,...recordedTracks];
export function getTrack(id){return TRACKS.find(t=>t.id===id);}
