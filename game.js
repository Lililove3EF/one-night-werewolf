import { auth, db, ensureLogin } from './firebase.js';
import { ref, set, get, update, remove, onValue } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js';
import { ROLE_DEFS, NIGHT_PHASES, roleLabel, roleEmoji, recommendedRoles, countRoles, validateRoleDeck } from './roles.js';

const app=document.getElementById('app');
const banner=document.getElementById('banner');
const SESSION='onuw_fb_session_v1';
let me=null,roomCode=null,nickname='',meta=null,members={},pub=null,priv=null,result=null,myVote=null;
let roleDraft=null,selected=[],subs=[],hostSubs=[],hostRoom=null,hostQueue=Promise.resolve(),timerHandle=null;
let roomLoaded={meta:false,members:false};
let entryBusy=false;
const immediateDoppel=new Set(['seer','robber','troublemaker','drunk']);

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const rid=(p='id')=>globalThis.crypto?.randomUUID?`${p}_${crypto.randomUUID()}`:`${p}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const rcode=()=>Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
const players=()=>Object.entries(members??{}).map(([uid,v])=>({uid,...(v??{})})).sort((a,b)=>(a.joinedAt??0)-(b.joinedAt??0));
const isHost=()=>!!me&&meta?.hostUid===me.uid;
const roleOf=card=>card?.effectiveRole||card?.baseRole||null;
const cardMarkup=r=>`<div class="role-icon">${roleEmoji(r)}</div><div class="role-big">${esc(roleLabel(r))}</div>`;

function flash(msg,kind='ok'){banner.textContent=msg;banner.className=`banner ${kind==='error'?'error':''}`;setTimeout(()=>{if(banner.textContent===msg)banner.classList.add('hidden')},4000)}
function saveSession(){if(roomCode)localStorage.setItem(SESSION,JSON.stringify({roomCode,nickname}))}
function clearSession(){localStorage.removeItem(SESSION)}
function stopAll(){for(const off of [...subs,...hostSubs])try{off()}catch{};subs=[];hostSubs=[];hostRoom=null;roomLoaded={meta:false,members:false}}
function setEntryBusy(busy){
  entryBusy=busy;
  const create=document.getElementById('create'),join=document.getElementById('join');
  if(create){create.disabled=busy;create.textContent=busy?'처리 중…':'새 방 만들기'}
  if(join){join.disabled=busy;join.textContent=busy?'처리 중…':'방 참가하기'}
}

async function boot(){
  try{
    me=await ensureLogin();

    // Realtime Database를 실제로 사용하는 앱이므로 databaseURL 누락을 초기에 잡아준다.
    const databaseURL=db?.app?.options?.databaseURL;
    if(!databaseURL){
      throw new Error('firebaseConfig에 databaseURL이 없습니다. Firebase Console → Realtime Database에서 URL을 복사해 firebase.js에 추가하세요.');
    }
  }catch(e){
    app.innerHTML=`<div class="card"><h2 class="title">Firebase 연결 설정 확인 필요</h2><div class="hint">${esc(e.message)}</div></div>`;
    return;
  }
  const saved=JSON.parse(localStorage.getItem(SESSION)||'null');
  if(saved?.roomCode){const s=await get(ref(db,`rooms/${saved.roomCode}/members/${me.uid}`));if(s.exists()){roomCode=saved.roomCode;nickname=saved.nickname||s.val()?.name||'';listenRoom();return}else clearSession()}
  renderLanding();
}

function renderLanding(){stopAll();roomCode=null;meta=null;members={};pub=null;priv=null;result=null;myVote=null;roleDraft=null;selected=[];
  app.innerHTML=`<div class="card"><h2 class="title">게임 시작</h2><div class="stack"><input id="nick" maxlength="20" placeholder="닉네임" value="${esc(nickname)}"><button class="btn btn-primary btn-wide" id="create">새 방 만들기</button><hr><input id="code" maxlength="6" placeholder="방 코드 6자리" style="text-transform:uppercase"><button class="btn btn-ghost btn-wide" id="join">방 참가하기</button></div></div><div class="hint">친구는 별도 계정 없이 사이트 링크만 열면 됩니다. Firebase 익명 UID가 자동 발급됩니다.</div>`;
  document.getElementById('create').onclick=createRoom;document.getElementById('join').onclick=joinRoom;
}

async function createRoom(){
  if(entryBusy)return;
  const name=document.getElementById('nick').value.trim();
  if(!name||name.length>20)return flash('닉네임을 1~20자로 입력해 주세요.','error');

  let code='';
  setEntryBusy(true);
  try{
    for(let i=0;i<12;i++){
      const c=rcode();
      const snap=await get(ref(db,`rooms/${c}/meta`));
      if(!snap.exists()){code=c;break}
    }
    if(!code)throw new Error('방 코드 생성에 실패했습니다. 다시 시도해 주세요.');

    const now=Date.now();
    // 순차 생성하되 실패 시 고아 방을 정리한다.
    await set(ref(db,`rooms/${code}/meta`),{hostUid:me.uid,phase:'lobby',createdAt:now,discussionSeconds:300,roleConfig:[]});
    await set(ref(db,`rooms/${code}/members/${me.uid}`),{name,joinedAt:now});
    await set(ref(db,`rooms/${code}/public`),{phase:'lobby',updatedAt:now});

    roomCode=code;nickname=name;saveSession();listenRoom();
  }catch(e){
    console.error('createRoom failed',e);
    // meta까지 만들어졌는데 이후 단계가 실패한 경우 가능한 범위에서 정리한다.
    if(code){
      try{await remove(ref(db,`rooms/${code}/public`))}catch{}
      try{await remove(ref(db,`rooms/${code}/members/${me.uid}`))}catch{}
      try{await remove(ref(db,`rooms/${code}/meta`))}catch{}
    }
    setEntryBusy(false);
    flash(`방 생성 실패: ${e?.message||e}`,'error');
  }
}

async function joinRoom(){
  if(entryBusy)return;
  const name=document.getElementById('nick').value.trim(),code=document.getElementById('code').value.trim().toUpperCase();
  if(!name||name.length>20)return flash('닉네임을 1~20자로 입력해 주세요.','error');
  if(!/^[A-Z0-9]{6}$/.test(code))return flash('방 코드 6자리를 입력해 주세요.','error');
  setEntryBusy(true);
  try{
    const ms=await get(ref(db,`rooms/${code}/meta`));if(!ms.exists())throw new Error('존재하지 않는 방입니다.');if(ms.val().phase!=='lobby')throw new Error('이미 시작된 방입니다.');
    const ps=await get(ref(db,`rooms/${code}/members`)),list=ps.val()??{};if(Object.keys(list).length>=10)throw new Error('최대 10명까지 참가할 수 있습니다.');
    if(Object.values(list).some(p=>String(p?.name??'').toLowerCase()===name.toLowerCase()))throw new Error('이미 사용 중인 닉네임입니다.');
    await set(ref(db,`rooms/${code}/members/${me.uid}`),{name,joinedAt:Date.now()});
    roomCode=code;nickname=name;saveSession();listenRoom();
  }catch(e){
    setEntryBusy(false);
    console.error('joinRoom failed',e);
    flash(`방 참가 실패: ${e?.message||e}`,'error');
  }
}

function listenRoom(){
  stopAll();
  // Firebase의 각 onValue는 독립적으로 최초 값을 전달한다.
  // meta가 members보다 먼저 오는 정상적인 상황을 '방에서 나감'으로 오판하지 않도록
  // 두 핵심 스냅샷의 최초 로딩 완료 여부를 따로 추적한다.
  roomLoaded={meta:false,members:false};

  const items=[
    ['meta',v=>meta=v,()=>roomLoaded.meta=true],
    ['members',v=>members=v??{},()=>roomLoaded.members=true],
    ['public',v=>pub=v,null],
    [`private/${me.uid}`,v=>priv=v,null],
    ['result',v=>result=v,null],
    [`votes/${me.uid}`,v=>myVote=v??null,null]
  ];

  for(const [path,setter,markLoaded] of items){
    subs.push(onValue(
      ref(db,`rooms/${roomCode}/${path}`),
      s=>{setter(s.val());if(markLoaded)markLoaded();stateChanged()},
      e=>{console.error('room listener failed',path,e);flash(`방 데이터 읽기 실패: ${e?.message||e}`,'error')}
    ));
  }
}

function stateChanged(){
  // meta/members 두 리스너가 모두 최초 값을 받은 뒤에만 방 상태를 판정한다.
  if(!roomLoaded.meta||!roomLoaded.members)return;

  if(!meta){
    clearSession();
    renderLanding();
    flash('존재하지 않거나 삭제된 방입니다.','error');
    return;
  }

  if(!members?.[me.uid]){
    clearSession();
    renderLanding();
    flash('이 방의 참가자 목록에 내가 없습니다. 다시 참가해 주세요.','error');
    return;
  }

  entryBusy=false;
  if(isHost()){
    ensureHostWatchers();
    if(meta.phase==='night')hostQueue=hostQueue.then(()=>ensureNight()).catch(console.error);
  }else if(hostRoom){
    stopHostWatchers();
  }
  render();
}
function ensureHostWatchers(){
  if(hostRoom===roomCode)return;stopHostWatchers();hostRoom=roomCode;
  hostSubs.push(onValue(ref(db,`rooms/${roomCode}/intents`),s=>{for(const [uid,intent] of Object.entries(s.val()??{}))if(intent?.id)hostQueue=hostQueue.then(()=>processIntent(uid,intent)).catch(console.error)}));
  hostSubs.push(onValue(ref(db,`rooms/${roomCode}/votes`),()=>{hostQueue=hostQueue.then(()=>maybeResolve()).catch(console.error)}));
}
function stopHostWatchers(){for(const off of hostSubs)try{off()}catch{};hostSubs=[];hostRoom=null}

function header(){const p=members[me.uid];return `<div class="card row"><div><div class="eyebrow">ROOM</div><div class="room-code">${esc(roomCode)}</div></div><div style="text-align:right"><b>${esc(p?.name||nickname)}</b><div class="muted">${isHost()?'👑 방장':'플레이어'} · ${players().length}명</div><button class="btn btn-ghost" style="min-height:auto;padding:7px 10px;margin-top:7px;font-size:12px" id="leave">나가기</button></div></div>`}
function bindHeader(){const b=document.getElementById('leave');if(b)b.onclick=leaveRoom}
async function leaveRoom(){
  if(meta?.phase!=='lobby'){if(!confirm('게임 진행 중입니다. 이 기기에서 방 연결만 끊을까요?'))return;clearSession();renderLanding();return}
  if(isHost()&&players().length>1)return flash('다른 플레이어가 있는 동안 방장은 나갈 수 없습니다.','error');
  await remove(ref(db,`rooms/${roomCode}/members/${me.uid}`));clearSession();renderLanding();
}
function render(){if(!meta)return;({lobby:renderLobby,night:renderNight,day:renderDay,voting:renderVoting,result:renderResult}[meta.phase]||renderLobby)()}
function peopleHtml(){return `<div class="people">${players().map((p,i)=>`<div class="person ${p.uid===me.uid?'me':''}"><span>${i+1}. ${esc(p.name)}</span><span class="muted">${p.uid===meta.hostUid?'👑':''} ${p.uid===me.uid?'나':''}</span></div>`).join('')}</div>`}

function renderLobby(){
  const list=players(),need=list.length+3,saved=Array.isArray(meta.roleConfig)?meta.roleConfig:[],err=validateRoleDeck(saved,list.length);
  app.innerHTML=header()+`<div class="card"><h2 class="title">대기실</h2>${peopleHtml()}<div class="hint" style="margin-top:12px">친구에게 방 코드 <b>${esc(roomCode)}</b>를 알려주세요.</div></div>`+(isHost()?roleEditor(need,saved):`<div class="hint">방장이 직업 ${need}장을 구성하고 게임을 시작할 때까지 기다려 주세요.</div>`)+(isHost()?`<div class="sticky"><button class="btn btn-primary btn-wide" id="start" ${list.length<3||err?'disabled':''}>🌙 게임 시작</button>${err?`<div class="muted" style="text-align:center;margin-top:7px">${esc(err)}</div>`:''}</div>`:'');
  bindHeader();if(isHost())bindRoleEditor();const s=document.getElementById('start');if(s)s.onclick=startGame;
}
function roleEditor(need,saved){if(!roleDraft)roleDraft=[...saved];const c=countRoles(roleDraft);return `<div class="card"><div class="row"><div><h2 class="title" style="margin-bottom:2px">직업 구성</h2><div class="muted">${roleDraft.length} / ${need}장</div></div><button class="btn btn-ghost" id="recommend">추천 구성</button></div><div style="margin-top:10px">${Object.entries(ROLE_DEFS).map(([r,d])=>`<div class="role-row"><div class="role-meta"><b>${d.emoji} ${esc(d.label)}</b><span>${esc(d.desc)}</span></div><div class="counter"><button data-minus="${r}">−</button><strong>${c[r]??0}</strong><button data-plus="${r}" ${(c[r]??0)>=d.max?'disabled':''}>＋</button></div></div>`).join('')}</div><hr><label class="muted">토론 시간 (초)</label><input id="discussion" type="number" min="30" max="1800" value="${Number(meta.discussionSeconds??300)}"><button class="btn btn-green btn-wide" style="margin-top:10px" id="saveRoles">구성 저장</button></div>`}
function bindRoleEditor(){
  document.getElementById('recommend').onclick=()=>{roleDraft=recommendedRoles(players().length);renderLobby()};
  document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{const r=b.dataset.plus;if(roleDraft.filter(x=>x===r).length<ROLE_DEFS[r].max)roleDraft.push(r);renderLobby()});
  document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const r=b.dataset.minus,i=roleDraft.lastIndexOf(r);if(i>=0)roleDraft.splice(i,1);renderLobby()});
  document.getElementById('saveRoles').onclick=async()=>{const roles=[...roleDraft],err=validateRoleDeck(roles,players().length);if(err)return flash(err,'error');const sec=Math.max(30,Math.min(1800,Number(document.getElementById('discussion').value||300)));await update(ref(db,`rooms/${roomCode}/meta`),{roleConfig:roles,discussionSeconds:sec});roleDraft=null;flash('직업 구성을 저장했습니다.')};
}

function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
async function startGame(){
  const list=players(),roles=Array.isArray(meta.roleConfig)?meta.roleConfig:[],err=validateRoleDeck(roles,list.length);if(err)return flash(err,'error');if(list.length<3)return flash('최소 3명이 필요합니다.','error');
  const shuffled=shuffle(roles),cards={},pp={},cp={},initial={},privateData={};
  shuffled.forEach((role,i)=>{const id=`c_${i}_${Math.random().toString(36).slice(2,7)}`;cards[id]={id,baseRole:role,effectiveRole:null};if(i<list.length){const uid=list[i].uid;pp[uid]=id;initial[uid]=role;privateData[uid]={initialRole:role,copiedRole:null,learned:{},nightContext:null}}else cp[i-list.length]=id});
  const engine={cards,positions:{player:pp,center:cp},initialRoleByPlayer:initial,doppelCopied:{},currentPhase:null,phaseIndex:-1,done:{},processedIntents:{},startedAt:Date.now()};
  await update(ref(db,`rooms/${roomCode}`),{'meta/phase':'night','public':{phase:'night',startedAt:Date.now()},'engine':engine,'private':privateData,'intents':null,'votes':null,'result':null});roleDraft=null;await ensureNight();
}

async function hostSnap(){const [m,ps,e,v]=await Promise.all([get(ref(db,`rooms/${roomCode}/meta`)),get(ref(db,`rooms/${roomCode}/members`)),get(ref(db,`rooms/${roomCode}/engine`)),get(ref(db,`rooms/${roomCode}/votes`))]);return{meta:m.val(),members:ps.val()??{},engine:e.val(),votes:v.val()??{}}}
const pentries=m=>Object.entries(m??{}).map(([uid,v])=>({uid,...(v??{})})).sort((a,b)=>(a.joinedAt??0)-(b.joinedAt??0));
const pname=(m,uid)=>m?.[uid]?.name??String(uid).slice(0,6);
function actors(engine,phase){const ini=engine.initialRoleByPlayer??{},copy=engine.doppelCopied??{},uids=Object.keys(ini);if(phase==='doppelganger')return uids.filter(u=>ini[u]==='doppelganger');if(phase==='doppel_minion')return uids.filter(u=>ini[u]==='doppelganger'&&copy[u]==='minion');if(phase==='doppel_insomniac')return uids.filter(u=>ini[u]==='doppelganger'&&copy[u]==='insomniac');const base=uids.filter(u=>ini[u]===phase);if(['werewolf','mason'].includes(phase))base.push(...uids.filter(u=>ini[u]==='doppelganger'&&copy[u]===phase));return[...new Set(base)]}
const clone=o=>JSON.parse(JSON.stringify(o));
const currentCard=(e,u)=>e.cards?.[e.positions?.player?.[u]];
const centerCard=(e,i)=>e.cards?.[e.positions?.center?.[String(i)]??e.positions?.center?.[i]];
function swapPP(e,a,b){const t=e.positions.player[a];e.positions.player[a]=e.positions.player[b];e.positions.player[b]=t}
function swapPC(e,u,i){i=String(i);const t=e.positions.player[u];e.positions.player[u]=e.positions.center[i];e.positions.center[i]=t}
const targets=(m,exclude=[])=>{const s=new Set(exclude);return pentries(m).filter(p=>!s.has(p.uid)).map(p=>({uid:p.uid,name:p.name}))};
function ctxForRole(role,uid,m,phase=role){const x={phase,asRole:role,createdAt:Date.now()};if(role==='seer')return{...x,kind:'seer',targets:targets(m,[uid])};if(role==='robber')return{...x,kind:'robber',targets:targets(m,[uid])};if(role==='troublemaker')return{...x,kind:'troublemaker',targets:targets(m,[uid])};if(role==='drunk')return{...x,kind:'drunk'};return x}
async function clearContexts(m){const ch={};for(const uid of Object.keys(m??{}))ch[`private/${uid}/nightContext`]=null;if(Object.keys(ch).length)await update(ref(db,`rooms/${roomCode}`),ch)}
async function ensureNight(){if(!isHost()||meta?.phase!=='night')return;const s=await get(ref(db,`rooms/${roomCode}/engine`)),e=s.val();if(e&&!e.currentPhase)await advancePhase(Number(e.phaseIndex??-1)+1)}
async function advancePhase(start){
  const s=await hostSnap();if(s.meta?.phase!=='night'||!s.engine)return;const e=clone(s.engine);await clearContexts(s.members);
  for(let i=start;i<NIGHT_PHASES.length;i++){
    const phase=NIGHT_PHASES[i],aa=actors(e,phase);if(!aa.length)continue;e.currentPhase=phase;e.phaseIndex=i;e.done=e.done??{};e.done[phase]=e.done[phase]??{};const ch={engine:e};
    for(const uid of aa){let c=null;if(phase==='doppelganger')c={phase,asRole:'doppelganger',kind:'doppel_copy',targets:targets(s.members,[uid]),createdAt:Date.now()};
      else if(['doppel_minion','minion'].includes(phase)){const ww=actors(e,'werewolf');c={phase,asRole:'minion',kind:'confirm',infoType:'wolves',info:ww.map(x=>({uid:x,name:pname(s.members,x)})),createdAt:Date.now()}}
      else if(phase==='werewolf'){const ww=actors(e,'werewolf').filter(x=>x!==uid);c=ww.length?{phase,asRole:'werewolf',kind:'confirm',infoType:'wolf_peers',info:ww.map(x=>({uid:x,name:pname(s.members,x)})),createdAt:Date.now()}:{phase,asRole:'werewolf',kind:'solo_wolf',createdAt:Date.now()}}
      else if(phase==='mason'){const mm=actors(e,'mason').filter(x=>x!==uid);c={phase,asRole:'mason',kind:'confirm',infoType:'mason_peers',info:mm.map(x=>({uid:x,name:pname(s.members,x)})),createdAt:Date.now()}}
      else if(['seer','robber','troublemaker','drunk'].includes(phase))c=ctxForRole(phase,uid,s.members,phase);
      else if(['insomniac','doppel_insomniac'].includes(phase)){const r=roleOf(currentCard(e,uid));c={phase,asRole:'insomniac',kind:'confirm',infoType:'current_role',info:{role:r,roleLabel:roleLabel(r)},createdAt:Date.now()}}
      ch[`private/${uid}/nightContext`]=c;
    }
    await update(ref(db,`rooms/${roomCode}`),ch);return;
  }
  await startDay(s.meta,s.members);
}
async function startDay(m,mm){await clearContexts(mm);const end=Date.now()+Math.max(30,Math.min(1800,Number(m?.discussionSeconds??300)))*1000;await update(ref(db,`rooms/${roomCode}`),{'meta/phase':'day','public':{phase:'day',discussionEndsAt:end,updatedAt:Date.now()},'engine/currentPhase':null})}

function learnedText(x){if(!x)return'';if(x.type==='doppel_copy')return `${x.targetName} 복제 → ${roleEmoji(x.role)} ${roleLabel(x.role)}`;if(x.type==='seer_player')return `${x.targetName}: ${roleEmoji(x.role)} ${roleLabel(x.role)}`;if(x.type==='seer_center')return `중앙 ${Number(x.index)+1}: ${roleEmoji(x.role)} ${roleLabel(x.role)}`;if(x.type==='robber')return `교환 후 내 카드: ${roleEmoji(x.role)} ${roleLabel(x.role)}`;if(x.type==='wolf_center')return `중앙 ${Number(x.index)+1}: ${roleEmoji(x.role)} ${roleLabel(x.role)}`;if(x.type==='wolves')return `늑대인간: ${x.names?.join(', ')||'플레이어 중 없음'}`;if(x.type==='wolf_peers')return `다른 늑대인간: ${x.names?.join(', ')||'없음'}`;if(x.type==='mason_peers')return `다른 프리메이슨: ${x.names?.join(', ')||'플레이어 중 없음'}`;if(x.type==='current_role')return `밤 마지막 내 카드: ${roleEmoji(x.role)} ${roleLabel(x.role)}`;return x.text||'정보 확인'}
async function addLearned(uid,item){await set(ref(db,`rooms/${roomCode}/private/${uid}/learned/${rid('l')}`),{...item,createdAt:Date.now()})}

async function processIntent(uid,intent){
  if(!isHost()||!intent?.id)return;const s=await hostSnap(),e=s.engine;if(!e||s.meta?.phase!=='night'){await remove(ref(db,`rooms/${roomCode}/intents/${uid}`));return}if(e.processedIntents?.[intent.id]){await remove(ref(db,`rooms/${roomCode}/intents/${uid}`));return}
  const cs=await get(ref(db,`rooms/${roomCode}/private/${uid}/nightContext`)),c=cs.val();if(!c||intent.phase!==e.currentPhase||c.phase!==e.currentPhase||!actors(e,e.currentPhase).includes(uid)){await remove(ref(db,`rooms/${roomCode}/intents/${uid}`));return}
  const n=clone(e);n.processedIntents=n.processedIntents??{};n.processedIntents[intent.id]=Date.now();const p=intent.payload??{};let complete=true;const valid=t=>!!s.members?.[t]&&t!==uid;
  try{
    if(c.kind==='doppel_copy'){
      if(!valid(p.targetUid))throw new Error('잘못된 복제 대상');const copied=roleOf(currentCard(n,p.targetUid)),dId=n.positions.player[uid];n.cards[dId].effectiveRole=copied;n.doppelCopied=n.doppelCopied??{};n.doppelCopied[uid]=copied;await set(ref(db,`rooms/${roomCode}/private/${uid}/copiedRole`),copied);await addLearned(uid,{type:'doppel_copy',targetName:pname(s.members,p.targetUid),role:copied});if(immediateDoppel.has(copied)){await set(ref(db,`rooms/${roomCode}/private/${uid}/nightContext`),ctxForRole(copied,uid,s.members,'doppelganger'));complete=false}}
    else if(c.kind==='solo_wolf'){const i=Number(p.centerIndex);if(![0,1,2].includes(i))throw new Error('중앙 카드를 선택');await addLearned(uid,{type:'wolf_center',index:i,role:roleOf(centerCard(n,i))})}
    else if(c.kind==='seer'){
      if(intent.actionType==='seer_player'){if(!valid(p.targetUid))throw new Error('대상을 선택');await addLearned(uid,{type:'seer_player',targetName:pname(s.members,p.targetUid),role:roleOf(currentCard(n,p.targetUid))})}
      else if(intent.actionType==='seer_center'){const ii=Array.isArray(p.centerIndexes)?p.centerIndexes.map(Number):[];if(ii.length!==2||new Set(ii).size!==2||ii.some(i=>![0,1,2].includes(i)))throw new Error('중앙 2장을 선택');for(const i of ii)await addLearned(uid,{type:'seer_center',index:i,role:roleOf(centerCard(n,i))})}else throw new Error('예언자 행동 오류')}
    else if(c.kind==='robber'){if(!valid(p.targetUid))throw new Error('대상을 선택');swapPP(n,uid,p.targetUid);await addLearned(uid,{type:'robber',role:roleOf(currentCard(n,uid))})}
    else if(c.kind==='troublemaker'){if(p.targetA===p.targetB||!valid(p.targetA)||!valid(p.targetB))throw new Error('두 대상을 선택');swapPP(n,p.targetA,p.targetB)}
    else if(c.kind==='drunk'){const i=Number(p.centerIndex);if(![0,1,2].includes(i))throw new Error('중앙 카드를 선택');swapPC(n,uid,i)}
    else if(c.kind==='confirm'){
      if(c.infoType==='wolves')await addLearned(uid,{type:'wolves',names:(c.info??[]).map(x=>x.name)});else if(c.infoType==='wolf_peers')await addLearned(uid,{type:'wolf_peers',names:(c.info??[]).map(x=>x.name)});else if(c.infoType==='mason_peers')await addLearned(uid,{type:'mason_peers',names:(c.info??[]).map(x=>x.name)});else if(c.infoType==='current_role')await addLearned(uid,{type:'current_role',role:c.info?.role});
    }else throw new Error('현재 사용할 수 없는 행동');
    n.done=n.done??{};n.done[n.currentPhase]=n.done[n.currentPhase]??{};if(complete)n.done[n.currentPhase][uid]=true;await set(ref(db,`rooms/${roomCode}/engine`),n);await remove(ref(db,`rooms/${roomCode}/intents/${uid}`));if(complete){await set(ref(db,`rooms/${roomCode}/private/${uid}/nightContext`),null);await maybeAdvancePhase()}
  }catch(err){console.error(err);await remove(ref(db,`rooms/${roomCode}/intents/${uid}`))}
}
async function maybeAdvancePhase(){const s=await hostSnap();if(s.meta?.phase!=='night'||!s.engine?.currentPhase)return;const phase=s.engine.currentPhase,aa=actors(s.engine,phase),d=s.engine.done?.[phase]??{};if(aa.every(u=>d[u]===true))await advancePhase(Number(s.engine.phaseIndex??-1)+1)}
async function intent(actionType,payload={}){if(!priv?.nightContext)return;await set(ref(db,`rooms/${roomCode}/intents/${me.uid}`),{id:rid('intent'),phase:priv.nightContext.phase,actionType,payload,createdAt:Date.now()});flash('행동을 전달했습니다.')}

function learnedHtml(){const a=Object.values(priv?.learned??{}).sort((x,y)=>(x.createdAt??0)-(y.createdAt??0));return a.length?`<div class="card"><h3 class="title">내가 확인한 정보</h3><div class="learned">${a.map(x=>`<div class="learned-item">${esc(learnedText(x))}</div>`).join('')}</div></div>`:''}
function renderNight(){const c=priv?.nightContext,r=priv?.initialRole,copy=priv?.copiedRole;app.innerHTML=header()+`<div class="card hero"><div class="eyebrow">처음 받은 직업</div>${cardMarkup(r)}${copy?`<div class="badge">🪞 복제: ${roleEmoji(copy)} ${esc(roleLabel(copy))}</div>`:''}</div>${learnedHtml()}${c?nightContextHtml(c):`<div class="card hero"><div class="role-icon">🌑</div><h2 class="title">밤입니다</h2><div class="muted">다른 직업이 행동 중입니다. 화면을 다른 사람에게 보여주지 마세요.</div></div>`}`;bindHeader();bindNight(c)}
function nightContextHtml(c){
  if(c.kind==='doppel_copy')return `<div class="card"><span class="badge">🌙 당신의 차례</span><div class="hero">${cardMarkup('doppelganger')}<div class="muted">복제할 다른 플레이어를 선택하세요.</div></div><div class="choice-list">${(c.targets??[]).map(p=>`<button class="choice" data-doppel="${p.uid}">${esc(p.name)}</button>`).join('')}</div></div>`;
  if(c.kind==='solo_wolf')return `<div class="card"><span class="badge">🌙 유일한 늑대인간</span><div class="hero">${cardMarkup('werewolf')}<div class="muted">중앙 카드 1장을 확인하세요.</div></div><div class="grid3">${[0,1,2].map(i=>`<button class="btn btn-ghost" data-wolfcenter="${i}">중앙 ${i+1}</button>`).join('')}</div></div>`;
  if(c.kind==='confirm'){let t='정보를 확인했습니다.';if(c.infoType==='wolves')t=`늑대인간: ${(c.info??[]).map(x=>x.name).join(', ')||'플레이어 중 없음'}`;if(c.infoType==='wolf_peers')t=`다른 늑대인간: ${(c.info??[]).map(x=>x.name).join(', ')||'없음'}`;if(c.infoType==='mason_peers')t=`다른 프리메이슨: ${(c.info??[]).map(x=>x.name).join(', ')||'플레이어 중 없음'}`;if(c.infoType==='current_role')t=`현재 내 카드: ${roleEmoji(c.info?.role)} ${roleLabel(c.info?.role)}`;return `<div class="card"><span class="badge">🌙 당신의 차례</span><div class="hero">${cardMarkup(c.asRole)}<div class="hint">${esc(t)}</div></div><button class="btn btn-primary btn-wide" id="confirmNight">확인 완료</button></div>`}
  if(c.kind==='seer')return `<div class="card"><span class="badge">🌙 예언자 행동</span><div class="hero">${cardMarkup('seer')}<div class="muted">다른 사람 1장 또는 중앙 카드 2장을 확인하세요.</div></div><div class="choice-list">${(c.targets??[]).map(p=>`<button class="choice" data-seerplayer="${p.uid}">${esc(p.name)}</button>`).join('')}</div><hr><div class="grid3"><button class="btn btn-ghost" data-seercenter="0,1">1 + 2</button><button class="btn btn-ghost" data-seercenter="0,2">1 + 3</button><button class="btn btn-ghost" data-seercenter="1,2">2 + 3</button></div></div>`;
  if(c.kind==='robber')return `<div class="card"><span class="badge">🌙 강도 행동</span><div class="hero">${cardMarkup('robber')}<div class="muted">한 사람과 교환하고 새 카드를 확인합니다.</div></div><div class="choice-list">${(c.targets??[]).map(p=>`<button class="choice" data-rob="${p.uid}">${esc(p.name)}</button>`).join('')}</div></div>`;
  if(c.kind==='troublemaker')return `<div class="card"><span class="badge">🌙 말썽쟁이 행동</span><div class="hero">${cardMarkup('troublemaker')}<div class="muted">자신을 제외한 두 사람을 선택하세요.</div></div><div class="choice-list">${(c.targets??[]).map(p=>`<button class="choice ${selected.includes(p.uid)?'selected':''}" data-trouble="${p.uid}">${esc(p.name)}</button>`).join('')}</div><button class="btn btn-primary btn-wide" style="margin-top:10px" id="troubleGo" ${selected.length!==2?'disabled':''}>두 카드 교환</button></div>`;
  if(c.kind==='drunk')return `<div class="card"><span class="badge">🌙 주정뱅이 행동</span><div class="hero">${cardMarkup('drunk')}<div class="muted">반드시 중앙 1장과 교환합니다. 새 카드는 보지 못합니다.</div></div><div class="grid3">${[0,1,2].map(i=>`<button class="btn btn-ghost" data-drunk="${i}">중앙 ${i+1}</button>`).join('')}</div></div>`;return `<div class="hint">행동 화면 준비 중</div>`
}
function bindNight(c){if(!c)return;document.querySelectorAll('[data-doppel]').forEach(b=>b.onclick=()=>intent('doppel_copy',{targetUid:b.dataset.doppel}));document.querySelectorAll('[data-wolfcenter]').forEach(b=>b.onclick=()=>intent('wolf_center',{centerIndex:Number(b.dataset.wolfcenter)}));const cf=document.getElementById('confirmNight');if(cf)cf.onclick=()=>intent('confirm');document.querySelectorAll('[data-seerplayer]').forEach(b=>b.onclick=()=>intent('seer_player',{targetUid:b.dataset.seerplayer}));document.querySelectorAll('[data-seercenter]').forEach(b=>b.onclick=()=>intent('seer_center',{centerIndexes:b.dataset.seercenter.split(',').map(Number)}));document.querySelectorAll('[data-rob]').forEach(b=>b.onclick=()=>intent('rob',{targetUid:b.dataset.rob}));document.querySelectorAll('[data-trouble]').forEach(b=>b.onclick=()=>{const u=b.dataset.trouble;selected=selected.includes(u)?selected.filter(x=>x!==u):selected.length<2?[...selected,u]:[selected[1],u];renderNight()});const tg=document.getElementById('troubleGo');if(tg)tg.onclick=()=>{if(selected.length===2){intent('swap_two',{targetA:selected[0],targetB:selected[1]});selected=[]}};document.querySelectorAll('[data-drunk]').forEach(b=>b.onclick=()=>intent('swap_center',{centerIndex:Number(b.dataset.drunk)}))}

const left=()=>Math.max(0,Math.ceil(((pub?.discussionEndsAt??0)-Date.now())/1000));const timeText=()=>`${String(Math.floor(left()/60)).padStart(2,'0')}:${String(left()%60).padStart(2,'0')}`;
function renderDay(){app.innerHTML=header()+`<div class="card hero"><div class="role-icon">☀️</div><h2 class="title">아침이 밝았습니다</h2><div class="timer" id="timer">${timeText()}</div><div class="muted">카드를 다시 확인하지 말고 토론하세요.</div></div><div class="card hero"><div class="eyebrow">처음 받은 직업</div>${cardMarkup(priv?.initialRole)}</div>${learnedHtml()}${isHost()?`<div class="sticky"><button class="btn btn-danger btn-wide" id="startVote">🗳️ 투표 시작</button></div>`:`<div class="hint">방장이 투표를 시작할 때까지 토론하세요.</div>`}`;bindHeader();const b=document.getElementById('startVote');if(b)b.onclick=startVoting;if(!timerHandle)timerHandle=setInterval(()=>{const t=document.getElementById('timer');if(t)t.textContent=timeText()},500)}
async function startVoting(){await update(ref(db,`rooms/${roomCode}`),{'meta/phase':'voting','public/phase':'voting','public/updatedAt':Date.now(),'votes':null})}
function renderVoting(){const list=players().filter(p=>p.uid!==me.uid);app.innerHTML=header()+`<div class="card"><h2 class="title">🗳️ 최종 투표</h2><div class="muted" style="margin-bottom:12px">자신을 제외한 한 명에게 투표하세요. 전원이 투표하면 결과가 공개됩니다.</div><div class="choice-list">${list.map(p=>`<button class="choice ${myVote===p.uid?'selected':''}" data-vote="${p.uid}" ${myVote?'disabled':''}>${esc(p.name)} ${myVote===p.uid?'✓':''}</button>`).join('')}</div></div>${myVote?`<div class="hint">투표 완료. 다른 플레이어를 기다리는 중입니다.</div>`:''}`;bindHeader();document.querySelectorAll('[data-vote]').forEach(b=>b.onclick=()=>set(ref(db,`rooms/${roomCode}/votes/${me.uid}`),b.dataset.vote))}

async function maybeResolve(){if(!isHost())return;const s=await hostSnap();if(s.meta?.phase!=='voting'||!s.engine)return;const list=pentries(s.members),votes=s.votes??{};if(Object.keys(votes).length<list.length)return;if(list.some(p=>!votes[p.uid]||votes[p.uid]===p.uid||!s.members[votes[p.uid]]))return;await resolveGame(s,list,votes)}
async function resolveGame(s,list,votes){
  const e=s.engine,c={};for(const t of Object.values(votes))c[t]=(c[t]??0)+1;const max=Math.max(0,...Object.values(c).map(Number)),dead=new Set();if(max>1)for(const [u,n] of Object.entries(c))if(Number(n)===max)dead.add(u);
  const final={};for(const p of list)final[p.uid]=roleOf(currentCard(e,p.uid));let changed=true;while(changed){changed=false;for(const u of [...dead])if(final[u]==='hunter'){const t=votes[u];if(t&&!dead.has(t)){dead.add(t);changed=true}}}
  const wolves=list.filter(p=>final[p.uid]==='werewolf').map(p=>p.uid),minions=list.filter(p=>final[p.uid]==='minion').map(p=>p.uid),tanners=list.filter(p=>final[p.uid]==='tanner').map(p=>p.uid);const wolfDead=wolves.some(u=>dead.has(u)),tannerWinners=tanners.filter(u=>dead.has(u));let villageWin=false,werewolfWin=false;
  if(wolves.length){villageWin=wolfDead;werewolfWin=!wolfDead&&tanners.every(u=>!dead.has(u))}else{villageWin=dead.size===0;if(minions.length)werewolfWin=dead.size>0&&minions.some(u=>!dead.has(u))&&tanners.every(u=>!dead.has(u))}
  const out={resolvedAt:Date.now(),villageWin,werewolfWin,tannerWinners,dead:[...dead],players:list.map(p=>({uid:p.uid,name:p.name,role:final[p.uid],dead:dead.has(p.uid),voteTarget:votes[p.uid],voteCount:c[p.uid]??0})),centers:[0,1,2].map(i=>({index:i,role:roleOf(centerCard(e,i))}))};
  await update(ref(db,`rooms/${roomCode}`),{'result':out,'meta/phase':'result','public/phase':'result','public/updatedAt':Date.now()});
}
function resultName(uid){return result?.players?.find(p=>p.uid===uid)?.name??'없음'}
function renderResult(){if(!result){app.innerHTML=header()+`<div class="hint">결과 계산 중입니다.</div>`;bindHeader();return}const wins=[];if(result.villageWin)wins.push('🏘️ 마을 팀 승리');if(result.werewolfWin)wins.push('🐺 늑대 팀 승리');if(result.tannerWinners?.length)wins.push(`🪵 무두장이 승리: ${result.tannerWinners.map(resultName).join(', ')}`);if(!wins.length)wins.push('승자 없음');app.innerHTML=header()+`<div class="card hero"><div class="role-icon">🎭</div><div class="role-big">${wins.map(esc).join('<br>')}</div></div><div class="card"><h3 class="title">최종 카드 공개</h3>${(result.players??[]).map(p=>`<div class="result-row"><div><b>${esc(p.name)}</b><div class="muted">→ ${esc(resultName(p.voteTarget))} 투표 · ${p.voteCount??0}표 받음</div></div><div style="text-align:right"><b>${roleEmoji(p.role)} ${esc(roleLabel(p.role))}</b><div class="${p.dead?'dead':'alive'}">${p.dead?'사망':'생존'}</div></div></div>`).join('')}</div><div class="card"><h3 class="title">중앙 카드</h3><div class="grid3">${(result.centers??[]).map(c=>`<div class="center-card"><div class="muted">중앙 ${c.index+1}</div><div style="font-size:24px;margin:5px">${roleEmoji(c.role)}</div><b>${esc(roleLabel(c.role))}</b></div>`).join('')}</div></div>${isHost()?`<div class="sticky"><button class="btn btn-primary btn-wide" id="rematch">같은 멤버로 다시 하기</button></div>`:`<div class="hint">방장이 재경기를 시작할 수 있습니다.</div>`}`;bindHeader();const r=document.getElementById('rematch');if(r)r.onclick=resetLobby}
async function resetLobby(){await update(ref(db,`rooms/${roomCode}`),{'meta/phase':'lobby','public':{phase:'lobby',updatedAt:Date.now()},'engine':null,'private':null,'intents':null,'votes':null,'result':null});roleDraft=null;selected=[]}

window.addEventListener('unhandledrejection',(event)=>{
  console.error('Unhandled promise rejection:',event.reason);
  const message=event.reason?.message||String(event.reason||'알 수 없는 오류');
  flash(`오류: ${message}`,'error');
});

window.addEventListener('error',(event)=>{
  console.error('Global error:',event.error||event.message);
});

boot();
