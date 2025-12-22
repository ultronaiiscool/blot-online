import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

// ---- Rooms + Simple Game Loop (Step D base) ----
const rooms = new Map(); // code -> room
const clients = new Map(); // ws -> client

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
  try { ws.send(JSON.stringify(obj)); } catch {}
}

function broadcastRoom(room){
  const payload = {
    type: "state:update",
    room: {
      code: room.code,
      players: room.players.map(p => ({ id: p.id, name: p.name })),
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

function handleQuickJoin(client){
  // remove if already queued
  quickQueue = quickQueue.filter(id => id !== client.id);
  quickQueue.push(client.id);

  // if at least 4, match first 4
  if (quickQueue.length >= 4){
    const ids = quickQueue.splice(0, 4);
    const room = createRoom();
    for (const id of ids){
      const c = [...clients.values()].find(x => x.id === id);
      if (!c) continue;
      // if already in room, remove
      if (c.room) leaveRoom(c);
      room.players.push(c);
      c.room = room;
    }
    if (room.players.length === 4) startGame(room);
    broadcastRoom(room);
  } else {
    safeSend(client.ws, { type:"quick:queued", position: quickQueue.length });
  }
}

// ---- WebSocket ----
wss.on("connection", (ws) => {
  const id = (globalThis.crypto?.randomUUID?.() ?? (Math.random().toString(16).slice(2)+Date.now().toString(16)));
  const client = { id, ws, name: "Guest", room: null };
  clients.set(ws, client);

  safeSend(ws, { type:"hello:need" });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || !msg.type) return;

    switch (msg.type){

      case "hello": {
        client.name = (msg.name || "Guest").toString().slice(0, 24);
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
        // just queue for now (no bots in Step D)
        handleQuickJoin(client);
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
