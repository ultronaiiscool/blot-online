import { state } from "../core/state.js";
import { t } from "../core/i18n.js";

const MODES = [
  {id:"SUIT", key:"suitTrump"},
  {id:"NO_TRUMP", key:"noTrump"},
  {id:"ALL_TRUMP", key:"allTrump"}
];

const SUITS = [
  {id:"hearts", label:"♥"},
  {id:"diamonds", label:"♦"},
  {id:"clubs", label:"♣"},
  {id:"spades", label:"♠"}
];

function cardImg(cardId){ return `/assets/cards/${cardId}.svg`; }

export function mountBidding(root,{render}){
  const b = state.bidState;
  const room = state.roomState;
  const youId = state.user.id;

  const players = b?.seats || (room?.players||[]);
  const turnId = b?.turn;
  const yourTurn = turnId === youId;

  const highest = b?.highest;

  let selectedMode = "SUIT";

  const yourHand = (state.gameState?.yourHand) || []; // might be empty during bidding in this simplified client
  // We do not have hands until deal; show placeholder.
  root.innerHTML = `
    <div class="screen">
      <div class="panel felt wide">
        <div class="topRow">
          <div class="titleBlock">
            <div class="title">${t("bidding")}</div>
            <div class="sub">Room <span class="code">${room?.code||state.room}</span></div>
          </div>
          <div class="controls">
            <button class="chip" id="back">${t("backToLobby")}</button>
          </div>
        </div>

        <div class="bidStatus">
          <div><b>Turn:</b> ${players.find(p=>p.id===turnId)?.name || turnId}</div>
          <div><b>Highest:</b> ${
  highest ? (()=> {
    const who = players.find(p=>p.id===highest.pid)?.name || highest.pid;
    const modeLabel = highest.mode==="NO_TRUMP" ? "No Trump" : (highest.mode==="ALL_TRUMP" ? "All Trump" : "Suit Trump");
    const suitLabel = highest.mode==="SUIT" ? (highest.suit ? SUITS.find(s=>s.id===highest.suit)?.label : "Suit pending") : modeLabel;
    return `${who} · ${suitLabel} · ${highest.contract}`;
  })() : "None"
}</div>
        </div>

        <div class="bidActions">
          <button class="btn gold primary" id="pass" ${yourTurn?"":"disabled"}>${t("pass")}</button>

          <div class="contractRow">
            <div class="contractLabel">${t("contract")}</div>
            <input id="contract" class="contractInput" type="number" min="80" max="180" step="10" value="${(room?.target===301)?90:80}" ${yourTurn?"":"disabled"}/>
            <div class="contractHint">80–180 (step 10)</div>
          </div>

          <div class="modesRow">
            ${MODES.filter(m=>room?.rules?.allowModes?.includes(m.id) ?? true).map(m=>`<button class="modeBtn" data-mode="${m.id}" ${yourTurn?"":"disabled"}>${t(m.key)}</button>`).join("")}
          </div>

          <div class="suitsRow">
            ${SUITS.map(s=>`<button class="suitBtn" data-suit="${s.id}" ${yourTurn?"":"disabled"}>${s.label}</button>`).join("")}
          </div>
        </div>

        <div class="hint">Bidding: pick a mode, then (if Suit Trump) pick the suit. Coinche/Re-coinche if enabled.</div>

        <div class="coincheRow">
          <button class="btn ghost" id="coinche" ${(!yourTurn)?"disabled":""}>${t("coinche")}</button>
          <button class="btn ghost" id="recoinche" ${(!yourTurn)?"disabled":""}>${t("recoinche")}</button>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#coinche').onclick = ()=>{ state.socket.send(JSON.stringify({type:'bid:act', action:{type:'coinche'}})); };
  root.querySelector('#recoinche').onclick = ()=>{ state.socket.send(JSON.stringify({type:'bid:act', action:{type:'recoinche'}})); };

  root.querySelector("#back").onclick = ()=>{ state.phase="LOBBY"; render(); };

  root.querySelector("#pass").onclick = ()=>{
    state.socket.send(JSON.stringify({type:"bid:act", action:{type:"pass"}}));
  };

  root.querySelectorAll(".modeBtn").forEach(btn=>{
    btn.onclick = ()=>{
      selectedMode = btn.dataset.mode;
      root.querySelectorAll('.modeBtn').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      const suitBtns = root.querySelectorAll('.suitBtn');
      suitBtns.forEach(s=>s.disabled = !(yourTurn && selectedMode==='SUIT'));
    };
  });
  const firstMode = root.querySelector('.modeBtn');
  if(firstMode){ firstMode.classList.add('active'); }

  root.querySelectorAll(".suitBtn").forEach(btn=>{
    btn.onclick = ()=>{
      const suit = btn.dataset.suit;
      const contract = Number(root.querySelector('#contract').value || ((room?.target===301)?90:80));
      state.socket.send(JSON.stringify({type:"bid:act", action:{type:"bid", mode:selectedMode, suit, contract}}));
    };
  });
}
