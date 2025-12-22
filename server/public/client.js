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

const createRoomBtn = $("createRoomBtn");
const joinRoomBtn = $("joinRoomBtn");
const quickMatchBtn = $("quickMatchBtn");
const leaveBtn = $("leaveBtn");

let ws;
let myId = null;
let myName = localStorage.getItem("playerName") || "";
let lang = localStorage.getItem("lang") || "en";

nameInput.value = myName;
langSelect.value = lang;

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
}
applyLang();

let lastRoomState = null;

function connect(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener("open", () => {
    statusEl.textContent = "Connected.";
    send({ type:"hello", name: myName || "Guest" });
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
  send({ type:"room:quick" });
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

  // players
  playersEl.innerHTML = "";
  for (const p of lastRoomState.players){
    const chip = document.createElement("div");
    chip.className = "playerChip" + (p.id === myId ? " me" : "");
    chip.textContent = p.name + (p.id === myId ? " (you)" : "");
    playersEl.appendChild(chip);
  }

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
