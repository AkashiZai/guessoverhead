import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
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

const dist=join(import.meta.dirname,'..','dist');

const http=createServer(async(req,res)=>{
  const rawPath=(req.url??'/').split('?')[0];

  // Health check endpoint for Render
  if(rawPath==='/health'||rawPath==='/ping'){
    res.writeHead(200,{'content-type':'text/plain'}).end('OK');
    return;
  }

  const path=normalize(rawPath).replace(/^(\.\.[/\\])+/,'');
  try{
    const file=path==='/'||path==='\\'?'index.html':path;
    const buf=await readFile(join(dist,file));
    res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'}).end(buf);
  }catch{
    try{
      // SPA fallback
      const buf=await readFile(join(dist,'index.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(buf);
    }catch{
      res.writeHead(404).end('ไม่พบไฟล์ (กรุณารัน npm run build ก่อน หรือใช้ npm run dev)');
    }
  }
});

setupGameServer(http);

const port=+(process.env.PORT??3000);
http.listen(port,'0.0.0.0',()=>console.log(`เซิร์ฟเวอร์พร้อมที่พอร์ต ${port}`));
