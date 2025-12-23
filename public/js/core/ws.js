import { state } from "./state.js";

let backoffMs = 400;
let reconnectTimer = null;

function scheduleReconnect(onMessage){
  if(reconnectTimer) return;
  reconnectTimer = setTimeout(()=>{
    reconnectTimer = null;
    ensureSocket(onMessage, true);
  }, backoffMs);
  backoffMs = Math.min(8000, Math.floor(backoffMs * 1.6));
}

export function sendWS(payload){
  // payload can be object or string
  const msg = (typeof payload === "string") ? payload : JSON.stringify(payload);
  state.wsQueue = state.wsQueue || [];
  if(!state.socket || state.socket.readyState !== 1){
    state.wsQueue.push(msg);
    // try to connect if not already
    ensureSocket(()=>{});
    return;
  }
  try{ state.socket.send(msg); } catch { state.wsQueue.push(msg); }
}

export function ensureSocket(onMessage, force=false){
  if(!force && state.socket && (state.socket.readyState===0 || state.socket.readyState===1)) return;

  const proto = location.protocol==="https:" ? "wss":"ws";
  const wsUrl = `${proto}://${location.host}`;
  try{
    state.socket = new WebSocket(wsUrl);
  } catch {
    scheduleReconnect(onMessage);
    return;
  }

  state.socket.onopen = ()=>{
    // flush queued messages
    try{
      const q = state.wsQueue || [];
      state.wsQueue = [];
      for(const m of q) state.socket.send(m);
    } catch {}

    backoffMs = 400;
    if(state.user){
      state.socket.send(JSON.stringify({type:"init", id:state.user.id, name:state.user.name}));
    }
  };

  state.socket.onmessage = (e)=>{
    try{ onMessage(JSON.parse(e.data)); } catch {}
  };

  state.socket.onclose = ()=>{
    scheduleReconnect(onMessage);
  };

  state.socket.onerror = ()=>{
    try{ state.socket.close(); } catch {}
  };
}

document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState==="visible"){
    // iOS may kill background sockets
    if(state.user) scheduleReconnect((m)=>{});
  }
});
