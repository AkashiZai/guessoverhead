import {WebSocketServer,type WebSocket} from 'ws';
import {CATS,type Char} from '../src/data';
import type {Act,ClientMsg,Config,Phase,PlayerView,ServerMsg,Status,View} from '../src/shared';

interface PickedChar extends Char{catName:string}
interface Player{id:string;token:string;name:string;ws:WebSocket|null;ch:PickedChar|null;status:Status;q:number;wrong:number;fin:number}
interface Room{
  code:string;host:string;players:Player[];cfg:Config;phase:Phase;cur:number;
  deadline:number;timer:NodeJS.Timeout|null;notice:string;revealKind:'won'|'gave'|null;done:number;
  turn:number;pausedMs:number;delTimer:NodeJS.Timeout|null;hostTimer:NodeJS.Timeout|null;
  used:Set<string>;lastRound:Set<string>;
}

const ACTS:Act[]=['q+','q-','correct','wrong','give','skip','next'];
const MAX_PLAYERS=12;
const ROOM_TTL=5*60*1000;      // ลบห้องเมื่อไม่มีใครออนไลน์นานเกินนี้
const HOST_GRACE=20*1000;      // เจ้าของห้องหลุดนานเกินนี้ จะโอนสิทธิ์ให้คนอื่น

const rooms=new Map<string,Room>();
const conns=new Map<WebSocket,{room:Room;pid:string}>();
const defaultCfg=():Config=>({cats:CATS.map(c=>c.id),hard:false,seconds:60});
const shuffle=<T>(a:T[])=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const uid=()=>Math.random().toString(36).slice(2,10);
const str=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';

function newCode():string{
  const L='ABCDEFGHJKLMNPQRSTUVWXYZ';
  for(let i=0;i<1000;i++){
    const c=Array.from({length:4},()=>L[Math.floor(Math.random()*L.length)]).join('');
    if(!rooms.has(c))return c;
  }
  return Math.random().toString(36).slice(2,6).toUpperCase();
}

function viewFor(r:Room,pid:string):View{
  const players:PlayerView[]=r.players.map(p=>({
    id:p.id,name:p.name,connected:!!p.ws,status:p.status,q:p.q,wrong:p.wrong,fin:p.fin,
    ...(p.ch&&(p.id!==pid||p.status!=='play')?{ch:{name:p.ch.name,aliases:p.ch.aliases,hints:p.ch.hints,cat:p.ch.catName}}:{}),
  }));
  return {
    code:r.code,me:pid,host:r.host,phase:r.phase,cfg:r.cfg,
    cats:CATS.map(c=>({id:c.id,name:c.name,count:c.chars.length})),
    players,cur:r.phase==='lobby'?null:r.players[r.cur]?.id??null,
    remainingMs:r.phase==='turn'?Math.max(0,r.deadline-Date.now()):0,
    notice:r.notice,revealKind:r.revealKind,turn:r.turn,
  };
}

const send=(ws:WebSocket,m:ServerMsg)=>{if(ws.readyState===ws.OPEN)ws.send(JSON.stringify(m))};
function broadcast(r:Room){for(const p of r.players)if(p.ws)send(p.ws,{t:'view',view:viewFor(r,p.id)})}

const playing=(r:Room)=>r.players.filter(p=>p.status==='play');
const online=(r:Room)=>r.players.filter(p=>p.ws);
const clearTimer=(r:Room)=>{if(r.timer)clearTimeout(r.timer);r.timer=null};

function startTimer(r:Room,ms:number){
  clearTimer(r);
  r.deadline=Date.now()+ms;
  r.timer=setTimeout(()=>{
    r.timer=null;
    if(r.phase!=='turn')return;
    r.notice=`${r.players[r.cur]?.name??''} หมดเวลา เปลี่ยนตา`;
    advance(r);broadcast(r);
  },ms);
}

function toFinal(r:Room){
  clearTimer(r);
  r.phase='final';r.revealKind=null;r.turn++;
}

function advance(r:Room){
  clearTimer(r);
  if(!playing(r).length){toFinal(r);return}
  do{r.cur=(r.cur+1)%r.players.length}while(r.players[r.cur].status!=='play');
  r.phase='turn';r.revealKind=null;r.turn++;
  startTimer(r,r.cfg.seconds*1000);
}

/** สุ่มตัวละครแบบกระจายหมวดเท่าๆ กัน และจำประวัติข้ามรอบเพื่อไม่ให้ได้ตัวซ้ำเมื่อเริ่ม round ใหม่ */
function pickChars(r:Room,n:number):PickedChar[]{
  const selectedCats=CATS.filter(c=>r.cfg.cats.includes(c.id));
  if(!selectedCats.length)return [];

  // เตรียม candidate pool สำหรับแต่ละหมวดที่เลือก
  const catPools=new Map<string,PickedChar[]>();
  for(const c of selectedCats){
    let pool:PickedChar[]=c.chars.map(ch=>({...ch,catName:c.name}));
    // ง่าย = เฉพาะตัวดัง, ยาก = เฉพาะตัวลึก/ตำนาน (ถ้าหมวดนั้นมีตัวพอ)
    const filtered=pool.filter(x=>x.hard===r.cfg.hard);
    if(filtered.length>=3)pool=filtered;
    catPools.set(c.id,pool);
  }

  const out:PickedChar[]=[];
  const roundUsed=new Set<string>();

  // จัดลำดับการแจกหมวดแบบกระจายเท่าๆ กัน (Round-Robin) ให้ทุกหมวดที่เลือกได้ถูกเล่นอย่างสมดุล
  const catSequence:string[]=[];
  const shuffledCatIds=shuffle([...r.cfg.cats]);
  while(catSequence.length<n){
    for(const cid of shuffledCatIds){
      if(catSequence.length<n)catSequence.push(cid);
    }
  }

  for(const targetCatId of catSequence){
    const pool=catPools.get(targetCatId)||[];
    // 1. หาตัวที่ยังไม่เคยเล่นในห้องนี้ และยังไม่ถูกเลือกในรอบนี้
    let candidates=pool.filter(ch=>!r.used.has(ch.name.toLowerCase())&&!roundUsed.has(ch.name.toLowerCase()));

    // 2. ถ้าหมวดนี้ใช้จนหมดแล้ว ให้รีไซเคิลหมวดนี้ใหม่ (แต่เว้นตัวจากรอบล่าสุดไว้ไม่ให้ซ้ำทันที)
    if(!candidates.length){
      candidates=pool.filter(ch=>!r.lastRound.has(ch.name.toLowerCase())&&!roundUsed.has(ch.name.toLowerCase()));
      for(const ch of pool){
        if(!r.lastRound.has(ch.name.toLowerCase())){
          r.used.delete(ch.name.toLowerCase());
        }
      }
    }

    // 3. ถ้ายังไม่มี (เช่น ตัวในหมวดน้อยกว่าจำนวนผู้เล่น) ให้ยอมเอาตัวใดก็ได้ที่ไม่ซ้ำในรอบนี้
    if(!candidates.length){
      candidates=pool.filter(ch=>!roundUsed.has(ch.name.toLowerCase()));
    }

    // 4. ถ้าในหมวดนี้หมดจริงๆ ให้ดึงจากหมวดอื่นที่เลือกไว้
    if(!candidates.length){
      for(const [otherId,otherPool] of catPools){
        if(otherId===targetCatId)continue;
        const otherCand=otherPool.filter(ch=>!roundUsed.has(ch.name.toLowerCase())&&!r.used.has(ch.name.toLowerCase()));
        if(otherCand.length){
          candidates=otherCand;
          break;
        }
      }
    }

    if(candidates.length){
      const picked=candidates[Math.floor(Math.random()*candidates.length)];
      out.push(picked);
      roundUsed.add(picked.name.toLowerCase());
      r.used.add(picked.name.toLowerCase());
    }
  }

  r.lastRound=roundUsed;
  return shuffle(out);
}

function startGame(r:Room):string{
  if(!r.cfg.cats.length)return 'เลือกหมวดอย่างน้อย 1 หมวด';
  // คนที่หลุดค้างในล็อบบี้ไม่ต้องเอาเข้าเกม
  const ghosts=r.players.filter(p=>!p.ws);
  if(ghosts.length&&r.players.length-ghosts.length>=2){
    r.players=r.players.filter(p=>p.ws);
    if(!r.players.some(p=>p.id===r.host))r.host=r.players[0].id;
  }
  if(r.players.length<2)return 'ต้องมีผู้เล่นอย่างน้อย 2 คน';
  const picks=pickChars(r,r.players.length);
  if(picks.length<r.players.length)return 'ตัวละครในหมวดที่เลือกไม่พอสำหรับผู้เล่นทุกคน';
  r.players.forEach((p,i)=>Object.assign(p,{ch:picks[i],status:'play' as Status,q:0,wrong:0,fin:0}));
  r.done=0;r.cur=r.players.length-1;
  advance(r);
  r.notice=`พร้อมแล้ว! ตาแรกของ ${r.players[r.cur].name}`;
  return '';
}

function act(r:Room,pid:string,a:Act,turn:number){
  // กดค้างมาจากตาก่อนหน้า (เช่น หมดเวลาพอดี หรือเพื่อนสองคนกดพร้อมกัน) -> ไม่ทำอะไร แค่ส่งสถานะล่าสุดกลับไป
  if(turn!==r.turn){broadcast(r);return}
  const p=r.players[r.cur];
  if(!p)return;
  const isCur=p.id===pid;
  if(r.phase==='turn'){
    if(a==='q+')p.q=Math.min(999,p.q+1);
    else if(a==='q-')p.q=Math.max(0,p.q-1);
    else if(isCur&&a==='give'){p.status='gave';p.fin=++r.done;clearTimer(r);r.phase='reveal';r.revealKind='gave';r.turn++}
    else if(isCur&&a==='skip'){r.notice=`${p.name} ข้ามตา`;advance(r)}
    else if(!isCur&&a==='correct'){p.status='won';p.fin=++r.done;clearTimer(r);r.phase='reveal';r.revealKind='won';r.turn++}
    else if(!isCur&&a==='wrong'){p.wrong++;r.notice=`${p.name} ทายผิด เสียตา`;advance(r)}
    else return;
  }else if(r.phase==='reveal'&&a==='next'){r.notice='';advance(r)}
  else return;
  broadcast(r);
}

function scheduleHostTransfer(r:Room){
  if(r.hostTimer)clearTimeout(r.hostTimer);
  r.hostTimer=setTimeout(()=>{
    r.hostTimer=null;
    const h=r.players.find(p=>p.id===r.host);
    if(h?.ws)return;
    const next=r.players.find(p=>p.ws);
    if(next){r.host=next.id;broadcast(r)}
  },HOST_GRACE);
}

function onAllOffline(r:Room){
  if(r.phase==='turn'&&r.timer){r.pausedMs=Math.max(0,r.deadline-Date.now());clearTimer(r)}
  if(r.delTimer)clearTimeout(r.delTimer);
  r.delTimer=setTimeout(()=>{if(!online(r).length){clearTimer(r);rooms.delete(r.code)}},ROOM_TTL);
}

/** explicit=true คือกดออกห้องเอง (ลบออกจากห้อง), false คือหลุดการเชื่อมต่อ (เก็บที่ไว้ให้กลับมาได้) */
function leaveRoom(ws:WebSocket,explicit:boolean){
  const c=conns.get(ws);
  if(!c)return;
  conns.delete(ws);
  const {room:r,pid}=c;
  const idx=r.players.findIndex(x=>x.id===pid);
  if(idx===-1)return;
  const p=r.players[idx];
  if(p.ws!==ws)return; // socket เก่าที่ถูกแทนที่แล้ว
  p.ws=null;

  if(explicit){
    const wasCur=idx===r.cur;
    r.players.splice(idx,1);
    if(!r.players.length){
      clearTimer(r);
      if(r.delTimer)clearTimeout(r.delTimer);
      if(r.hostTimer)clearTimeout(r.hostTimer);
      rooms.delete(r.code);
      return;
    }
    if(r.host===pid)r.host=(r.players.find(x=>x.ws)??r.players[0]).id;
    if(r.phase==='turn'||r.phase==='reveal'){
      if(idx<r.cur)r.cur--;
      if(!playing(r).length)toFinal(r);
      else if(wasCur){
        r.cur=(idx-1+r.players.length)%r.players.length;
        r.notice=`${p.name} ออกจากห้อง เปลี่ยนตาถัดไป`;
        advance(r);
      }
    }else if(r.phase==='final'||r.phase==='lobby'){
      r.cur=Math.min(r.cur,r.players.length-1);
    }
  }else if(r.host===pid){
    scheduleHostTransfer(r);
  }

  if(!online(r).length)onAllOffline(r);
  broadcast(r);
}

/** หาที่นั่งเดิม: token เดียวกัน หรือชื่อเดียวกันที่หลุดอยู่ (เช่น ปิดแท็บไปแล้วเปิดใหม่ ทำให้ token หาย) */
const findSeat=(r:Room,token:string,name:string)=>
  r.players.find(x=>x.token===token)??r.players.find(x=>!x.ws&&x.name.toLowerCase()===name.toLowerCase());

function handle(ws:WebSocket,m:ClientMsg){
  const err=(msg:string)=>send(ws,{t:'error',msg});

  if(m.t==='create'||m.t==='join'){
    const name=str(m.name,20);
    const token=str(m.token,64);
    if(!name)return err('ใส่ชื่อของคุณก่อน');
    if(!token)return err('ข้อมูลไม่ถูกต้อง ลองรีเฟรชหน้าเว็บ');

    let r:Room|undefined;
    if(m.t==='join'){
      const code=str(m.code,8).toUpperCase();
      if(!code)return err('ใส่รหัสห้อง 4 ตัวอักษร');
      r=rooms.get(code);
      if(!r)return err(`ไม่พบห้อง "${code}" (ห้องอาจถูกปิดไปแล้ว)`);
      const existing=findSeat(r,token,name);
      if(!existing){
        if(r.phase!=='lobby')return err('เกมในห้องนี้เริ่มไปแล้ว รอจบรอบแล้วค่อยเข้าใหม่');
        if(r.players.length>=MAX_PLAYERS)return err(`ห้องนี้เต็มแล้ว (จำกัดไม่เกิน ${MAX_PLAYERS} คน)`);
        if(r.players.some(x=>x.name.toLowerCase()===name.toLowerCase()))return err(`มีคนใช้ชื่อ "${name}" ในห้องนี้แล้ว โปรดเปลี่ยนชื่อ`);
      }
    }

    // ออกจากห้องเดิมก่อน (ถ้าเข้าห้องเดิมซ้ำด้วย token เดิม จะเป็นการเชื่อมต่อกลับ ไม่ใช่ออก)
    const prev=conns.get(ws);
    if(prev&&prev.room!==r)leaveRoom(ws,true);

    if(!r){
      r={code:newCode(),host:'',players:[],cfg:defaultCfg(),phase:'lobby',cur:0,deadline:0,timer:null,notice:'',revealKind:null,done:0,turn:0,pausedMs:0,delTimer:null,hostTimer:null,used:new Set(),lastRound:new Set()};
      rooms.set(r.code,r);
    }

    let p=findSeat(r,token,name);
    if(p){
      if(p.ws&&p.ws!==ws){conns.delete(p.ws);p.ws.close()}
      p.ws=ws;
      p.token=token;
      if(!r.players.some(x=>x!==p&&x.name.toLowerCase()===name.toLowerCase()))p.name=name;
    }else{
      p={id:uid(),token,name,ws,ch:null,status:'play',q:0,wrong:0,fin:0};
      r.players.push(p);
      if(!r.host)r.host=p.id;
    }
    conns.set(ws,{room:r,pid:p.id});

    // มีคนกลับมาออนไลน์: ยกเลิกการลบห้อง และเดินเวลาต่อถ้าเวลาหยุดไว้
    if(r.delTimer){clearTimeout(r.delTimer);r.delTimer=null}
    if(r.phase==='turn'&&!r.timer)startTimer(r,r.pausedMs>1000?r.pausedMs:r.cfg.seconds*1000);
    r.pausedMs=0;
    // เจ้าของห้องเดิมหลุดไปแล้วยังไม่กลับ -> โอนให้คนที่ออนไลน์
    if(!r.players.find(x=>x.id===r.host)?.ws&&!r.hostTimer)r.host=p.id;

    broadcast(r);
    return;
  }

  if(m.t==='leave'){
    leaveRoom(ws,true);
    send(ws,{t:'left'});
    return;
  }

  const c=conns.get(ws);
  if(!c)return err('หลุดออกจากห้องแล้ว กำลังเชื่อมต่อใหม่…');
  const {room:r,pid}=c, isHost=r.host===pid;

  switch(m.t){
    case 'cfg':{
      if(!isHost||r.phase!=='lobby'||!m.cfg)return;
      const cats=Array.isArray(m.cfg.cats)?m.cfg.cats:[];
      r.cfg={
        cats:CATS.map(x=>x.id).filter(id=>cats.includes(id)),
        hard:!!m.cfg.hard,
        seconds:Math.max(10,Math.min(600,Math.floor(+m.cfg.seconds||60))),
      };
      break}
    case 'start':{
      if(!isHost||r.phase!=='lobby')return;
      const e=startGame(r);
      if(e)return err(e);
      break}
    case 'act':
      if(!ACTS.includes(m.a))return;
      return act(r,pid,m.a,Number(m.turn));
    case 'again':{
      if(!isHost||r.phase!=='final')return;
      const e=startGame(r);
      if(e)return err(e);
      break}
    case 'lobby':
      if(!isHost||r.phase==='lobby')return;
      clearTimer(r);
      r.phase='lobby';r.notice='';r.revealKind=null;r.turn++;
      r.players.forEach(p=>{p.ch=null;p.status='play';p.q=0;p.wrong=0;p.fin=0});
      break;
    default:return;
  }
  broadcast(r);
}

export function setupGameServer(server:any){
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:16*1024});
  const alive=new WeakSet<WebSocket>();

  // heartbeat: ตัดการเชื่อมต่อที่ตายแล้ว (เช่น มือถือปิดจอ/เน็ตหลุด) เพื่อให้สถานะ [หลุด] ถูกต้อง
  const hb=setInterval(()=>{
    for(const ws of wss.clients){
      if(!alive.has(ws)){ws.terminate();continue}
      alive.delete(ws);
      try{ws.ping()}catch{}
    }
  },25000);
  wss.on('close',()=>clearInterval(hb));

  wss.on('connection',ws=>{
    alive.add(ws);
    ws.on('pong',()=>alive.add(ws));
    ws.on('message',raw=>{
      alive.add(ws);
      let m:ClientMsg;
      try{m=JSON.parse(String(raw))}catch{return}
      if(!m||typeof m!=='object')return;
      try{handle(ws,m)}catch(e){
        console.error('[game] error handling message',e);
        send(ws,{t:'error',msg:'เกิดข้อผิดพลาดในเซิร์ฟเวอร์ ลองใหม่อีกครั้ง'});
      }
    });
    ws.on('close',()=>{
      try{leaveRoom(ws,false)}catch(e){console.error('[game] error on close',e)}
    });
    ws.on('error',()=>{});
  });

  return wss;
}
