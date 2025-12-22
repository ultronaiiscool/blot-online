import { I18N } from "./i18n.js";
const el = (id) => document.getElementById(id);
const roomsEl = el("rooms");
const roomPanel = el("roomPanel");
const roomIdEl = el("roomId");
const roomMetaEl = el("roomMeta");
const youEl = el("you");
const nameEl = el("name");
const saveNameBtn = el("saveName");

const qmTarget = el("qmTarget");
const qmTimer = el("qmTimer");
const quickMatchBtn = el("quickMatch");
const refreshBtn = el("refresh");
const createBtn = el("create");
const openJoinBtn = el("openJoin");

const readyBtn = el("ready");
const leaveBtn = el("leave");

const chatLog = el("chatLog");
const chatText = el("chatText");
const sendChat = el("sendChat");

const createDlg = el("createDlg");
const crTarget = el("crTarget");
const crTimer = el("crTimer");
const crPrivate = el("crPrivate");
const crPassword = el("crPassword");

const joinDlg = el("joinDlg");
const jrCode = el("jrCode");
const jrPassword = el("jrPassword");

const gameInfo = el("gameInfo");
const biddingPanel = el("bidding");
const trickPanel = el("trick");
const trickPlays = el("trickPlays");
const handCards = el("handCards");
const scoringLog = el("scoringLog");

const bidSuit = el("bidSuit");
const bidPoints = el("bidPoints");
const bidBtn = el("bidBtn");
const passBtn = el("passBtn");
const contraBtn = el("contraBtn");
const recontraBtn = el("recontraBtn");
const legalBtn = el("legalBtn");
const nextHandBtn = el("nextHandBtn");
const langSelect = el("langSelect");
const botLevel = el("botLevel");
const voicePanel = el("voicePanel");
const voiceList = el("voiceList");

const sortBtn = el("sortBtn");
const micBtn = el("micBtn");
const voicePanel = el("voicePanel");
const pTop = el("pTop");
const pLeft = el("pLeft");
const pRight = el("pRight");
const pBottom = el("pBottom");
const cTop = el("cTop");
const cLeft = el("cLeft");
const cRight = el("cRight");
const cBottom = el("cBottom");
const centerMeta = el("centerMeta");
const centerPile = el("centerPile");
const scoreDlg = el("scoreDlg");
const scoreBody = el("scoreBody");

let ws;
let you = null;
let currentRoom = null;
let readySet = new Set();
let gameState = null;
let lastBidLogLen = 0;
let playLock = false; // prevents double-tap spam on mobile
let lastLegal = [];
let sortEnabled = true;


let audioCtx = null;
function beep(freq=440, dur=0.06, type="sine", vol=0.04){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }catch{}
}
function sfx(event){
  if (event === "deal") beep(520,0.03,"triangle",0.03);
  if (event === "play") beep(420,0.04,"sine",0.04);
  if (event === "win") { beep(660,0.06,"triangle",0.04); setTimeout(()=>beep(880,0.06,"triangle",0.03),60); }
  if (event === "bid") beep(560,0.05,"square",0.02);
}


if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(()=>{});
}

function fmtTime(ts){
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function addMsg({from, text, ts}){
  const p = document.createElement("p");
  p.className = "msg";
  p.innerHTML = `<b>${escapeHtml(from.name)}</b><span>${fmtTime(ts)}</span><br>${escapeHtml(text)}`;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}
function addSystem(text){
  addMsg({ from:{name:"System"}, text, ts: Date.now() });
}


// Stable identity for reconnects
function makeToken(){
  try{
    if (crypto?.randomUUID) return crypto.randomUUID();
  }catch{}
  const arr = new Uint8Array(16);
  (crypto?.getRandomValues ? crypto.getRandomValues(arr) : arr.forEach((_,i)=>arr[i]=Math.floor(Math.random()*256)));
  return [...arr].map(b=>b.toString(16).padStart(2,"0")).join("");
}
let clientToken = localStorage.getItem("blot_token");
if (!clientToken){
  clientToken = makeToken();
  localStorage.setItem("blot_token", clientToken);
}

function send(obj){ if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

function connect(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener("message", (ev)=>{
    const msg = JSON.parse(ev.data);
    switch(msg.t){
      case "hello":
        // Server asks for auth on connect
        if (msg.needAuth){
          const desiredName = (localStorage.getItem("blot_name") || nameEl.value || "").trim().slice(0,24);
          send({ t:"auth:hello", token: clientToken, name: desiredName });
          break;
        }
        if (msg.you){
          you = msg.you;
          youEl.textContent = `You: ${you.name} (${you.id.slice(0,4)})`;
        }
        renderRooms(msg.rooms);
        break;
      case "auth:ok":
        you = msg.you;
        if (you?.token){
          clientToken = you.token;
          localStorage.setItem("blot_token", clientToken);
        }
        youEl.textContent = `You: ${you.name} (${you.id.slice(0,4)})`;
        if (msg.rooms) renderRooms(msg.rooms);
        break;
      case "rooms:list":
        renderRooms(msg.rooms);
        break;
      case "profile:ok": // legacy

        you = msg.you;
        youEl.textContent = `You: ${you.name} (${you.id.slice(0,4)})`;
        break;
      case "room:created":
        send({ t:"room:join", roomId: msg.room.id, password: msg.room.settings?.password || "" });
        break;
      case "room:join:ok":
        showRoom(msg.room);
        if (micEnabled) { rebuildVoicePeers(); renderVoicePanel(); }
        break;
      case "room:join:error":
        alert(msg.error);
        break;
      case "room:left":
        hideRoom();
        if (micEnabled) stopVoice();
        break;
      case "room:update":
        if (currentRoom && msg.room.id === currentRoom.id) showRoom(msg.room, true);
        send({ t:"rooms:list" });
        if (micEnabled) { rebuildVoicePeers(); renderVoicePanel(); }
        break;
      case "room:ready:update":
        readySet = new Set(msg.ready || []);
        updateReadyButton();
        paintSeats();
        break;
      case "chat:new":
        addMsg(msg.entry);
        break;
      case "game:state":
        const prevPhase = gameState?.phase;
        const prevLen = lastBidLogLen;
        gameState = msg.state;
        lastBidLogLen = gameState?.bidLog?.length || 0;
        if (prevPhase && prevPhase !== gameState.phase){
          if (gameState.phase === "bidding") sfx("deal");
        }
        if ((gameState?.bidLog?.length || 0) > prevLen) sfx("bid");
        playLock = false;
        renderGame();
        break;
      case "game:error":
        addSystem(msg.error || "Game error");
        break;
      case "hand:scored":
        // show modal breakdown
        if (scoreBody){
          const b = msg.breakdown;
          const suit = b.trumpSuit ? suitGlyph(b.trumpSuit) : "—";
          const lines = [];
          lines.push(`Trump: ${suit}`);
          lines.push(`Contract: ${JSON.stringify(b.contract)} (Team ${b.declarerTeam===0?"A":"B"})`);
          lines.push(`Contra: x${b.contra}`);
          lines.push(`Tricks won: ${b.tricksCount[0]}-${b.tricksCount[1]}`);
          lines.push(`Melds: ${b.melds.team0.points}-${b.melds.team1.points}`);
          lines.push(`Raw points: ${b.teamPointsRaw[0]}-${b.teamPointsRaw[1]}`);
          lines.push(`Awarded: ${b.awarded[0]}-${b.awarded[1]}`);
          lines.push(`Totals: ${msg.totals[0]}-${msg.totals[1]}`);
          scoreBody.textContent = lines.join("\n");
          scoreDlg?.showModal?.();
          sfx("win");
        }

        scoringLog.textContent += `\n[Hand scored] trump=${msg.breakdown.trumpSuit} contra=x${msg.breakdown.contra}\n` +
          `contract=${JSON.stringify(msg.breakdown.contract)} declarerTeam=${msg.breakdown.declarerTeam}\n` +
          `tricks=${msg.breakdown.tricksCount.join("-")} melds=${msg.breakdown.melds.team0.points}-${msg.breakdown.melds.team1.points}\n` +
          `raw=${msg.breakdown.teamPointsRaw.join("-")} awarded=${msg.breakdown.awarded.join("-")} totals=${msg.totals.join("-")}\n`;
        break;
      case "voice:offer": {
        if (!micEnabled) break;
        const from = msg.from;
        if (!from || from === you?.id) break;
        ensurePeer(from).then(async (pc)=>{
          try{
            await pc.setRemoteDescription(msg.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ t:"voice:answer", to: from, answer: pc.localDescription });
          }catch{}
        });
        break;
      }
      case "voice:answer": {
        if (!micEnabled) break;
        const from = msg.from;
        const pc = peers.get(from);
        if (pc){
          try{ pc.setRemoteDescription(msg.answer); }catch{}
        }
        break;
      }
      case "voice:ice": {
        if (!micEnabled) break;
        const from = msg.from;
        const pc = peers.get(from);
        if (pc && msg.candidate){
          try{ pc.addIceCandidate(msg.candidate); }catch{}
        }
        break;
      }

      default:
        // ignore
        break;
    }
  });

  ws.addEventListener("close", ()=> addSystem("Disconnected. Refresh to reconnect."));
}

function renderRooms(rooms){
  roomsEl.innerHTML = "";
  if (!rooms || rooms.length === 0){
    roomsEl.innerHTML = `<div class="hint">No public rooms yet. Create one or Quick Match.</div>`;
    return;
  }
  for (const r of rooms){
    const seated = r.seats.filter(Boolean).length;
    const div = document.createElement("div");
    div.className = "room";
    div.innerHTML = `
      <div>
        <div><code>${r.id}</code> <small>(${seated}/4 players)</small></div>
        <small>Target ${r.settings.targetScore} • ${r.settings.turnSeconds}s • ${r.phase}</small>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="primary">Join</button>
      </div>
    `;
    div.querySelector("button").addEventListener("click", ()=>{
      jrCode.value = r.id;
      jrPassword.value = "";
      joinDlg.showModal();
    });
    roomsEl.appendChild(div);
  }
}

function showRoom(room, keepChat=false){
  currentRoom = room;
  roomPanel.hidden = false;
  roomIdEl.textContent = room.id;

  const seated = room.seats.filter(Boolean).length;
  roomMetaEl.textContent = `Target ${room.settings.targetScore} • ${room.settings.turnSeconds}s turns • ${seated}/4 seated • spectators ${room.spectators} • phase ${room.phase}`;

  if (!keepChat) chatLog.innerHTML = "";
  paintSeats();
  updateReadyButton();
}

function hideRoom(){
  currentRoom = null;
  readySet = new Set();
  roomPanel.hidden = true;
  roomIdEl.textContent = "";
  roomMetaEl.textContent = "";
  chatLog.innerHTML = "";
  gameState = null;
  lastLegal = [];
  renderGame();
}

function paintSeats(){
  if (!currentRoom) return;
  document.querySelectorAll(".seat").forEach((s)=>{
    const idx = Number(s.dataset.seat);
    const p = currentRoom.seats[idx];
    if (!p){
      s.innerHTML = `<div class="t">Seat ${idx+1}</div><div class="n">(empty)</div>`;
      return;
    }
    const isReady = readySet.has(p.id);
    const team = (idx===0 || idx===2) ? "Team A" : "Team B";
    s.innerHTML = `<div class="t">${team} • Seat ${idx+1} ${isReady ? "• ✅ ready" : ""}</div><div class="n">${escapeHtml(p.name)} <span style="color:var(--muted);font-weight:400">(${p.id.slice(0,4)})</span></div>`;
  });
}

function updateReadyButton(){
  if (!you || !currentRoom) return;
  // enable if seated
  const seated = currentRoom.seats.some(p => p && p.id === you.id);
  if (!seated){
    readyBtn.disabled = true;
    readyBtn.textContent = "Spectating";
    return;
  }
  readyBtn.disabled = false;
  const isReady = readySet.has(you.id);
  readyBtn.textContent = isReady ? "Unready" : "Ready";
}

function suitGlyph(s){
  return ({S:"♠",H:"♥",D:"♦",C:"♣"}[s] || s);
}
function prettyCard(id){
  // "10H" -> "10♥"
  const suit = id.slice(-1);
  const rank = id.slice(0,-1);
  return `${rank}${suitGlyph(suit)}`;
}


function cardSuit(id){ return id.slice(-1); }
function cardRank(id){ return id.slice(0,-1); }
const TRUMP_ORDER = ["J","9","A","10","K","Q","8","7"];
const PLAIN_ORDER = ["A","10","K","Q","J","9","8","7"];
const SUIT_ORDER = ["S","H","D","C"];

function sortHandCards(cards, trumpSuit){
  const t = trumpSuit || "S";
  return [...cards].sort((a,b)=>{
    const sa = cardSuit(a), sb = cardSuit(b);
    const ra = cardRank(a), rb = cardRank(b);
    // suit grouping: trump first, then suit order
    const ga = (sa === t) ? -1 : SUIT_ORDER.indexOf(sa);
    const gb = (sb === t) ? -1 : SUIT_ORDER.indexOf(sb);
    if (ga !== gb) return ga - gb;
    const oa = (sa === t) ? TRUMP_ORDER : PLAIN_ORDER;
    const ob = (sb === t) ? TRUMP_ORDER : PLAIN_ORDER;
    return oa.indexOf(ra) - ob.indexOf(rb);
  });
}

function seatName(state, seat){
  return state.seats?.[seat]?.name || `Seat ${seat+1}`;
}


function applyI18n(){
  const q = el("quickMatchBtn"); if (q) q.textContent = t("quickMatch");
  const cr = el("createRoomBtn"); if (cr) cr.textContent = t("createRoom");
  const jr = el("joinRoomBtn"); if (jr) jr.textContent = t("joinRoom");
  const nm = el("nameLabel"); if (nm) nm.textContent = t("yourName");
  const rc = el("roomLabel"); if (rc) rc.textContent = t("roomCode");
  const tg = el("targetLabel"); if (tg) tg.textContent = t("targetScore");
  if (sortBtn) sortBtn.textContent = t("sortHand");
  if (legalBtn) legalBtn.textContent = t("legalPlays");
  if (nextHandBtn) nextHandBtn.textContent = t("nextHand");
  const micBtn = el("micBtn"); if (micBtn) micBtn.textContent = micEnabled ? t("micOn") : `🎤 ${t("mic")}`;
  const botsLbl = document.querySelector('label[for="botLevel"]'); if (botsLbl) botsLbl.textContent = t("bots");
  const dlgTitle = document.querySelector("#scoreDlg h3"); if (dlgTitle) dlgTitle.textContent = t("handScored");
  const dlgOk = document.querySelector("#scoreDlg .primary"); if (dlgOk) dlgOk.textContent = t("ok");
}

function renderGame(){
  applyI18n();
  if (!gameState || !you){
    biddingPanel.hidden = true;
    trickPanel.hidden = true;
    gameInfo.textContent = "No game yet. Ready up with 4 players.";
    return;
  }

  const me = you.id;
  const mySeat = gameState.seats.findIndex(p => p && p.id === me);
  const isMyTurn = (mySeat === gameState.turnSeat);

  const phase = gameState.phase;
  const trump = gameState.trumpSuit ? suitGlyph(gameState.trumpSuit) : "—";
  const totals = gameState.totals ? `${gameState.totals[0]}-${gameState.totals[1]}` : "0-0";
  const contract = gameState.contract ? JSON.stringify(gameState.contract) : "—";
  const contra = `x${gameState.contra || 1}`;

  let bidLine = "";
  if (gameState.bidLog?.length){
    const last = gameState.bidLog.slice(-6).map(x=>{
      const nm = seatName(gameState, x.seat);
      if (x.action === "pass") return `${nm}: pass`;
      if (x.action === "contra") return `${nm}: contra`;
      if (x.action === "recontra") return `${nm}: recontra`;
      if (x.action === "bid"){
        const b = x.bid;
        const s = suitGlyph(b.suit);
        return `${nm}: ${b.type==="capot"?"capot":b.bid}${s}`;
      }
      return `${nm}: ${x.action}`;
    }).join(" • ");
    bidLine = ` • bids: ${last}`;
  }

  gameInfo.textContent = `phase=${phase} • trump=${trump} • contract=${contract} • contra=${contra} • totals=${totals} • turnSeat=${gameState.turnSeat+1} ${isMyTurn ? "(your turn)" : ""}`;

  // panels
  biddingPanel.hidden = !(phase === "bidding");
  trickPanel.hidden = !(phase === "trick" || phase === "scoring" || phase === "finished" || phase === "lobby" || phase === "declarations");

  // Bidding controls
  if (phase === "bidding"){
    bidBtn.disabled = !isMyTurn;
    passBtn.disabled = !isMyTurn;
    contraBtn.disabled = !gameState.bidding?.highestBid || (mySeat === -1) || !isMyTurn; // allow only on turn for simplicity
    recontraBtn.disabled = true;
  } else {
    bidBtn.disabled = true;
    passBtn.disabled = true;
    contraBtn.disabled = true;
    recontraBtn.disabled = true;
  }

  // Trick display
  if (!trickPanel.hidden){
    // trick plays
    trickPlays.innerHTML = "";
    if (gameState.trick && gameState.trick.plays){
      for (const p of gameState.trick.plays){
        const name = gameState.seats[p.seat]?.name || `Seat ${p.seat+1}`;
        const div = document.createElement("div");
        div.className = "pill";
        div.innerHTML = `<img class="miniCard" src="/assets/cards/${p.card}.svg" alt="${prettyCard(p.card)}" /> <span>${escapeHtml(name)}: ${prettyCard(p.card)}</span>`;
        trickPlays.appendChild(div);
      }
    } else {
      trickPlays.innerHTML = `<div class="hint">No trick yet.</div>`;
    }

    // hand cards (textured)
    handCards.innerHTML = "";
    const myHand = gameState.hands?.[me]?.cards || [];
    for (const c of myHand){
      const wrap = document.createElement("div");
      wrap.className = "cardWrap";
      if (lastLegal.includes(c)) wrap.classList.add("legal");

      const btn = document.createElement("button");
      btn.className = "cardArt";
      btn.setAttribute("aria-label", `Play ${prettyCard(c)}`);
      btn.style.backgroundImage = `url(/assets/cards/${c}.svg)`;
      btn.disabled = !(phase === "trick" && isMyTurn);
      btn.addEventListener("click", ()=>{
        send({ t:"game:play", card: c });
      });

      wrap.appendChild(btn);
      handCards.appendChild(wrap);
    }
legalBtn.disabled = !(phase === "trick" && isMyTurn);
    nextHandBtn.disabled = !(phase === "lobby" || phase === "finished");
  }
  renderVoice();
}

// UI events
saveNameBtn.addEventListener("click", ()=>{
  const n = nameEl.value.trim();
  if (n) send({ t:"profile:set", name: n });
});

quickMatchBtn.addEventListener("click", ()=>{
  send({ t:"match:quick", targetScore:Number(qmTarget.value), turnSeconds:Number(qmTimer.value) });
});

refreshBtn.addEventListener("click", ()=> send({ t:"rooms:list" }));

createBtn.addEventListener("click", ()=>{
  crPassword.disabled = !crPrivate.checked;
  createDlg.showModal();
});
crPrivate.addEventListener("change", ()=> crPassword.disabled = !crPrivate.checked);

el("crSubmit").addEventListener("click", ()=>{
  send({
    t:"room:create",
    targetScore:Number(crTarget.value),
    turnSeconds:Number(crTimer.value),
    isPrivate:crPrivate.checked,
    password: crPrivate.checked ? (crPassword.value || "") : ""
  });
});

openJoinBtn.addEventListener("click", ()=>{
  jrCode.value = "";
  jrPassword.value = "";
  joinDlg.showModal();
});

el("jrSubmit").addEventListener("click", ()=>{
  const code = jrCode.value.trim().toUpperCase();
  send({ t:"room:join", roomId: code, password: jrPassword.value || "" });
});

readyBtn.addEventListener("click", ()=>{
  if (!you || !currentRoom) return;
  const isReady = readySet.has(you.id);
  send({ t:"room:ready", ready: !isReady });
});

leaveBtn.addEventListener("click", ()=> send({ t:"room:leave" }) );

sendChat.addEventListener("click", ()=>{
  const text = chatText.value.trim();
  if (!text) return;
  send({ t:"chat:send", text });
  chatText.value = "";
});
chatText.addEventListener("keydown", (e)=>{
  if (e.key === "Enter") sendChat.click();
});

bidBtn.addEventListener("click", ()=>{
  send({ t:"game:bid", type:"points", suit: bidSuit.value, bid: Number(bidPoints.value) });
});
passBtn.addEventListener("click", ()=> send({ t:"game:pass" }) );
contraBtn.addEventListener("click", ()=> send({ t:"game:contra" }) );
recontraBtn.addEventListener("click", ()=> send({ t:"game:recontra" }) );

legalBtn.addEventListener("click", ()=>{
  lastLegal = [];
  send({ t:"game:legal" });
});
ws = null;

// intercept legal response
function connectAndHook(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener("message", (ev)=>{
    const msg = JSON.parse(ev.data);
    if (msg.t === "game:legal"){
      lastLegal = msg.legal || [];
      renderGame();
    }
  });
  // but we need the normal listener too:
  ws.addEventListener("message", (ev)=>{
    const msg = JSON.parse(ev.data);
    // dispatch to main switch by re-calling handler
  });
}
/* Instead of double listeners chaos, we just handle in one connect(). */

// -------------------- Voice chat (WebRTC) --------------------
let micEnabled = false;
let localStream = null;
const peers = new Map(); // peerId -> RTCPeerConnection
const remoteAudios = new Map(); // peerId -> HTMLAudioElement

// iOS/Safari needs a user gesture to start audio context; we already have button clicks.
document.body.addEventListener("click", ()=>{ try{ audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)(); }catch{} }, { once:true });

async function startVoice(){
  if (micEnabled) return;
  micEnabled = true;
  micBtn && (micBtn.textContent = "🔊 Mic ON");

  try{
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
    });
  }catch(e){
    micEnabled = false;
    micBtn && (micBtn.textContent = "🎤 Mic");
    addSystem("Mic permission denied.");
    return;
  }

  rebuildVoicePeers();
  renderVoicePanel();
}

function stopVoice(){
  micEnabled = false;
  micBtn && (micBtn.textContent = "🎤 Mic");
  for (const [id, pc] of peers.entries()){
    try{ pc.close(); }catch{}
  }
  peers.clear();
  for (const [id, el] of remoteAudios.entries()){
    try{ el.srcObject = null; el.remove(); }catch{}
  }
  remoteAudios.clear();
  if (localStream){
    for (const t of localStream.getTracks()) try{ t.stop(); }catch{}
    localStream = null;
  }
  renderVoicePanel();
}

function rtcConfig(){
  // Public STUN so peers can connect through NAT. No server needed for basic voice.
  return { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };
}

async function ensurePeer(peerId){
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection(rtcConfig());

  if (localStream){
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  }

  pc.onicecandidate = (e)=>{
    if (e.candidate){
      send({ t:"voice:ice", to: peerId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e)=>{
    if (remoteAudios.has(peerId)) return;
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = e.streams[0];
    audio.dataset.peerId = peerId;
    document.body.appendChild(audio);
    remoteAudios.set(peerId, audio);
  };

  peers.set(peerId, pc);
  return pc;
}

function seatedPlayerIds(){
  if (!currentRoom?.seats) return [];
  return currentRoom.seats.filter(Boolean).map(s => s.id);
}

async function rebuildVoicePeers(){
  if (!micEnabled || !you?.id) return;
  // Only connect to other seated players
  const ids = seatedPlayerIds().filter(id => id !== you.id);
  // Close peers no longer needed
  for (const id of peers.keys()){
    if (!ids.includes(id)){
      try{ peers.get(id).close(); }catch{}
      peers.delete(id);
    }
  }

  for (const otherId of ids){
    const pc = await ensurePeer(otherId);
    // choose initiator to avoid offer glare (stable string compare)
    const initiator = String(you.id) < String(otherId);
    if (initiator){
      try{
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ t:"voice:offer", to: otherId, offer: pc.localDescription });
      }catch{}
    }
  }
}

function renderVoicePanel(){
  if (!voicePanel) return;
  voicePanel.innerHTML = "";
  if (!currentRoom) return;

  const ids = seatedPlayerIds();
  if (!ids.length) return;

  const title = document.createElement("div");
  title.className = "voiceTitle";
  title.textContent = "Voice";
  voicePanel.appendChild(title);

  for (const id of ids){
    const row = document.createElement("div");
    row.className = "voiceRow";
    const name = currentRoom.seats.find(s=>s?.id===id)?.name || id.slice(0,4);
    const label = document.createElement("span");
    label.textContent = (id===you?.id) ? `${name} (you)` : name;

    const btn = document.createElement("button");
    btn.className = "muteBtn";
    if (id === you?.id){
      btn.textContent = micEnabled ? "Mute me" : "Mic off";
      btn.disabled = !micEnabled;
      btn.addEventListener("click", ()=>{
        if (!localStream) return;
        const enabled = localStream.getAudioTracks().some(t=>t.enabled);
        for (const t of localStream.getAudioTracks()) t.enabled = !enabled;
        btn.textContent = enabled ? "Unmute me" : "Mute me";
      });
    } else {
      const audio = remoteAudios.get(id);
      const muted = audio ? audio.muted : false;
      btn.textContent = muted ? "Unmute" : "Mute";
      btn.addEventListener("click", ()=>{
        const a = remoteAudios.get(id);
        if (a){ a.muted = !a.muted; }
        btn.textContent = (a && a.muted) ? "Unmute" : "Mute";
      });
    }

    row.appendChild(label);
    row.appendChild(btn);
    voicePanel.appendChild(row);
  }
}

micBtn?.addEventListener("click", ()=>{
  if (!micEnabled) startVoice();
  else stopVoice();
});

connect();

// Patch: add handling for game:legal in the active ws
ws.addEventListener("message", (ev)=>{
  const msg = JSON.parse(ev.data);
  if (msg.t === "game:legal"){
    lastLegal = msg.legal || [];
    renderGame();
  }
});

nextHandBtn.addEventListener("click", ()=> send({ t:"game:next" }) );


sortBtn?.addEventListener("click", ()=>{
  sortEnabled = !sortEnabled;
  addSystem(`Sort hand: ${sortEnabled ? "ON" : "OFF"}`);
  renderGame();
});


function applyPeerMute(seat){
  const el = peerAudioEls[seat];
  if (el) el.muted = !!mutedPeers[seat];
}

applyI18n();


if (langSelect){
  langSelect.value = lang;
  langSelect.addEventListener("change", ()=> setLang(langSelect.value));
}


// name persistence
const nameInput = el("nameInput") || el("name") || document.querySelector("input[name='name']");
let playerName = localStorage.getItem("playerName") || "";
if (nameInput){
  if (!nameInput.value) nameInput.value = playerName;
  nameInput.addEventListener("input", ()=>{
    playerName = (nameInput.value || "").trim();
    localStorage.setItem("playerName", playerName);
  });
}


// stable token for reconnect
let playerToken = localStorage.getItem("playerToken");
if (!playerToken){
  playerToken = Math.random().toString(16).slice(2) + Date.now().toString(16);
  localStorage.setItem("playerToken", playerToken);
}


function sendHello(){
  send({ t:"hello", name: (playerName || "Guest"), token: playerToken });
}
