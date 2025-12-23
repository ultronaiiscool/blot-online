
import { state } from "../core/state.js";

export function renderAdmin(root){
  root.innerHTML = `
    <div class="panel">
      <h2>Admin Panel</h2>
      <button class="btn gold" id="refresh">Refresh Log</button>
      <div id="log"></div>
      <input id="banId" placeholder="User ID to ban"/>
      <button class="btn danger" id="ban">Ban</button>
      <button class="btn ghost" id="unban">Unban</button>
    </div>
  `;

  const send = type => state.socket.send(JSON.stringify({type, userId: root.querySelector("#banId").value}));

  root.querySelector("#refresh").onclick = ()=>{
    state.socket.send(JSON.stringify({type:"admin:log"}));
  };
  root.querySelector("#ban").onclick = ()=>send("admin:ban");
  root.querySelector("#unban").onclick = ()=>send("admin:unban");

  state.socket.onmessage = e=>{
    const m = JSON.parse(e.data);
    if(m.type==="admin:log"){
      root.querySelector("#log").innerHTML = m.log.map(l=>`
        <div>${l.time} — ${l.action} — ${JSON.stringify(l.payload)}</div>
      `).join("");
    }
  };
}
