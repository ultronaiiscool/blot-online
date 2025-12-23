import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { ensureSocket } from "../core/ws.js";

export function mountMenu(root,{persist,render}){
  root.innerHTML = `
    <div class="screen">
      <div class="panel felt">
        <div class="topRow">
          <div class="titleBlock">
            <div class="title">${t("title")}</div>
            ${state.user ? `<div class="sub">${t("welcome")}, ${state.user.name}</div>` : ``}
          </div>
          <div class="controls">
            <select id="lang" class="chip">
              <option value="en">EN</option>
              <option value="hy">HY</option>
              <option value="ru">RU</option>
            </select>
          </div>
        </div>

        ${!state.user ? `
          <button class="btn google" id="login"><span class="g">G</span> ${t("signIn")}</button>
        ` : `
          <div class="stack">
            <button class="btn gold" id="create">${t("create")}</button>
            <button class="btn gold" id="join">${t("join")}</button>
            <button class="btn gold primary" id="quick">${t("quick")}</button>
          </div>

          <label class="rowToggle">
            <input type="checkbox" id="mic" ${state.micAllowed?"checked":""}/>
            <span>${t("allowMic")}</span>
          </label>

          <a class="link" href="/logout">${t("signOut")}</a>

          ${state.joinOpen ? `
            <div class="modal">
              <div class="modalBox">
                <div class="modalTitle">${t("enterCode")}</div>
                <input id="code" class="codeInput" maxlength="5"
                  autocapitalize="characters" autocomplete="off" autocorrect="off"
                  inputmode="text" placeholder="ABCDE" value="${state.joinCode}"/>
                <button class="btn gold primary" id="joinGo">${t("join")}</button>
                <button class="btn ghost" id="joinCancel">${t("cancel")}</button>
              </div>
            </div>
          `:``}
        `}
      </div>
    </div>
  `;

  const lang = root.querySelector("#lang");
  lang.value = state.lang;
  lang.onchange = (e)=>{ state.lang=e.target.value; persist(); render(); };

  if(!state.user){
    root.querySelector("#login").onclick = ()=>location.href="/auth/google";
    return;
  }

  ensureSocket(()=>{});
  root.querySelector("#mic").onchange = (e)=>{ state.micAllowed=e.target.checked; persist(); };

  root.querySelector("#create").onclick = ()=>state.socket.send(JSON.stringify({type:"room:create"}));
  root.querySelector("#quick").onclick = ()=>state.socket.send(JSON.stringify({type:"room:create"}));

  root.querySelector("#join").onclick = ()=>{
    state.joinOpen=true; state.joinCode=""; render();
    setTimeout(()=>root.querySelector("#code")?.focus(), 0);
  };

  if(state.joinOpen){
    const input = root.querySelector("#code");
    input.oninput = ()=>{
      state.joinCode = input.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5);
      input.value = state.joinCode;
    };
    root.querySelector("#joinGo").onclick = ()=>{
      if(!state.joinCode) return;
      state.joinOpen=false;
      state.socket.send(JSON.stringify({type:"room:join", code: state.joinCode}));
      render();
    };
    root.querySelector("#joinCancel").onclick = ()=>{ state.joinOpen=false; render(); };
  }
}
