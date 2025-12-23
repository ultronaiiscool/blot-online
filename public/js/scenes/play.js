import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { sendWS } from "../core/ws.js";

function cardImg(cardId){ return `/assets/cards/${cardId}.svg`; }

export function mountPlay(root,{render}){
  const g = state.gameState;
  const room = state.roomState;
  if(!g){ state.phase="LOBBY"; return render(); }

  const youId = state.user.id;
  const yourTurn = g.turn === youId;
  const turnLockMs = Math.max(0, (g.turnUnlockUntil||0) - Date.now());
  const canPlayNow = !yourTurn ? false : (turnLockMs<=0);
  const lockSecs = Math.ceil(turnLockMs/1000);

  const players = g.players || [];
  const youIndex = players.findIndex(p=>p.id===youId);
  const teammateIndex = (youIndex>=0) ? (youIndex+2)%4 : -1;
  const isTeammate = (pid)=> players[teammateIndex]?.id === pid;
  const isOpponent = (pid)=> pid!==youId && !isTeammate(pid);

  const nameOf = (id)=>players.find(p=>p.id===id)?.name || id;

const trumpLabel = (()=> {
  if(g.mode === "NO_TRUMP") return t("noTrump") || "No Trump";
  if(g.mode === "ALL_TRUMP") return t("allTrump") || "All Trump";
  if(g.mode === "SUIT") return `${t("suitTrump") || "Suit Trump"} ${g.trump ? g.trump : ""}`.trim();
  return g.mode || "-";
})();

  const trickCards = (g.trick||[]).map(play=>`
    <div class="trickCard">
      <img src="${cardImg(play.card.id)}" alt="${play.card.id}"/>
      <div class="trickName">${nameOf(play.pid)}</div>
    </div>
  `).join("");

  const prev = new Set((state.prevHand||[]));
const hand = (g.yourHand||[]).map(c=>{
  const isNew = !prev.has(c.id);
  return `
    <button class="handCard ${isNew?'fly':''}" data-id="${c.id}" ${(canPlayNow)?"":"disabled"}>
      <img src="${cardImg(c.id)}" alt="${c.id}" loading="eager"/>
    </button>
  `;
}).join("");

  // detect trick completion for animation
  const prevTrick = state.prevTrick || [];
  const prevLeader = state._prevLeader;
  const trickJustEnded = (prevTrick.length===4 && (g.trick||[]).length===0 && g.leader && g.leader!==prevLeader);
  if(trickJustEnded){
    const winnerId = g.leader;
    state.trickAnim = { cards: prevTrick, winnerId, started: Date.now() };
  }

  root.innerHTML = `
    <div class="screen">
      <div class="panel felt wide">
        <div class="topRow">
          <div class="titleBlock">
            <div class="title">${t("play")}</div>
            <div class="sub">
              Room <span class="code">${room?.code||state.room}</span> ·
              <span class="pill">Stage: Taking</span> ·
              <span class="pill">Trump: <b>${trumpLabel}</b></span> ·
              <span class="pill">Contract: <b>${g.contract}</b> · x<b>${g.coincheLevel||1}</b></span>
            </div>
          </div>
          <div class="controls">
            <button class="chip" id="back">${t("backToLobby")}</button>
          </div>
        </div>

        <div class="scoreBar">
          <div class="scorePill a">${t("teamA")}: <b>${room?.scores?.A ?? 0}</b> (+${g.roundPoints?.A ?? 0}${g.melds?.A?` · meld ${g.melds.A}`:''})</div>
          <div class="scorePill b">${t("teamB")}: <b>${room?.scores?.B ?? 0}</b> (+${g.roundPoints?.B ?? 0}${g.melds?.B?` · meld ${g.melds.B}`:''})</div>
        </div>

        <div class="takingPanel">
  <div class="takingLine"><b>Taking Stage</b> · Trick <b>${(g.trickCount||0)+1}</b>/8 · Leader: <b>${nameOf(g.leader)}</b> · Turn: <b>${nameOf(g.turn)}</b></div>
  <div class="takingRule">Rule: follow suit if possible • if not, (Suit/All Trump) play trump if possible.</div>
  ${yourTurn && !canPlayNow ? `<div class="lockBanner">Wait <b>${lockSecs}</b>s before playing</div>` : ``}
</div>
<div class="gameGrid">
          <div class="scoreBox">
            <div class="scoreTitle">Seats</div>
            ${players.map((p,i)=>`
              <div class="scoreLine ${p.id===youId?"me":""}">
                <span>${i%2===0?"A":"B"} · ${p.name}${p.bot?" 🤖":""}</span>
                <span>${g.turn===p.id ? "▶" : ""}</span>
              </div>
            `).join("")}
          </div>

          <div class="teamPanel">
  <div class="teamBox teamA">Team A<br/>${[players[0],players[2]].filter(Boolean).map(p=>p.name).join(" · ")}</div>
  <div class="teamBox teamB">Team B<br/>${[players[1],players[3]].filter(Boolean).map(p=>p.name).join(" · ")}</div>
</div>

<div class="tableBox casino">
  <div class="turnHint ${yourTurn?"your":""}">${yourTurn ? t("yourTurn") : t("waiting")}</div>

  <div class="tableFelt">
              ${yourTurn && !canPlayNow ? `<div class="turnLockOverlay">Wait ${lockSecs}s</div>` : ``}
    <div class="seat north ${players[1]?.id===g.turn?'active':''} ${teammateIndex===1?'mate':''}">${players[1]?.name || "—"}</div>
    <div class="seat east ${players[2]?.id===g.turn?'active':''} ${teammateIndex===2?'mate':''}">${players[2]?.name || "—"}</div>
    <div class="seat south me ${players[0]?.id===g.turn?'active':''}">${players[0]?.name || "You"}</div>
    <div class="seat west ${players[3]?.id===g.turn?'active':''} ${teammateIndex===3?'mate':''}">${players[3]?.name || "—"}</div>

    <div class="deckStack" aria-hidden="true"></div>

    <div class="trickArea center">${trickCards || `<div class="emptyTrick">${t("play")}</div>`}</div>
  </div>

  <div class="smallNote">${t("mobileTip") || "Tip: tap a card to play. Swipe the hand left/right if needed."}</div>
</div>
        </div>

        <div class="handBar">${hand}</div>
      </div>
    </div>
  `;

  state.prevHand = (g.yourHand||[]).map(x=>x.id);


  // persist prev hand/trick
  state.prevHand = (g.yourHand||[]).map(x=>x.id);
  state.prevTrick = (g.trick||[]).slice();
  state._prevLeader = g.leader;

  // trick win animation overlay
  if(state.trickAnim){
    const anim = state.trickAnim;
    const wIndex = players.findIndex(p=>p.id===anim.winnerId);
    const seatClass = (wIndex===1) ? 'win-north' : (wIndex===2) ? 'win-east' : (wIndex===3) ? 'win-west' : 'win-south';

    const overlay = document.createElement('div');
    overlay.className = 'trickWinOverlay ' + seatClass;
    overlay.innerHTML =
      `<div class="trickWinStack">` +
      (anim.cards||[]).map(pl=>`<img class="trickWinCard" src="${cardImg(pl.card.id)}" alt="${pl.card.id}"/>`).join('') +
      `</div>`;
    document.body.appendChild(overlay);
    setTimeout(()=>{ overlay.classList.add('go'); }, 20);
    setTimeout(()=>{ overlay.remove(); }, 820);
    state.trickAnim = null;
  }
  }

  root.querySelector("#back").onclick = ()=>{ state.phase="LOBBY"; render(); };

  root.querySelectorAll(".handCard").forEach(btn=>{
    btn.onclick = ()=>{
      if(!yourTurn) return;
      sendWS({type:"game:play", cardId: btn.dataset.id});
    };
  });
}
