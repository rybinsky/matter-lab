import { spawn } from 'node:child_process';
import { settingsFor } from '../src/catalog.js';
const ids=process.argv.slice(2).length?process.argv.slice(2):['impact','cascade','mechanism','soft','flow'];
for(let i=0;i<ids.length;i++){
 const id=ids[i];console.log('SERIES',i+1,ids.length,id);
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/export-one.mjs'],{stdio:['pipe','inherit','inherit']});child.stdin.end(JSON.stringify({version:1,settings:settingsFor(id),objects:[],edits:{},series:true,height:1080,outputName:`${String(i+1).padStart(2,'0')}-${id}`,jobId:`series-${id}`}));child.on('exit',code=>code===0?resolve():reject(new Error(`${id} export failed`)));child.on('error',reject);});
}
