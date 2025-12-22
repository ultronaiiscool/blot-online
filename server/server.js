import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { OAuth2Client } from "google-auth-library";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;


// ---- Rooms + Simple Game Loop (Step D base) ----
const rooms = new Map(); // code -> room
const clients = new Map(); // ws -> client
const profilesByToken = new Map(); // token -> {name, picture, sub, email}


let quickQueue = []; // array of client ids waiting for quick match

function randCode(){
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function createRoom(){
  let code = randCode();
  while (rooms.has(code)) code = randCode();
  const room = { code, players: [], game: null };
  rooms.set(code, room);
  return room;
}

function makeDeck(){
  const suits = ["S","H","D","C"];
  const ranks = ["7","8","9","10","J","Q","K","A"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(r+s);
  // Fisher-Yates
  for (let i=deck.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createBot(difficulty="normal"){
  const id = "bot-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const names = {
    easy: ["AramBot","LilitBot","VardanBot","AniBot"],
    normal: ["BlotBot","KilikiaBot","YerevanBot","TigranBot"],
    hard: ["GrandBot","CleverBot","SharpsuitBot","TricksterBot"]
  };
  const pool = names[difficulty] || names.normal;
  const name = pool[Math.floor(Math.random()*pool.length)];
  return { id, ws: null, name, room: null, isBot: true, difficulty };
}

function botChooseCard(hand, difficulty="normal"){
  // No full Belote legality yet. Pick random for now.
  if (!hand || hand.length === 0) return null;
  return hand[Math.floor(Math.random()*hand.length)];
}

function maybeRunBotTurn(room){
  const game = room.game;
  if (!game) return;
  const current = room.players[game.turn];
  if (!current || !current.isBot) return;

  setTimeout(()=>{
    const bot = room.players[game.turn];
    if (!bot || !bot.isBot || !room.game) return;
    const hand = room.game.hands[bot.id] || [];
    const card = botChooseCard(hand, bot.difficulty);
    if (!card) return;
    // play via same logic as human
    hand.splice(hand.indexOf(card), 1);
    room.game.trick.push({ seat: room.game.turn, playerId: bot.id, card });
    room.game.turn = (room.game.turn + 1) % room.players.length;
    if (room.game.trick.length >= room.players.length){
      room.game.trick = [];
    }
    broadcastRoom(room);
    // chain
    maybeRunBotTurn(room);
  }, 450);
}

function startGame(room){
  const deck = makeDeck();
  const hands = {};
  for (const p of room.players){
    hands[p.id] = deck.splice(0, 8);
  }
  room.game = {
    phase: "trick",
    turn: 0,
    hands,
    trick: [],
    startedAt: Date.now()
  };
}

function safeSend(ws, obj){
  if (!ws) return;
  try { ws.send(JSON.stringify(obj)); } catch {}
}

function broadcastRoom(room){
  const payload = {
    type: "state:update",
    room: {
      code: room.code,
      players: room.players.map(p => ({ id: p.id, name: p.name, picture: p.picture || null, isBot: !!p.isBot })),
      game: room.game
    }
  };
  for (const p of room.players){
    safeSend(p.ws, payload);
  }
}

function leaveRoom(client){
  const room = client.room;
  if (!room) return;
  room.players = room.players.filter(p => p.id !== client.id);
  client.room = null;
  // if empty, delete room
  if (room.players.length === 0){
    rooms.delete(room.code);
    return;
  }
  // if game running, keep it simple: end game
  room.game = null;
  broadcastRoom(room);
}

function seatIndex(room, clientId){
  return room.players.findIndex(p => p.id === clientId);
}


wss.on("connection", (ws) => {
  const id = (globalThis.crypto?.randomUUID?.() ?? (Math.random().toString(16).slice(2)+Date.now().toString(16)));
  const client = { id, ws, name: "Guest", room: null };
  clients.set(ws, client);

  safeSend(ws, { type:"hello:need" });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || !msg.type) return;

    switch (msg.type){

      case "hello": {
        const token = (msg.token || "").toString();
        if (token){
          client.token = token;
          const prof = profilesByToken.get(token);
          if (prof && prof.name){
            client.name = prof.name;
            client.picture = prof.picture || null;
            client.sub = prof.sub || null;
            client.email = prof.email || null;
          } else {
            client.name = (msg.name || "Guest").toString().slice(0, 24);
            // client may send cached google profile; accept for UX but not verified
            if (msg.google && msg.google.name){
              client.name = msg.google.name.toString().slice(0,24);
              client.picture = msg.google.picture || null;
            }
          }
        } else {
          client.name = (msg.name || "Guest").toString().slice(0, 24);
        }
        safeSend(ws, { type:"hello:ok", id: client.id, name: client.name });
        break;
      }

      case "room:create": {
        if (client.room) leaveRoom(client);
        const room = createRoom();
        room.players.push(client);
        client.room = room;
        broadcastRoom(room);
        break;
      }

      case "room:join": {
        const code = (msg.code || "").toString().trim().toUpperCase();
        const room = rooms.get(code);
        if (!room){
          safeSend(ws, { type:"error", message:"Room not found" });
          return;
        }
        if (room.players.length >= 4){
          safeSend(ws, { type:"error", message:"Room is full" });
          return;
        }
        if (client.room) leaveRoom(client);
        room.players.push(client);
        client.room = room;
        if (room.players.length === 4 && !room.game) startGame(room);
        broadcastRoom(room);
        break;
      }

      case "room:leave": {
        if (client.room) leaveRoom(client);
        break;
      }

      case "room:quick": {
        const botLevel = (msg.botLevel || "off").toString();
        handleQuickJoin(client, botLevel);
        break;
      }

      case "game:play": {
        const room = client.room;
        const game = room?.game;
        if (!room || !game) return;

        const seat = seatIndex(room, client.id);
        if (seat < 0) return;
        if (seat !== game.turn){
          safeSend(ws, { type:"error", message:"Not your turn" });
          return;
        }

        const card = (msg.card || "").toString();
        const hand = game.hands[client.id] || [];
        if (!hand.includes(card)){
          safeSend(ws, { type:"error", message:"Illegal card" });
          return;
        }

        // remove from hand
        hand.splice(hand.indexOf(card), 1);
        game.trick.push({ seat, playerId: client.id, card });

        // rotate turn
        game.turn = (game.turn + 1) % room.players.length;

        // if trick has 4 cards, clear it (no scoring yet)
        if (game.trick.length >= room.players.length){
          game.trick = [];
        }

        broadcastRoom(room);
        break;
      }

      case "auth:google": {
  if (!googleClient){
    safeSend(ws, { type:"error", message:"Google Sign-In not configured on server (GOOGLE_CLIENT_ID missing)." });
    return;
  }
  const credential = (msg.credential || "").toString();
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const profile = {
      sub: payload.sub,
      email: payload.email || null,
      name: payload.name || "Google User",
      picture: payload.picture || null
    };
    // store by token if present
    if (client.token){
      profilesByToken.set(client.token, profile);
    }
    client.name = profile.name.toString().slice(0,24);
    client.picture = profile.picture;
    client.sub = profile.sub;
    client.email = profile.email;

    safeSend(ws, { type:"auth:ok", profile });
    // update room state for others
    if (client.room) broadcastRoom(client.room);
  } catch (e){
    safeSend(ws, { type:"error", message:"Google Sign-In failed (token verification)." });
  }
  break;
}

case "auth:signout": {
  if (client.token){
    profilesByToken.delete(client.token);
  }
  client.sub = null;
  client.email = null;
  client.picture = null;
  safeSend(ws, { type:"auth:ok", profile: null });
  if (client.room) broadcastRoom(client.room);
  break;
}

      default:
        break;
    }
  });

  ws.on("close", () => {
    // remove from quick queue
    quickQueue = quickQueue.filter(x => x !== client.id);
    // leave room
    if (client.room) leaveRoom(client);
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on", PORT);
});
