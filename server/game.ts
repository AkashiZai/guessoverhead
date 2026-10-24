import {WebSocketServer,type WebSocket} from 'ws';
import {CATS,type Char} from '../src/data';
import type {Act,ClientMsg,Config,Phase,PlayerView,ServerMsg,Status,View} from '../src/shared';

interface PickedChar extends Char{catName:string}
interface Player{id:string;token:string;name:string;ws:WebSocket|null;ch:PickedChar|null;status:Status;q:number;wrong:number;fin:number}
interface Room{
  code:string;host:string;players:Player[];cfg:Config;phase:Phase;cur:number;
  deadline:number;timer:NodeJS.Timeout|null;notice:string;revealKind:'won'|'gave'|null;done:number;
}

const rooms=new Map<string,Room>();
const conns=new Map<WebSocket,{room:Room;pid:string}>();
const defaultCfg=():Config=>({cats:CATS.map(c=>c.id),hard:false,seconds:60});
const shuffle=<T>(a:T[])=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const uid=()=>Math.random().toString(36).slice(2,10);

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
    notice:r.notice,revealKind:r.revealKind,
  };
}

const send=(ws:WebSocket,m:ServerMsg)=>{if(ws.readyState===ws.OPEN)ws.send(JSON.stringify(m))};
function broadcast(r:Room){for(const p of r.players)if(p.ws)send(p.ws,{t:'view',view:viewFor(r,p.id)})}

const playing=(r:Room)=>r.players.filter(p=>p.status==='play');
const clearTimer=(r:Room)=>{if(r.timer)clearTimeout(r.timer);r.timer=null};

function advance(r:Room){
  clearTimer(r);
  if(!playing(r).length){r.phase='final';r.revealKind=null;return}
  do{r.cur=(r.cur+1)%r.players.length}while(r.players[r.cur].status!=='play');
  r.phase='turn';r.revealKind=null;
  r.deadline=Date.now()+r.cfg.seconds*1000;
  r.timer=setTimeout(()=>{
    r.notice=`${r.players[r.cur].name} หมดเวลา เปลี่ยนตา`;
    advance(r);broadcast(r);
  },r.cfg.seconds*1000);
}

function startGame(r:Room):string{
  const pool:PickedChar[]=CATS.filter(c=>r.cfg.cats.includes(c.id)).flatMap(c=>c.chars.map(ch=>({...ch,catName:c.name})));
  if(r.players.length<2)return 'ต้องมีผู้เล่นอย่างน้อย 2 คน';
  if(!r.cfg.cats.length)return 'เลือกหมวดอย่างน้อย 1 หมวด';
  if(pool.length<r.players.length)return 'ตัวละครในหมวดที่เลือกไม่พอสำหรับผู้เล่นทุกคน';
  const want=pool.filter(x=>x.hard===r.cfg.hard),rest=pool.filter(x=>x.hard!==r.cfg.hard);
  const picks=shuffle([...shuffle(want),...shuffle(rest)].slice(0,r.players.length));
  r.players.forEach((p,i)=>Object.assign(p,{ch:picks[i],status:'play' as Status,q:0,wrong:0,fin:0}));
  r.done=0;r.cur=r.players.length-1;
  advance(r);
  r.notice=`พร้อมแล้ว! ตาแรกของ ${r.players[r.cur].name}`;
  return '';
}

function act(r:Room,pid:string,a:Act){
  const p=r.players[r.cur];
  if(!p)return;
  const isCur=p.id===pid;
  if(r.phase==='turn'){
    if(a==='q+')p.q++;
    else if(a==='q-')p.q=Math.max(0,p.q-1);
    else if(isCur&&a==='give'){p.status='gave';p.fin=++r.done;clearTimer(r);r.phase='reveal';r.revealKind='gave'}
    else if(isCur&&a==='skip'){r.notice=`${p.name} ข้ามตา`;advance(r)}
    else if(!isCur&&a==='correct'){p.status='won';p.fin=++r.done;clearTimer(r);r.phase='reveal';r.revealKind='won'}
    else if(!isCur&&a==='wrong'){p.wrong++;r.notice=`${p.name} ทายผิด เสียตา`;advance(r)}
    else return;
  }else if(r.phase==='reveal'&&a==='next'){r.notice='';advance(r)}
  else return;
  broadcast(r);
}

function leaveRoom(ws:WebSocket){
  const c=conns.get(ws);
  if(!c)return;
  conns.delete(ws);
  const {room:r,pid}=c;
  const p=r.players.find(x=>x.id===pid);
  if(!p)return;
  p.ws=null;
  if(r.phase==='lobby'){
    r.players=r.players.filter(x=>x!==p);
    if(r.host===pid)r.host=r.players[0]?.id??'';
  }
  if(!r.players.some(x=>x.ws)){
    clearTimer(r);
    setTimeout(()=>{if(!r.players.some(x=>x.ws))rooms.delete(r.code)},5*60*1000);
  }
  broadcast(r);
}

export function setupGameServer(server:any){
  const wss=new WebSocketServer({server,path:'/ws'});

  wss.on('connection',ws=>{
    ws.on('message',raw=>{
      let m:ClientMsg;
      try{m=JSON.parse(String(raw))}catch{return}
      const err=(msg:string)=>send(ws,{t:'error',msg});

      if(m.t==='create'||m.t==='join'){
        leaveRoom(ws);

        const name=String(m.name??'').trim().slice(0,20);
        if(!name)return err('ใส่ชื่อของคุณก่อน');

        let r:Room|undefined;
        if(m.t==='create'){
          r={code:newCode(),host:'',players:[],cfg:defaultCfg(),phase:'lobby',cur:0,deadline:0,timer:null,notice:'',revealKind:null,done:0};
          rooms.set(r.code,r);
        }else{
          const code=String(m.code??'').trim().toUpperCase();
          if(!code)return err('ใส่รหัสห้อง 4 ตัวอักษร');
          r=rooms.get(code);
          if(!r)return err(`ไม่พบห้อง "${code}" (โปรดตรวจสอบรหัสห้อง)`);
        }

        let p=r.players.find(x=>x.token===m.token);
        if(p){
          if(p.ws&&p.ws!==ws){
            conns.delete(p.ws);
            p.ws.close();
          }
          p.ws=ws;
          p.name=name;
        }else{
          if(r.phase!=='lobby')return err('เกมในห้องนี้เริ่มไปแล้ว ไม่สามารถเข้าร่วมได้ในขณะนี้');
          if(r.players.length>=12)return err('ห้องนี้เต็มแล้ว (จำกัดไม่เกิน 12 คน)');
          if(r.players.some(x=>x.name.toLowerCase()===name.toLowerCase())){
            return err(`มีคนใช้ชื่อ "${name}" ในห้องนี้แล้ว โปรดเปลี่ยนชื่อ`);
          }
          p={id:uid(),token:m.token,name,ws,ch:null,status:'play',q:0,wrong:0,fin:0};
          r.players.push(p);
          if(!r.host)r.host=p.id;
        }

        conns.set(ws,{room:r,pid:p.id});
        broadcast(r);
        return;
      }

      if(m.t==='leave'){
        leaveRoom(ws);
        send(ws,{t:'left'});
        return;
      }

      const c=conns.get(ws);
      if(!c)return err('ยังไม่ได้เข้าห้อง');
      const {room:r,pid}=c, isHost=r.host===pid;

      switch(m.t){
        case 'cfg':
          if(!isHost||r.phase!=='lobby')return;
          r.cfg={
            cats:m.cfg.cats.filter(id=>CATS.some(x=>x.id===id)),
            hard:!!m.cfg.hard,
            seconds:Math.max(10,Math.min(600,Math.floor(+m.cfg.seconds||60)))
          };
          break;
        case 'start':{
          if(!isHost||r.phase!=='lobby')return;
          const e=startGame(r);
          if(e)return err(e);
          break}
        case 'act':return act(r,pid,m.a);
        case 'again':{
          if(!isHost||r.phase!=='final')return;
          const e=startGame(r);
          if(e)return err(e);
          break}
        case 'lobby':
          if(!isHost||r.phase!=='final')return;
          r.phase='lobby';r.notice='';r.players.forEach(p=>{p.ch=null});
          break;
      }
      broadcast(r);
    });

    ws.on('close',()=>{
      leaveRoom(ws);
    });
  });

  return wss;
}
