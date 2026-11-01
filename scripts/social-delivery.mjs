import{readFile,writeFile,copyFile}from'node:fs/promises';
import{spawn}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
const run=(args)=>new Promise((resolve,reject)=>{const p=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let error='';p.stderr.on('data',c=>error=(error+c).slice(-3000));p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(error)));});
export async function createSocialDelivery(video,metadata){
 if(metadata.width<2160)return null;
 const base=video.slice(0,-4),output=base+'-social.mp4';
 const args=['-hide_banner','-loglevel','error','-i',video,'-vf','scale=1080:1920:flags=lanczos','-c:a','copy'],ending=['-movflags','+faststart','-y',output];
 try{await run([...args,'-c:v','h264_videotoolbox','-allow_sw','0','-b:v','10000k',...ending]);}catch{await run([...args,'-c:v','libx264','-preset','fast','-crf','18',...ending]);}
 const masterName=path.basename(video),meta={...metadata,width:1080,height:1920,masterName,delivery:true,created:new Date().toISOString()};
 await writeFile(base+'-social.json',JSON.stringify(meta,null,2));try{await copyFile(base+'.jpg',base+'-social.jpg');}catch{}
 return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))for(const video of process.argv.slice(2)){const meta=JSON.parse(await readFile(video.slice(0,-4)+'.json','utf8'));console.log(await createSocialDelivery(path.resolve(video),meta)||'Already Full HD');}
