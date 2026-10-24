import type {Act,ClientMsg,Config,PlayerView,ServerMsg,View} from './shared';

const app=document.getElementById('app')!;
const esc=(s:string)=>s.replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]!));

interface Session{token:string;name:string;code:string}
const loadSession=():Session|null=>{try{return JSON.parse(sessionStorage.getItem('hg')??'null')}catch{return null}};
const saveSession=(s:Session|null)=>s?sessionStorage.setItem('hg',JSON.stringify(s)):sessionStorage.removeItem('hg');
const token=()=>loadSession()?.token||Math.random().toString(36).slice(2)+Date.now().toString(36);

let ws:WebSocket|null=null;
let view:View|null=null;
let err='';
let isConnecting=false;
let isConnected=false;
let toastMsg='';
let toastTimer=0;
let deadline=0,tick=0;
let reconnectTimer=0;
const pending:ClientMsg[]=[];

function showToast(msg:string){
  toastMsg=msg;
  clearTimeout(toastTimer);
  render();
  toastTimer=window.setTimeout(()=>{toastMsg='';render()},2000);
}

function initWs(){
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
  clearTimeout(reconnectTimer);
  isConnecting=true;
  render();

  const proto=location.protocol==='https:'?'wss':'ws';
  const url=`${proto}://${location.host}/ws`;

  try{
    ws=new WebSocket(url);
  }catch{
    isConnecting=false;
    isConnected=false;
    err='ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';
    render();
    scheduleReconnect();
    return;
  }

  ws.onopen=()=>{
    isConnecting=false;
    isConnected=true;
    err='';
    const s=loadSession();
    if(s&&s.code&&!view){
      pending.unshift({t:'join',code:s.code,name:s.name,token:s.token});
    }
    flush();
    render();
  };

  ws.onmessage=e=>{
    let m:ServerMsg;
    try{m=JSON.parse(e.data)}catch{return}
    if(m.t==='error'){
      err=m.msg;
      if(!view){
        const s=loadSession();
        if(s)saveSession({...s,code:''});
      }
    }else if(m.t==='left'){
      view=null;
      const s=loadSession();
      if(s)saveSession({...s,code:''});
      err='';
    }else if(m.t==='view'){
      err='';
      view=m.view;
      const s=loadSession();
      if(s)saveSession({...s,code:view.code});
      deadline=Date.now()+view.remainingMs;
      startTick();
    }
    render();
  };

  ws.onerror=()=>{
    isConnecting=false;
    isConnected=false;
    if(!view)err='การเชื่อมต่อมีปัญหา กำลังลองใหม่...';
    render();
  };

  ws.onclose=()=>{
    ws=null;
    isConnecting=false;
    isConnected=false;
    render();
    scheduleReconnect();
  };
}

function scheduleReconnect(){
  clearTimeout(reconnectTimer);
  reconnectTimer=window.setTimeout(()=>{
    initWs();
  },2000);
}

function flush(){
  while(pending.length&&ws?.readyState===WebSocket.OPEN){
    const msg=pending.shift()!;
    ws.send(JSON.stringify(msg));
  }
}

function send(m:ClientMsg){
  pending.push(m);
  if(!ws||ws.readyState!==WebSocket.OPEN){
    initWs();
  }else{
    flush();
  }
}

const act=(a:Act)=>send({t:'act',a});

function startTick(){
  clearInterval(tick);
  tick=window.setInterval(()=>{
    const left=Math.max(0,deadline-Date.now());
    const t=document.getElementById('tl'),bar=document.getElementById('bar'),box=document.getElementById('tbox');
    if(!t)return;
    t.textContent=`${Math.ceil(left/1000)} วินาที`;
    if(bar&&view)bar.style.width=`${left/(view.cfg.seconds*10)}%`;
    box?.classList.toggle('low',left<=10000);
  },250);
}

/* ---------- วาดหน้าจอ ---------- */
const connBadgeHtml=()=>`<div class="conn-status">
  <span class="conn-dot ${isConnected?'online':isConnecting?'':'offline'}"></span>
  <span>${isConnected?'ออนไลน์':isConnecting?'กำลังเชื่อมต่อ…':'ออฟไลน์'}</span>
</div>`;

const topbarHtml=(code?:string)=>`<header class="topbar">
  <div class="brand">
    <span class="brand-mark">?</span>
    <span>ตัวบนหัว</span>
  </div>
  <div class="topbar-right">
    ${code?`<span class="room-pill">#${esc(code)}</span>`:''}
    ${connBadgeHtml()}
  </div>
</header>`;

const timerHtml=()=>`<div class="timer-wrap">
  <div class="tl"><span>เวลาที่เหลือในตานี้</span><span id="tl" class="tl-sec"></span></div>
  <div id="tbox" class="timer" aria-hidden="true"><i id="bar"></i></div>
</div>`;

function board(v:View){
  return `<div class="board-strip">
    <div class="board-title">สถานะผู้เล่นในรอบนี้</div>
    <div class="board-chips">
      ${v.players.map(x=>{
        const isTurn=v.phase==='turn'&&x.id===v.cur;
        const stCls=isTurn?'active':x.status==='won'?'won':x.status==='gave'?'gave':'';
        const stTxt=x.status==='play'?(isTurn?'กำลังถาม':'รอตา'):x.status==='won'?'ทายถูก ✓':'ยอมแพ้';
        return `<div class="p-chip ${stCls}">
          <span>${esc(x.name)}${x.id===v.me?' (คุณ)':''}</span>
          <span class="muted">· ${stTxt} (${x.q})</span>
          ${x.connected?'':'<span class="no">[หลุด]</span>'}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function render(){
  const v=view;
  const off=!isConnected&&v?'<div class="warn"><span>ขาดการเชื่อมต่อกับเซิร์ฟเวอร์ กำลังเชื่อมต่อใหม่อัตโนมัติ…</span></div>':'';

  if(!v){
    const connEl=document.querySelector('.conn-status');
    const errEl=document.querySelector('.err');
    const nameInput=document.getElementById('name');
    if(connEl&&nameInput){
      connEl.outerHTML=connBadgeHtml();
      if(errEl)errEl.textContent=err;
      return;
    }

    const params=new URLSearchParams(location.search);
    const roomParam=(params.get('room')??'').toUpperCase().slice(0,4);
    const savedName=loadSession()?.name??'';

    app.innerHTML=`
      ${topbarHtml()}
      <div class="hero-box">
        <h1>เกมทายตัวละครบนหัว</h1>
        <p class="sub" style="margin-bottom:16px">สร้างห้องแล้วส่งรหัสให้เพื่อนเข้าจากมือถือของตัวเอง ทุกคนจะเห็นการ์ดของเพื่อนและมีโพยช่วยตอบคำถามให้ครบ</p>

        <label class="field" for="name">ชื่อเล่นของคุณ</label>
        <input type="text" id="name" maxlength="20" placeholder="เช่น บาส, มิน, นัท..." autocomplete="off" value="${esc(savedName)}">
        <div style="height:12px"></div>
        <button class="primary" data-act="create">สร้างห้องใหม่</button>

        <div class="divider">หรือมีรหัสห้องจากเพื่อนแล้ว</div>

        <label class="field" for="code">รหัสห้อง 4 ตัวอักษร</label>
        <input type="text" id="code" class="code-input" maxlength="4" placeholder="ABCD" autocomplete="off" autocapitalize="characters" value="${esc(roomParam)}">
        <div style="height:10px"></div>
        <button data-act="join">เข้าร่วมห้อง</button>
      </div>

      <div class="card-subtle">
        <h2>กติกาการเล่นแบบย่อ</h2>
        <div class="muted" style="font-size:14.5px">
          1. ระบบสุ่มตัวละครให้ทุกคน คนละ 1 ตัว (คุณไม่เห็นของตัวเอง แต่เพื่อนทุกคนเห็น)<br>
          2. เมื่อถึงตาคุณ ให้ถามคำถาม <b>ใช่ / ไม่ใช่</b> กับเพื่อนด้วยปากจริงๆ ถ้าเพื่อนตอบ <b>"ใช่"</b> จะได้ถามต่อ<br>
          3. เมื่อมั่นใจให้พูดทายชื่อตัวละคร ถ้าทายถูกจะได้เข้ารอบจัดอันดับทันที!
        </div>
      </div>
      <p class="err center">${esc(err)}</p>`;
    return;
  }

  const cur=v.players.find(p=>p.id===v.cur);
  const isHost=v.host===v.me;

  if(v.phase==='lobby'){
    const totalChars=v.cats.filter(c=>v.cfg.cats.includes(c.id)).reduce((s,c)=>s+c.count,0);
    app.innerHTML=`
      ${topbarHtml(v.code)}
      ${off}
      <div class="ticket">
        <p class="muted" style="margin:0;font-size:13.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">รหัสห้องสำหรับชวนเพื่อน</p>
        <div class="code">${v.code}</div>
        <p class="muted" style="margin:0 0 10px;font-size:14px">มีตัวละครพร้อมสุ่มในหมวดที่เลือกทั้งหมด <b>${totalChars}</b> ตัวละคร</p>
        <div class="btn-row">
          <button class="btn-sm" data-act="copy-code">คัดลอกรหัส ${v.code}</button>
          <button class="btn-sm primary" data-act="copy-link">คัดลอกลิงก์ชวนเพื่อน</button>
        </div>
        ${toastMsg?`<div><span class="toast">${esc(toastMsg)}</span></div>`:''}
      </div>

      <div class="card">
        <h2>
          <span>ผู้เล่นในห้อง (${v.players.length} คน)</span>
          <span style="text-transform:none;font-weight:500">${v.players.length<2?'รอเพื่อนเข้าห้องอีกอย่างน้อย 1 คน':'พร้อมเริ่มเกม!'}</span>
        </h2>
        ${v.players.map(p=>`<div class="pl">
          <div class="pl-left">
            <span class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</span>
            <span><b>${esc(p.name)}</b>${p.id===v.me?' <span class="muted">(คุณ)</span>':''}</span>
          </div>
          <div>
            ${p.id===v.host?'<span class="tag">เจ้าของห้อง</span>':''}
            ${p.connected?'':'<span class="tag tag-no">หลุดการเชื่อมต่อ</span>'}
          </div>
        </div>`).join('')}
      </div>

      <div class="card">
        <h2>
          <span>เลือกหมวดตัวละคร ${isHost?'':'(เจ้าของห้องตั้งค่า)'}</span>
          ${isHost?`<button type="button" class="link-btn" data-act="all-cats">เลือกทั้งหมด</button>`:''}
        </h2>
        <div class="chips">
          ${v.cats.map(c=>`<label>
            <input type="checkbox" data-cat="${c.id}" ${v.cfg.cats.includes(c.id)?'checked':''} ${isHost?'':'disabled'}>
            <span>${esc(c.name)}</span>
            <span class="cat-count">${c.count}</span>
          </label>`).join('')}
        </div>

        <div style="height:16px"></div>
        <h2>ระดับความยาก</h2>
        <div class="chips">
          <label><input type="radio" name="lv" value="easy" ${v.cfg.hard?'':'checked'} ${isHost?'':'disabled'}><span>ง่าย (เฉพาะตัวดัง ยอดฮิต)</span></label>
          <label><input type="radio" name="lv" value="hard" ${v.cfg.hard?'checked':''} ${isHost?'':'disabled'}><span>รวมทั้งหมด (มีตัวลึก/ตำนาน)</span></label>
        </div>

        <div style="height:16px"></div>
        <label class="field" for="sec">เวลาต่อตา (วินาที)</label>
        <div class="preset-row" style="margin-bottom:8px">
          ${[45,60,90,120].map(s=>`<button type="button" class="preset-btn ${v.cfg.seconds===s?'active':''}" data-sec="${s}" ${isHost?'':'disabled'}>${s} วิ</button>`).join('')}
        </div>
        <input type="number" id="sec" min="10" max="600" step="5" inputmode="numeric" value="${v.cfg.seconds}" ${isHost?'':'disabled'}>
      </div>

      ${isHost
        ?`<button class="primary" data-act="start" ${v.players.length<2?'disabled':''}>เริ่มเกมเลย (${v.players.length} คน)</button>`
        :'<div class="card-subtle center muted">รอเจ้าของห้องกดเริ่มเกม…</div>'}
      <div style="height:8px"></div>
      <button class="subtle" data-act="leave">ออกจากห้อง</button>
      ${err?`<p class="err center">${esc(err)}</p>`:''}`;
    return;
  }

  if(v.phase==='turn'&&cur){
    const mine=cur.id===v.me;
    const head=v.notice?`<div class="notice">${esc(v.notice)}</div>`:'';
    if(mine){
      app.innerHTML=`
        ${topbarHtml(v.code)}
        ${off}${head}
        <div class="mystery-card">
          <div class="mystery-icon">?</div>
          <p class="muted" style="margin:0;font-size:14px;font-weight:600">ถึงตาของคุณแล้ว!</p>
          <div class="who">${esc(cur.name)}</div>
          <p style="margin:6px 0 0;color:var(--ink-soft);font-size:15.5px">
            ถามคำถาม <b>ใช่ / ไม่ใช่</b> กับเพื่อนๆ ด้วยปากได้เลย<br>
            ถ้าเพื่อนตอบ <b>"ใช่"</b> ถามต่อได้เรื่อยๆ จนกว่าจะตอบ <b>"ไม่ใช่"</b> หรือทายชื่อ
          </p>
        </div>

        <div class="card-subtle">
          <h2>ตัวอย่างคำถามใช้ถามเพื่อน</h2>
          <div class="muted" style="font-size:14.5px">
            • "ฉันเป็นคนจริงๆ หรือเป็นตัวละครในเกม?" · "ฉันเป็นผู้ชายใช่ไหม?"<br>
            • "ฉันเป็นนักฟุตบอลใช่ไหม?" · "ฉันอยู่ลีกพรีเมียร์ลีกหรือเปล่า?"<br>
            • "ฉันเป็นสายแครี่ / Duelist ใช่ไหม?" · "ฉันเป็นคนไทยหรือเปล่า?"
          </div>
        </div>

        ${timerHtml()}
        <div class="counter">
          <button data-act="q-">−1</button>
          <b><span>${cur.q}</span><small>จำนวนคำถามที่ถามไปแล้ว</small></b>
          <button class="primary" data-act="q+">+1</button>
        </div>
        <div class="actions">
          <button data-act="skip">จบตา / ข้ามตานี้</button>
          <button class="bad" data-act="give">ยอมแพ้ (ดูเฉลย)</button>
        </div>
        ${board(v)}
        ${err?`<p class="err center">${esc(err)}</p>`:''}`;
    }else{
      app.innerHTML=`
        ${topbarHtml(v.code)}
        ${off}${head}
        <div class="warn">
          <span>ถึงตาของ <b>${esc(cur.name)}</b> (เจ้าตัวไม่เห็นหน้านี้)</span>
          <span class="tag">ช่วยกันตอบ ใช่ / ไม่ใช่</span>
        </div>

        <div class="playing-card">
          <div class="playing-card-head">
            <span>ตัวละครบนหัวของ ${esc(cur.name)}</span>
            ${cur.ch?.cat?`<span class="cat-badge">หมวด: ${esc(cur.ch.cat)}</span>`:''}
          </div>
          <div class="playing-card-body">
            <div class="big">${esc(cur.ch?.name??'')}</div>
            ${cur.ch?.aliases.length?`
              <div class="muted" style="font-size:13px;margin-top:4px">ชื่อที่อนุโลมให้ทายถูกได้:</div>
              <div class="aliases-row">
                ${cur.ch.aliases.map(a=>`<span class="alias-pill">${esc(a)}</span>`).join('')}
              </div>
            `:''}
          </div>
        </div>

        <div class="card">
          <h2>โพยข้อมูลช่วยตอบคำถาม (สำหรับเพื่อน)</h2>
          <ul class="hints">
            ${(cur.ch?.hints??[]).map(h=>`<li><span>${esc(h)}</span></li>`).join('')}
          </ul>
        </div>

        ${timerHtml()}
        <div class="counter">
          <button data-act="q-">−1</button>
          <b><span>${cur.q}</span><small>คำถามที่ ${esc(cur.name)} ถามไปแล้ว</small></b>
          <button data-act="q+">+1</button>
        </div>
        <div class="actions">
          <button class="ok" data-act="correct">ทายถูก! (เฉลย)</button>
          <button class="bad" data-act="wrong">ทายผิด (เสียตา)</button>
        </div>
        ${board(v)}`;
    }
    const t=document.getElementById('tl');
    if(t)t.textContent=`${Math.ceil(Math.max(0,deadline-Date.now())/1000)} วินาที`;
    return;
  }

  if(v.phase==='reveal'&&cur){
    const mine=cur.id===v.me;
    const isWon=v.revealKind==='won';
    app.innerHTML=`
      ${topbarHtml(v.code)}
      ${off}
      <div class="playing-card" style="margin-top:8px">
        <div class="playing-card-head">
          <span>เฉลยตัวละครของ ${mine?'คุณ':esc(cur.name)}</span>
          ${cur.ch?.cat?`<span class="cat-badge">${esc(cur.ch.cat)}</span>`:''}
        </div>
        <div class="playing-card-body">
          <div style="margin-bottom:8px">
            <span class="tag ${isWon?'tag-yes':'tag-no'}" style="font-size:14px;padding:4px 14px">
              ${isWon?'🎉 ทายถูกต้อง!':'🏳️ ยอมแพ้'}
            </span>
          </div>
          <div class="big">${esc(cur.ch?.name??'')}</div>
          <p class="muted" style="margin:6px 0 0">
            ใช้คำถามไปทั้งหมด <b>${cur.q}</b> ข้อ · ทายผิด <b>${cur.wrong}</b> ครั้ง
          </p>
        </div>
      </div>
      <button class="primary" data-act="next">ไปตาถัดไป</button>
      ${board(v)}`;
    return;
  }

  /* final */
  const order=[...v.players].sort((a,b)=>(a.status==='won'?0:1)-(b.status==='won'?0:1)||a.q-b.q||a.fin-b.fin);
  const row=(x:PlayerView,i:number)=>`<tr>
    <td><span class="rank-badge ${i<3?`rank-${i+1}`:''}">${i+1}</span></td>
    <td>
      <b>${esc(x.name)}</b>${x.id===v.me?' <span class="muted">(คุณ)</span>':''}
      ${x.status==='gave'?'<div><span class="tag tag-no" style="font-size:11px">ยอมแพ้</span></div>':''}
    </td>
    <td>
      <b>${esc(x.ch?.name??'')}</b>
      ${x.ch?.cat?`<div class="muted" style="font-size:12px">${esc(x.ch.cat)}</div>`:''}
    </td>
    <td style="font-family:var(--mono);font-weight:600">${x.q}</td>
    <td style="font-family:var(--mono);color:var(--muted)">${x.wrong}</td>
  </tr>`;

  app.innerHTML=`
    ${topbarHtml(v.code)}
    ${off}
    <div class="hero-box center" style="padding:18px">
      <h1 style="margin-bottom:4px">สรุปอันดับจบเกม</h1>
      <p class="sub" style="margin:0">ทายถูก + ใช้จำนวนคำถามน้อยกว่า = อันดับดีกว่า</p>
    </div>
    <div class="card" style="padding:12px 16px">
      <table>
        <thead><tr><th>#</th><th>ผู้เล่น</th><th>ตัวละครที่ได้</th><th>ถาม</th><th>ผิด</th></tr></thead>
        <tbody>${order.map(row).join('')}</tbody>
      </table>
    </div>
    ${isHost
      ?'<div class="actions"><button class="primary" data-act="again">เล่นอีกครั้ง (หมวดเดิม)</button><button data-act="lobby">ตั้งค่าหมวดใหม่</button></div>'
      :'<div class="card-subtle center muted">รอเจ้าของห้องกดเริ่มรอบใหม่หรือกลับล็อบบี้…</div>'}
    <div style="height:10px"></div>
    <button class="subtle" data-act="leave">ออกจากห้อง</button>`;
}

/* ---------- เหตุการณ์ ---------- */
const val=(id:string)=>(document.getElementById(id) as HTMLInputElement)?.value??'';

function sendCfg(overrideSec?:number,overrideCats?:string[]){
  const cats=overrideCats??[...document.querySelectorAll<HTMLInputElement>('[data-cat]:checked')].map(i=>i.dataset.cat!);
  const lvEl=document.querySelector('input[name=lv]:checked') as HTMLInputElement|null;
  const cfg:Config={
    cats,
    hard:lvEl?lvEl.value==='hard':Boolean(view?.cfg.hard),
    seconds:overrideSec??(+val('sec')||60),
  };
  send({t:'cfg',cfg});
}

app.addEventListener('change',e=>{
  const el=e.target as HTMLElement;
  if(view?.phase==='lobby'&&(el.matches('[data-cat],input[name=lv],#sec')))sendCfg();
});

function handleCreate(){
  const name=val('name').trim();
  if(!name){err='กรุณาใส่ชื่อของคุณก่อน';render();return}
  err='';
  const t=token();
  saveSession({token:t,name,code:''});
  send({t:'create',name,token:t});
}

function handleJoin(){
  const name=val('name').trim();
  if(!name){err='กรุณาใส่ชื่อของคุณก่อน';render();return}
  const code=val('code').trim().toUpperCase();
  if(code.length!==4){err='กรุณาใส่รหัสห้อง 4 ตัวอักษร';render();return}
  err='';
  const t=token();
  saveSession({token:t,name,code});
  send({t:'join',code,name,token:t});
}

app.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const target=e.target as HTMLElement;
    if(target.id==='code'){
      handleJoin();
    }else if(target.id==='name'){
      if(val('code').trim().length===4)handleJoin();
      else handleCreate();
    }
  }
});

app.addEventListener('click',e=>{
  const secBtn=(e.target as HTMLElement).closest<HTMLElement>('[data-sec]');
  if(secBtn&&view?.phase==='lobby'){
    const s=Number(secBtn.dataset.sec);
    if(s)sendCfg(s);
    return;
  }

  const a=(e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if(!a)return;
  switch(a){
    case 'create':handleCreate();break;
    case 'join':handleJoin();break;
    case 'all-cats':{
      if(view?.phase==='lobby'){
        sendCfg(undefined,view.cats.map(c=>c.id));
      }
      break;
    }
    case 'copy-code':{
      if(view?.code){
        navigator.clipboard?.writeText(view.code).then(()=>showToast('คัดลอกรหัสห้องแล้ว')).catch(()=>{});
      }
      break;
    }
    case 'copy-link':{
      if(view?.code){
        const link=`${location.origin}/?room=${view.code}`;
        navigator.clipboard?.writeText(link).then(()=>showToast('คัดลอกลิงก์ชวนเพื่อนแล้ว')).catch(()=>{});
      }
      break;
    }
    case 'leave':send({t:'leave'});break;
    case 'start':send({t:'start'});break;
    case 'again':send({t:'again'});break;
    case 'lobby':send({t:'lobby'});break;
    default:act(a as Act);
  }
});

// เริ่มเชื่อมต่อ WebSocket ทันทีเมื่อเปิดหน้าเว็บ
initWs();
