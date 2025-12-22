import { I18N } from "./i18n.js";

const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const roomInfoEl = $("roomInfo");
const playersEl = $("players");
const handEl = $("hand");
const trickEl = $("trick");
const turnStatusEl = $("turnStatus");

const titleEl = $("title");
const lblName = $("lblName");
const lblRoom = $("lblRoom");
const playersTitle = $("playersTitle");

const nameInput = $("nameInput");
const roomCodeInput = $("roomCodeInput");
const langSelect = $("langSelect");

const subtitleText = $("subtitleText");
const botLevelSelect = $("botLevelSelect");
const shareWrap = $("shareWrap");
const shareTitle = $("shareTitle");
const shareLink = $("shareLink");
const copyLinkBtn = $("copyLinkBtn");
const toastEl = $("toast");
const googleSignInBtn = $("googleSignInBtn");
const googleSignOutBtn = $("googleSignOutBtn");


const createRoomBtn = $("createRoomBtn");
const joinRoomBtn = $("joinRoomBtn");
const quickMatchBtn = $("quickMatchBtn");
const leaveBtn = $("leaveBtn");

let ws;
let myId = null;
let playerToken = localStorage.getItem("playerToken");
if (!playerToken){ playerToken = Math.random().toString(16).slice(2)+Date.now().toString(16); localStorage.setItem("playerToken", playerToken); }
let googleProfile = null;
try { googleProfile = JSON.parse(localStorage.getItem("googleProfile")||"null"); } catch { googleProfile = null; }
let myName = localStorage.getItem("playerName") || "";
let lang = localStorage.getItem("lang") || "en";

nameInput.value = myName;
langSelect.value = lang;
if (botLevelSelect){ botLevelSelect.value = botLevel; }

nameInput.addEventListener("input", () => {
  myName = (nameInput.value || "").trim();
  localStorage.setItem("playerName", myName);
});

langSelect.addEventListener("change", () => {
  lang = langSelect.value;
  localStorage.setItem("lang", lang);
  applyLang();
  render(); // rerender UI labels
});

function t(key){
  return (I18N[lang] && I18N[lang][key]) ? I18N[lang][key] : key;
}

function applyLang(){
  titleEl.textContent = t("title");
  lblName.textContent = t("name");
  lblRoom.textContent = t("roomCode");
  createRoomBtn.textContent = t("createRoom");
  joinRoomBtn.textContent = t("joinRoom");
  quickMatchBtn.textContent = t("quickMatch");
  leaveBtn.textContent = t("leave");
  playersTitle.textContent = t("players");
  if (subtitleText) subtitleText.textContent = t("subtitle");
  const lblBots = $("lblBots"); if (lblBots) lblBots.textContent = t("botDifficulty");
  if (botLevelSelect){
    botLevelSelect.options[0].textContent = t("botOff");
    botLevelSelect.options[1].textContent = t("botEasy");
    botLevelSelect.options[2].textContent = t("botNormal");
    botLevelSelect.options[3].textContent = t("botHard");
  }
  if (googleSignInBtn) googleSignInBtn.textContent = t("signInGoogle");
  if (googleSignOutBtn) googleSignOutBtn.textContent = t("signOut");
  if (shareTitle) shareTitle.textContent = t("shareRoom");
  if (copyLinkBtn) copyLinkBtn.textContent = t("copyLink");
}
applyLang();

let lastRoomState = null;

function connect(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener("open", () => {
    statusEl.textContent = "Connected.";
    send({ type:"hello", name: myName || "Guest", token: playerToken, google: googleProfile });
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === "hello:ok"){
      myId = msg.id;
      statusEl.textContent = `Hello, ${msg.name}.`;
      return;
    }

    if (msg.type === "quick:queued"){
      statusEl.textContent = `${t("queued")} (#${msg.position})`;
      return;
    }

    if (msg.type === "auth:ok"){
      googleProfile = msg.profile;
      localStorage.setItem("googleProfile", JSON.stringify(googleProfile));
      // Update display name to Google name
      if (googleProfile?.name){
        myName = googleProfile.name;
        nameInput.value = myName;
        localStorage.setItem("playerName", myName);
      }
      setSignedInUI(googleProfile);
      return;
    }

    if (msg.type === "error"){
      statusEl.textContent = msg.message || "Error";
      return;
    }

    if (msg.type === "state:update"){
      lastRoomState = msg.room;
      render();
      return;
    }
  });

  ws.addEventListener("close", () => {
    statusEl.textContent = "Disconnected. Refresh to reconnect.";
  });
}

function send(obj){
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

createRoomBtn.addEventListener("click", () => {
  send({ type:"room:create" });
});

joinRoomBtn.addEventListener("click", () => {
  const code = (roomCodeInput.value || "").trim().toUpperCase();
  send({ type:"room:join", code });
});

quickMatchBtn.addEventListener("click", () => {
  send({ type:"room:quick", botLevel });
});

leaveBtn.addEventListener("click", () => {
  send({ type:"room:leave" });
  lastRoomState = null;
  render();
});

function render(){
  if (!lastRoomState){
    roomInfoEl.hidden = true;
    playersEl.innerHTML = "";
    handEl.innerHTML = "";
    trickEl.innerHTML = "";
    turnStatusEl.textContent = "—";
    return;
  }

  roomInfoEl.hidden = false;
  roomInfoEl.textContent = `Room: ${lastRoomState.code}`;

  if (shareWrap && shareLink){
    const url = `${location.origin}?room=${encodeURIComponent(lastRoomState.code)}`;
    shareLink.value = url;
    shareWrap.hidden = false;
  }

  // players
playersEl.innerHTML = "";
const gameTurnSeat = lastRoomState.game?.turn ?? -1;
lastRoomState.players.forEach((p, idx)=>{
  const chip = document.createElement("div");
  chip.className = "playerChip" + (p.id === myId ? " me" : "");
  if (idx === gameTurnSeat) chip.style.borderColor = "rgba(16,185,129,.65)";
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "8px";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  if (p.picture){
    avatar.style.backgroundImage = `url(${p.picture})`;
  } else {
    avatar.textContent = (p.name || "?").slice(0,1).toUpperCase();
  }
  const name = document.createElement("div");
  name.textContent = p.name + (p.isBot ? " [BOT]" : "") + (p.id === myId ? " (you)" : "");
  row.appendChild(avatar);
  row.appendChild(name);
  chip.appendChild(row);
  playersEl.appendChild(chip);
});


  const game = lastRoomState.game;
  if (!game){
    handEl.innerHTML = "<div class='status'>Waiting for 4 players…</div>";
    trickEl.innerHTML = "";
    turnStatusEl.textContent = "—";
    return;
  }

  const myHand = game.hands?.[myId] || [];
  const mySeat = lastRoomState.players.findIndex(p => p.id === myId);
  const isMyTurn = (mySeat === game.turn);

  turnStatusEl.textContent = isMyTurn ? t("yourTurn") : t("waitTurn");

  handEl.innerHTML = "";
  for (const card of myHand){
    const btn = document.createElement("button");
    btn.className = "cardBtn" + (isMyTurn ? " canPlay" : "");
    btn.textContent = card;
    btn.disabled = !isMyTurn;
    btn.addEventListener("click", () => send({ type:"game:play", card }));
    handEl.appendChild(btn);
  }

  trickEl.innerHTML = "";
  for (const x of (game.trick || [])){
    const div = document.createElement("div");
    div.className = "trickItem";
    const pname = lastRoomState.players[x.seat]?.name || "P?";
    div.textContent = `${pname}: ${x.card}`;
    trickEl.appendChild(div);
  }
}

connect();


// Google Sign-In placeholder (Step C)
const googleBtn = document.getElementById("googleSignInBtn");
if (googleBtn){
  googleBtn.onclick = () => alert("Google Sign-In will be added next step.");
}


function toast(msg, ms=1400){
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>{ toastEl.hidden = true; }, ms);
}

async function copyText(txt){
  try {
    await navigator.clipboard.writeText(txt);
    toast(t("copied"));
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(t("copied"));
  }
}

if (botLevelSelect){
  botLevelSelect.addEventListener("change", ()=>{
    botLevel = botLevelSelect.value;
    localStorage.setItem("botLevel", botLevel);
  });
}

if (copyLinkBtn){ copyLinkBtn.addEventListener('click', ()=> copyText(shareLink.value)); }

const params = new URLSearchParams(location.search);
const roomParam = params.get("room");
if (roomParam && roomCodeInput){
  roomCodeInput.value = roomParam.toUpperCase();
}


function setSignedInUI(profile){
  if (!googleSignInBtn || !googleSignOutBtn) return;
  const signedIn = !!profile;
  googleSignInBtn.hidden = signedIn;
  googleSignOutBtn.hidden = !signedIn;
  if (signedIn){
    toast(`${t("signedInAs")}: ${profile.name}`);
  }
}

function initGoogle(){
  const meta = document.querySelector('meta[name="google-client-id"]');
  const clientId = meta?.content;
  if (!clientId || clientId.includes("PUT_GOOGLE_CLIENT_ID_HERE")){
    // Not configured; keep button but show hint
    if (googleSignInBtn){
      googleSignInBtn.addEventListener("click", ()=> toast("Set Google Client ID in index.html meta tag (Step B)."));
    }
    return;
  }

  // GIS button render
  if (window.google?.accounts?.id){
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        // resp.credential is an ID token (JWT). Send to server for verification.
        send({ type:"auth:google", credential: resp.credential });
      }
    });

    // render button
    if (googleSignInBtn){
      google.accounts.id.renderButton(googleSignInBtn, { theme: "outline", size: "large", width: 240 });
    }
  }
}

if (googleSignOutBtn){
  googleSignOutBtn.addEventListener("click", ()=>{
    localStorage.removeItem("googleProfile");
    googleProfile = null;
    setSignedInUI(null);
    // Inform server
    send({ type:"auth:signout" });
  });
}

setSignedInUI(googleProfile);
initGoogle();
