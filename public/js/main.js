import { state } from "./core/state.js";
import { ensureSocket } from "./core/ws.js";
import { mountMenu } from "./scenes/menu.js";
import { mountLobby } from "./scenes/lobby.js";
import { mountBidding } from "./scenes/bidding.js";
import { mountPlay } from "./scenes/play.js";

const root = document.getElementById("app");

let _renderScheduled = false;
let _pendingToast = null;

function toast(message, ms=2200){
  _pendingToast = {message, until: Date.now()+ms};
  scheduleRender();
}

export function scheduleRender(){
  if(_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(()=>{
    _renderScheduled = false;
    _render();
  });
}

function _render(){
  root.innerHTML = "";
  if(_pendingToast && Date.now() > _pendingToast.until) _pendingToast = null;

  // main view
  if(!state.user) mountMenu(root,{persist,render:scheduleRender});
  else if(state.phase==="MENU") mountMenu(root,{persist,render:scheduleRender});
  else if(state.phase==="LOBBY") mountLobby(root,{persist,render:scheduleRender});
  else if(state.phase==="BIDDING") mountBidding(root,{persist,render:scheduleRender});
  else mountPlay(root,{persist,render:scheduleRender});

  // toast overlay
  if(_pendingToast){
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = _pendingToast.message;
    document.body.appendChild(el);
    // remove any previous toasts
    document.querySelectorAll('.toast').forEach((t,i)=>{ if(i<document.querySelectorAll('.toast').length-1) t.remove();});
  } else {
    document.querySelectorAll('.toast').forEach(t=>t.remove());
  }
}


async function boot(){
  try{
    const r = await fetch("/me",{credentials:"include"});
    if(r.ok) state.user = (await r.json()).user;
  } catch {}
  ensureSocket(handle);
  scheduleRender();
}

function handle(msg){
  if(msg.type==="room:joined"){
    state.room = msg.code;
    state.phase = "LOBBY";
    scheduleRender();
  }
  if(msg.type==="room:state"){
    state.roomState = msg.room;
    if(msg.room.phase==="BIDDING") state.phase="BIDDING";
    if(msg.room.phase==="PLAY") state.phase="PLAY";
    scheduleRender();
  }
  if(msg.type==="bid:state"){
    state.bidState = msg.bid;
    state.phase="BIDDING";
    scheduleRender();
  }
  if(msg.type==="game:state"){
    state.gameState = msg.game;
    state.phase="PLAY";
    scheduleRender();
  }
  if(msg.type==="round:end"){
    // simple notification, then lobby view shows updated scores
    toast(`Round ended · A ${msg.scores.A} · B ${msg.scores.B} · Target ${msg.target}`);
    state.phase="LOBBY";
    scheduleRender();
  }
  if(msg.type==="error"){
    toast(msg.message || "Error");
  }
}

export function persist(){
  localStorage.setItem("lang", state.lang);
  localStorage.setItem("micAllowed", JSON.stringify(state.micAllowed));
  localStorage.setItem("muted", JSON.stringify(state.muted));
  localStorage.setItem("rulesDraft", JSON.stringify(state.rulesDraft));
}

export function render(){
  scheduleRender();
}

boot();
