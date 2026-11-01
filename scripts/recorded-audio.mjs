import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTrack } from '../src/tracks.js';

export const RECORDING_SAMPLE_RATE=32000;
const MAX_BYTES=600*RECORDING_SAMPLE_RATE*4+1024*1024;
const roots=[new URL('../public/music/recordings/',import.meta.url),new URL('../dist/music/recordings/',import.meta.url)];
const cache=new Map();
const invalid=message=>new Error(`Некорректная запись музыки: ${message}`);

/** Decode bundled 32 kHz / 16-bit stereo PCM without FFmpeg or an async worker. */
export function decodeRecordingWav(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw invalid('нужен WAV PCM.');
 const end=bytes.readUInt32LE(4)+8;
 if(end>bytes.length||end<44||end>MAX_BYTES)throw invalid('неполный или слишком большой WAV.');
 let format,data;
 for(let offset=12;offset+8<=end;){
  const id=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8;
  if(size>end-start)throw invalid('обрезанный раздел WAV.');
  if(id==='fmt '){
   if(size<16)throw invalid('неполные параметры PCM.');
   format={encoding:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),byteRate:bytes.readUInt32LE(start+8),blockAlign:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};
  }else if(id==='data'&&!data)data={start,size};
  offset=start+size+(size&1);
 }
 if(!format||!data||format.encoding!==1||format.channels!==2||format.sampleRate!==RECORDING_SAMPLE_RATE||format.bits!==16||format.blockAlign!==4||format.byteRate!==RECORDING_SAMPLE_RATE*4||!data.size||data.size%4)throw invalid('нужен стерео PCM: 32 кГц, 16 бит.');
 const frames=data.size/4,left=new Float32Array(frames),right=new Float32Array(frames);
 for(let i=0;i<frames;i++){left[i]=bytes.readInt16LE(data.start+i*4)/32768;right[i]=bytes.readInt16LE(data.start+i*4+2)/32768;}
 return{sampleRate:RECORDING_SAMPLE_RATE,frames,duration:frames/RECORDING_SAMPLE_RATE,left,right};
}

/** Resolve registry IDs only; a saved project cannot supply a recording path. */
export function loadRecordedTrack(id){
 const track=getTrack(id),filename=track?.recording?.filename;
 if(!filename||!/^[a-z0-9][a-z0-9-]{0,110}\.wav$/.test(filename))throw invalid('выберите запись из музыкальной библиотеки.');
 let source,info;
 for(const root of roots){
  const candidate=fileURLToPath(new URL(filename,root));
  try{info=statSync(candidate);source=candidate;break;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(!source)throw new Error(`Запись «${track.title}» не найдена в комплекте приложения.`);
 if(!info.isFile()||info.size<44||info.size>MAX_BYTES)throw invalid('недопустимый размер файла.');
 const signature=`${source}:${info.size}:${info.mtimeMs}`,previous=cache.get(id);
 if(previous?.signature===signature)return previous.audio;
 const audio=decodeRecordingWav(readFileSync(source));cache.set(id,{signature,audio});return audio;
}
