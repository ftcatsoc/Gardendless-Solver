import {readdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {join} from 'node:path';
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(f=>f.isDirectory()?files(join(dir,f.name)):[join(dir,f.name)]))).flat();}
const paths=await files('dist');
assert(paths.some(p=>p.endsWith('index.html')));
assert(paths.some(p=>p.endsWith('favicon.svg')));
for(const path of paths){
 assert(/\.(html|js|css|svg)$/.test(path),'非静态资源：'+path);
 assert(!/qa|fixture|state\.json|reference|node_modules/.test(path),'测试或私人文件进入构建');
 const text=await readFile(path,'utf8');
 assert(!/node:fs|worker_threads|\/api\/|localhost:8765|127\.0\.0\.1:8765/.test(text),'构建含后端依赖');
}
console.log('静态产物检查通过：'+paths.join(', '));
