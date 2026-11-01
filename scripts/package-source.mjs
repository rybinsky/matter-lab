import {cp,mkdir,mkdtemp,readFile,readdir,lstat,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const outputArg=process.argv.find(a=>a.startsWith('--output='));
const destination=path.resolve(outputArg?outputArg.slice(9):path.join(root,'release'));
const name=`Matter-Lab-${pkg.version}-source`;
const directories=['src','scripts','public','packaging','docs','.github'];
const files=['package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.txt','index.html','Dockerfile','compose.yaml','.gitignore','.dockerignore','.editorconfig','.gitattributes','.nvmrc','.env.example','Запустить Matter Lab.command'];
files.push(...(await readdir(root)).filter(f=>f.endsWith('.mjs')));
await mkdir(destination,{recursive:true});
const temporary=await mkdtemp(path.join(os.tmpdir(),'matter-lab-source-'));
const snapshot=path.join(temporary,name);
try{
 await mkdir(snapshot);
 for(const item of [...files,...directories])await cp(path.join(root,item),path.join(snapshot,item),{recursive:true,filter:source=>!['.DS_Store','.git','node_modules','.cache','data','runtime','release'].includes(path.basename(source))});
 const manifest=[];
 async function inventory(folder){
  for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const file=path.join(folder,entry.name),relative=path.relative(snapshot,file).split(path.sep).join('/'),info=await lstat(file);
   if(info.isSymbolicLink())throw new Error(`Source package cannot contain a symlink: ${relative}`);
   if(info.isDirectory())await inventory(file);
   else if(info.isFile()){
    if(/(?:^|\/)(?:\.env(?:\.|$)|node_modules|\.cache|data|runtime|dist|work)(?:\/|$)/.test(relative)&&relative!=='.env.example')throw new Error(`Unexpected private/runtime path: ${relative}`);
    const bytes=await readFile(file);
    manifest.push(`${createHash('sha256').update(bytes).digest('hex')}  ${relative}`);
   }
  }
 }
 await inventory(snapshot);
 await writeFile(path.join(snapshot,'SOURCE_SHA256SUMS'),manifest.join('\n')+'\n');
 const archive=path.join(destination,name+'.tar.gz');
 await new Promise((resolve,reject)=>{
  const child=spawn('tar',['-czf',archive,'-C',temporary,name],{stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`tar exited ${code}`)));
 });
 const checksum=createHash('sha256').update(await readFile(archive)).digest('hex');
 await writeFile(archive+'.sha256',`${checksum}  ${path.basename(archive)}\n`);
 console.log(JSON.stringify({archive,sha256:checksum,sourceFiles:manifest.length,version:pkg.version},null,2));
}finally{await rm(temporary,{recursive:true,force:true});}
