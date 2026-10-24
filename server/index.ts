import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,extname,join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setupGameServer} from './game';

const mime:Record<string,string>={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.json':'application/json; charset=utf-8',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
  '.ttf':'font/ttf'
};

// ใช้ fileURLToPath แทน import.meta.dirname เพื่อให้รันได้บน Node 20 ทุกรุ่นย่อย
const dist=join(dirname(fileURLToPath(import.meta.url)),'..','dist');

async function sendIndex(res:import('node:http').ServerResponse){
  try{
    const buf=await readFile(join(dist,'index.html'));
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'}).end(buf);
  }catch{
    res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('ไม่พบไฟล์ (กรุณารัน npm run build ก่อน หรือใช้ npm run dev)');
  }
}

const http=createServer(async(req,res)=>{
  let rawPath='/';
  try{rawPath=decodeURIComponent((req.url??'/').split('?')[0])}catch{}

  // Health check endpoint for Render
  if(rawPath==='/health'||rawPath==='/ping'){
    res.writeHead(200,{'content-type':'text/plain'}).end('OK');
    return;
  }

  const file=join(dist,normalize(rawPath));
  // กันการอ่านไฟล์นอกโฟลเดอร์ dist
  if(rawPath==='/'||!file.startsWith(dist+sep))return sendIndex(res);
  try{
    const buf=await readFile(file);
    const isAsset=rawPath.startsWith('/assets/');
    res.writeHead(200,{
      'content-type':mime[extname(file)]??'application/octet-stream',
      'cache-control':isAsset?'public, max-age=31536000, immutable':'no-cache',
    }).end(buf);
  }catch{
    await sendIndex(res); // SPA fallback
  }
});

setupGameServer(http);

const port=+(process.env.PORT??3000);
http.listen(port,'0.0.0.0',()=>console.log(`เซิร์ฟเวอร์พร้อมที่พอร์ต ${port}`));
