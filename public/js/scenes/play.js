import { state } from "../core/state.js";
import { t } from "../core/i18n.js";

function cardImg(cardId){ return `/assets/cards/${cardId}.svg`; }

export function mountPlay(root,{render}){
  const g = state.gameState;
  const room = state.roomState;
  if(!g){ state.phase="LOBBY"; return render(); }

  const youId = state.user.id;
  const yourTurn = g.turn === youId;

  const players = g.players || [];
  const nameOf = (id)=>players.find(p=>p.id===id)?.name || id;

  const trickCards = (g.trick||[]).map(play=>`
    <div class="trickCard">
      <img src="${cardImg(play.card.id)}" alt="${play.card.id}"/>
      <div class="trickName">${nameOf(play.pid)}</div>
    </div>
  `).join("");

  const hand = (g.yourHand||[]).map(c=>`
    <button class="handCard" data-id="${c.id}" ${yourTurn?"":"disabled"}>
      <img src="${cardImg(c.id)}" alt="${c.id}"/>
    </button>
  `).join("");

  root.innerHTML = `
    <div class="screen">
      <div class="panel felt wide">
        <div class="topRow">
          <div class="titleBlock">
            <div class="title">${t("play")}</div>
            <div class="sub">
              Room <span class="code">${room?.code||state.room}</span> ·
              Mode <b>${g.mode}</b> · Trump <b>${g.trump || '-'}</b> · Contract <b>${g.contract}</b> · x<b>${g.coincheLevel||1}</b>
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

          <div class="tableBox">
            <div class="turnHint ${yourTurn?"your":""}">${yourTurn ? t("yourTurn") : t("waiting")}</div>
            <div class="trickArea">${trickCards || `<div class="emptyTrick">Play cards…</div>`}</div>
            <div class="smallNote">Follow suit if possible. If not, trump if possible. (Simplified rules)</div>
          </div>
        </div>

        <div class="handBar">${hand}</div>
      </div>
    </div>
  `;

  root.querySelector("#back").onclick = ()=>{ state.phase="LOBBY"; render(); };

  root.querySelectorAll(".handCard").forEach(btn=>{
    btn.onclick = ()=>{
      if(!yourTurn) return;
      state.socket.send(JSON.stringify({type:"game:play", cardId: btn.dataset.id}));
    };
  });
}
