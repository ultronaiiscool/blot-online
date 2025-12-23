import { state } from "../core/state.js";
import { t } from "../core/i18n.js";

export function mountLobby(root,{persist,render}){
  state.rulesOpen = state.rulesOpen || false;
  const room = state.roomState || {code: state.room, players:[], hostId:null, target:151, phase:"LOBBY"};
  const players = room.players || [];

  root.innerHTML = `
    <div class="screen">
      <div class="panel felt wide">
        <div class="topRow">
          <div class="titleBlock">
            <div class="title">${t("lobby")}</div>
            <div class="sub">Room <span class="code">${room.code||"-----"}</span></div>
          </div>
          <div class="controls">
            <select id="target" class="chip" ${room.hostId!==state.user.id?"disabled":""}>
              <option value="151">151</option>
              <option value="301">301</option>
            </select>
            <button class="chip" id="rules">${t("rules")}</button>
            <button class="chip" id="leave">${t("leave")}</button>
          </div>
        </div>

        <div class="scoreBar">
          <div class="scorePill a">${t("teamA")}: <b>${(room.scores?.A)??0}</b></div>
          <div class="scorePill b">${t("teamB")}: <b>${(room.scores?.B)??0}</b></div>
        </div>

        <div class="tableArea">
          <div class="tableRing">
            ${players.map((p,i)=>`
              <div class="nameOval ${i%2===0?"teamA":"teamB"} ${p.bot?"bot":""}">
                <span class="nm">${p.name}${p.bot?" 🤖":""}</span>
                ${p.id===room.hostId ? `<span class="hostTag">${t("host")}</span>`:``}
                ${(!p.bot && p.id!==state.user.id) ? `
                  <button class="muteBtn" data-id="${p.id}">${state.muted[p.id] ? "Unmute" : "Mute"}</button>
                ` : `<span class="youTag">${p.id===state.user.id?"(You)":""}</span>`}
              </div>
            `).join("")}
          </div>
        </div>

        ${(state.rulesOpen)?`
          <div class="modal">
            <div class="modalBox wideModal">
              <div class="modalTitle">${t("rules")}</div>
              <div class="formGrid">
                <label><span>${t("target")}</span>
                  <select id="rtarget" class="chip">
                    <option value="151">151</option>
                    <option value="301">301</option>
                    <option value="501">501</option>
                    <option value="1001">1001</option>
                  </select>
                </label>
                <label><span>${t("modes")}</span>
                  <div class="checks">
                    <label><input type="checkbox" id="mSuit"/> ${t("suitTrump")}</label>
                    <label><input type="checkbox" id="mNT"/> ${t("noTrump")}</label>
                    <label><input type="checkbox" id="mAT"/> ${t("allTrump")}</label>
                  </div>
                </label>
                <label><span>${t("coinche")}</span><input type="checkbox" id="coinche" /></label>
                <label><span>${t("melds")}</span><input type="checkbox" id="melds" /></label>
                <label><span>${t("autoMelds")}</span><input type="checkbox" id="autoMelds" /></label>
                <label><span>${t("strictTrumping")}</span><input type="checkbox" id="strict" /></label>
              </div>
              <div class="modalBtns">
                <button class="btn gold primary" id="saveRules">${t("save")}</button>
                <button class="btn ghost" id="closeRules">${t("cancel")}</button>
              </div>
            </div>
          </div>
        `:``}

        <div class="bottomRow">
          <div class="hint">${t("target")}: <b>${room.target}</b> · ${state.micAllowed ? "🎤 ON" : "🎤 OFF"}</div>
          <button class="btn ghost" id="readyBtn">${room?.ready?.[state.user.id] ? "Unready" : "Ready"}</button>
          <button class="btn gold primary" id="start" ${room.hostId!==state.user.id?"disabled":""}>${t("start")}</button>
        </div>
      </div>
    </div>
  `;

  // target settings
  const targetSel = root.querySelector("#target");
  targetSel.value = String(room.target || 151);
  targetSel.onchange = (e)=>{
    state.socket.send(JSON.stringify({type:"room:settings", target: Number(e.target.value)}));
  };

  root.querySelector("#rules").onclick = ()=>{ state.rulesOpen=true; render(); };

  if(state.rulesOpen){
    const rules = room.rules || {allowModes:["SUIT","NO_TRUMP","ALL_TRUMP"], allowCoinche:true, allowMelds:true, autoMelds:false, strictTrumping:false};
    const draft = state.rulesDraft || rules;
    const rtarget = root.querySelector("#rtarget");
    rtarget.value = String(room.target||151);
    const mSuit = root.querySelector("#mSuit");
    const mNT = root.querySelector("#mNT");
    const mAT = root.querySelector("#mAT");
    mSuit.checked = draft.allowModes?.includes("SUIT");
    mNT.checked = draft.allowModes?.includes("NO_TRUMP");
    mAT.checked = draft.allowModes?.includes("ALL_TRUMP");
    root.querySelector("#coinche").checked = !!draft.allowCoinche;
    root.querySelector("#melds").checked = !!draft.allowMelds;
    root.querySelector("#autoMelds").checked = !!draft.autoMelds;
    root.querySelector("#strict").checked = !!draft.strictTrumping;

    root.querySelector("#closeRules").onclick = ()=>{ state.rulesOpen=false; render(); };
    root.querySelector("#saveRules").onclick = ()=>{
      const allowModes = [];
      if(mSuit.checked) allowModes.push("SUIT");
      if(mNT.checked) allowModes.push("NO_TRUMP");
      if(mAT.checked) allowModes.push("ALL_TRUMP");
      const newRules = {
        allowModes,
        allowCoinche: root.querySelector("#coinche").checked,
        allowMelds: root.querySelector("#melds").checked,
        autoMelds: root.querySelector("#autoMelds").checked,
        strictTrumping: root.querySelector("#strict").checked
      };
      state.rulesDraft = newRules;
      persist();
      state.socket.send(JSON.stringify({type:"room:settings", target: Number(rtarget.value), rules: newRules}));
      state.rulesOpen=false;
      render();
    };
  }

  root.querySelector("#leave").onclick = ()=>{
    state.socket.send(JSON.stringify({type:"room:leave"}));
    state.room=null; state.roomState=null; state.bidState=null; state.gameState=null;
    state.phase="MENU"; render();
  };

  root.querySelectorAll(".muteBtn").forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.dataset.id;
      state.muted[id]=!state.muted[id];
      localStorage.setItem("muted", JSON.stringify(state.muted));
      render();
    };
  });

  root.querySelector("#readyBtn").onclick = ()=>{
    const cur = !!room?.ready?.[state.user.id];
    state.socket.send(JSON.stringify({type:"lobby:ready", roomId: room.id, ready: !cur}));
  };

  root.querySelector("#start").onclick = ()=>{
    state.socket.send(JSON.stringify({type:"game:start"}));
  };
}
