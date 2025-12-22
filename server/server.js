function getLegalPlays(state, seat){ return legalPlays(state, seat); }
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * Armenian Blot / Bazaar Belote rules engine (server-authoritative):
 * - 32-card deck (7..A), 4 players, 2 teams (0&2 vs 1&3)
 * - Bazaar auction bidding in tens (min 80) + trump suit
 * - Contra / Recontra
 * - Declarations (server auto-calculates; compares best meld per team)
 * - Trick rules: follow suit; if void must trump if opponents winning; must overtrump if possible
 * - Trump ranking: J,9,A,10,K,Q,8,7
 * - Non-trump ranking: A,10,K,Q,J,9,8,7
 * - Scoring values as standard belote (trump J=20, 9=14, A=11, 10=10, K=4, Q=3, 8/7=0; non-trump J=2, 9/8/7=0)
 * - Last trick bonus +10
 * - Contract success: declarers must reach bid points (bid*10) in card points (+ melds + last bonus as per common online implementations);
 *   if fail -> defenders get ALL points of hand.
 * - Capot contract (win all tricks) supported
 *
 * Notes:
 * - Armenian house rules vary; this is a faithful, practical online implementation aligned to common descriptions.
 */

// -------------------- utilities --------------------
const SUITS = ["S","H","D","C"]; // spades, hearts, diamonds, clubs
const RANKS = ["7","8","9","J","Q","K","10","A"]; // storage order; ranking differs by trump/non-trump
const TEAM_OF_SEAT = (seat) => (seat === 0 || seat === 2) ? 0 : 1;

function now(){ return Date.now(); }


// Bots
const BOT_NAMES = [
  "Bot Aram","Bot Ani","Bot Vardan","Bot Narek",
  "Bot Lilit","Bot Saro","Bot Tatev","Bot Levon"
];
function makeBot(skill="easy"){
  const name = BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
  return { id: `bot_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`, name, isBot: true, skill };
}
function isBotPlayer(p){ return !!p?.isBot; }

function randInt(max){
  // crypto random int [0,max)
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0);
  return n % max;
}
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function cardId(suit, rank){ return `${rank}${suit}`; }
function parseCard(id){
  // rank can be "10"
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { suit, rank, id };
}

// Rank ordering for trick-taking
const TRUMP_ORDER = ["J","9","A","10","K","Q","8","7"]; // high -> low
const PLAIN_ORDER = ["A","10","K","Q","J","9","8","7"]; // high -> low

const TRUMP_POINTS = { "J":20, "9":14, "A":11, "10":10, "K":4, "Q":3, "8":0, "7":0 };
const PLAIN_POINTS = { "A":11, "10":10, "K":4, "Q":3, "J":2, "9":0, "8":0, "7":0 };

function rankIndex(rank, isTrump){
  const order = isTrump ? TRUMP_ORDER : PLAIN_ORDER;
  return order.indexOf(rank); // smaller = higher
}

function isHigher(a, b, leadSuit, trumpSuit){
  // returns true if card a beats card b within current trick context
  const A = parseCard(a), B = parseCard(b);
  const AisTrump = A.suit === trumpSuit;
  const BisTrump = B.suit === trumpSuit;

  if (AisTrump && !BisTrump) return true;
  if (!AisTrump && BisTrump) return false;

  if (AisTrump && BisTrump){
    return rankIndex(A.rank, true) < rankIndex(B.rank, true);
  }

  // both non-trump
  if (A.suit === leadSuit && B.suit !== leadSuit) return true;
  if (A.suit !== leadSuit && B.suit === leadSuit) return false;
  if (A.suit !== leadSuit && B.suit !== leadSuit) return false; // neither followed lead, can't happen normally
  return rankIndex(A.rank, false) < rankIndex(B.rank, false);
}

function cardPoints(card, trumpSuit){
  const c = parseCard(card);
  return (c.suit === trumpSuit) ? TRUMP_POINTS[c.rank] : PLAIN_POINTS[c.rank];
}

// -------------------- melds (declarations) --------------------
function longestSequences(cards){
  // returns sequences length>=3 per suit (as arrays of ranks sorted low->high by natural belote sequence)
  // sequence order: 7,8,9,10,J,Q,K,A (note: belote sequences use natural rank order, not trick rank order)
  const seqOrder = ["7","8","9","10","J","Q","K","A"];
  const bySuit = new Map();
  for (const id of cards){
    const { suit, rank } = parseCard(id);
    if (!bySuit.has(suit)) bySuit.set(suit, new Set());
    bySuit.get(suit).add(rank);
  }
  const seqs = [];
  for (const [suit, set] of bySuit.entries()){
    // scan runs
    let run = [];
    for (const r of seqOrder){
      if (set.has(r)){
        run.push(r);
      } else {
        if (run.length >= 3) seqs.push({ suit, ranks:[...run] });
        run = [];
      }
    }
    if (run.length >= 3) seqs.push({ suit, ranks:[...run] });
  }
  return seqs;
}

function meldValueForSequence(len){
  if (len >= 5) return 100;
  if (len === 4) return 50;
  if (len === 3) return 20;
  return 0;
}

function bestSequence(seqs){
  if (!seqs.length) return null;
  // best is: highest length, then highest top rank (A highest)
  const seqOrder = ["7","8","9","10","J","Q","K","A"];
  function topRankIndex(s){ return seqOrder.indexOf(s.ranks[s.ranks.length - 1]); }
  const sorted = [...seqs].sort((a,b)=>{
    if (b.ranks.length !== a.ranks.length) return b.ranks.length - a.ranks.length;
    return topRankIndex(b) - topRankIndex(a);
  });
  return sorted[0];
}

function fourOfAKind(cards){
  // returns array {rank, points}
  const counts = new Map();
  for (const id of cards){
    const { rank } = parseCard(id);
    counts.set(rank, (counts.get(rank)||0)+1);
  }
  const res = [];
  for (const [rank, n] of counts.entries()){
    if (n === 4){
      let pts = 0;
      if (rank === "J") pts = 200;
      else if (rank === "9") pts = 150; // some use 140; picking common 150
      else if (rank === "A") pts = 100;
      else if (rank === "10") pts = 100;
      else if (rank === "K") pts = 100;
      else if (rank === "Q") pts = 100;
      else pts = 0; // 8/7 no score
      if (pts > 0) res.push({ rank, points: pts });
    }
  }
  // higher points first; tie by rank natural high
  const nat = ["7","8","9","10","J","Q","K","A"];
  res.sort((a,b)=> (b.points-a.points) || (nat.indexOf(b.rank)-nat.indexOf(a.rank)));
  return res;
}

function beloteHolders(hands, trumpSuit){
  // returns set of playerIds who hold K+Q of trump in their 8 cards
  const holders = new Set();
  for (const p of hands.keys()){
    const cards = hands.get(p);
    const hasK = cards.includes(cardId(trumpSuit, "K")) || cards.includes("K"+trumpSuit);
    const hasQ = cards.includes(cardId(trumpSuit, "Q")) || cards.includes("Q"+trumpSuit);
    if (hasK && hasQ) holders.add(p);
  }
  return holders;
}

// -------------------- game engine --------------------
const clients = new Map(); // ws -> {id,name,roomId,seat}

function fillRoomWithBots(room){
  const level = room.botLevel || "off";
  if (level === "off") return;
  while (room.seats.filter(Boolean).length < 4){
    room.seats.push(makeBot(level));
  }
}
function botDelay(skill){
  return skill === "easy" ? 700 : 900;
}
function botChooseBid(state, seat){
  // very simple heuristic: count high trump potential per suit, bid 80..120
  const pid = state.seats[seat]?.id;
  const hand = pid ? (state.hands?.[pid]?.cards || []) : [];
  const suits = ["S","H","D","C"];
  const scoreSuit = (s)=>{
    let sc=0;
    for (const c of hand){
      const r = c.slice(0,-1), su=c.slice(-1);
      if (su!==s) continue;
      if (r==="J") sc+=5;
      else if (r==="9") sc+=4;
      else if (r==="A") sc+=3;
      else if (r==="10") sc+=2;
      else if (r==="K"||r==="Q") sc+=1;
    }
    return sc;
  };
  let best = "S", bestScore = -1;
  for (const s of suits){
    const sc = scoreSuit(s);
    if (sc>bestScore){ bestScore=sc; best=s; }
  }
  // easy bots pass a lot; normal bids more
  const skill = "normal";
  const thresh = skill === "easy" ? 8 : 6;
  if (bestScore < thresh) return { type:"pass" };
  const bid = Math.min(120, 80 + Math.floor((bestScore-6))*10);
  return { type:"bid", bid, suit: best };
}

const rooms = new Map();   // roomId -> room

// Reconnect support (client token -> stable player id)
const tokens = new Map(); // token -> { id, name, roomId, seat, lastSeen }
const purgeTimers = new Map(); // playerId -> timeout

function getOrCreateIdentity(token, name){
  const clean = (typeof token === "string") ? token.trim() : "";
  const nm = (typeof name === "string" && name.trim()) ? name.trim().slice(0,24) : null;

  if (clean && tokens.has(clean)){
    const t = tokens.get(clean);
    if (nm) t.name = nm;
    t.lastSeen = now();
    return { token: clean, id: t.id, name: t.name };
  }

  // create new
  const newToken = clean || crypto.randomBytes(16).toString("hex");
  const id = nanoid(10);
  const finalName = nm || `Player-${id.slice(0,4)}`;
  tokens.set(newToken, { id, name: finalName, roomId: null, seat: null, lastSeen: now() });
  return { token: newToken, id, name: finalName };
}

function wsForPlayer(roomId, playerId){
  for (const [ws, info] of clients.entries()){
    if (info?.roomId === roomId && info?.id === playerId) return ws;
  }
  return null;
}

function markDisconnected(room, playerId){
  const idx = seatIndexForPlayer(room, playerId);
  if (idx === -1) return;
  if (!room.seats[idx]) return;
  room.seats[idx].disconnectedAt = now();

  // start purge timer (grace period) so refresh doesn't nuke the game
  if (purgeTimers.has(playerId)) clearTimeout(purgeTimers.get(playerId));
  const t = setTimeout(()=>{
    const r = rooms.get(room.id);
    if (!r) return;
    const i = seatIndexForPlayer(r, playerId);
    if (i !== -1 && r.seats[i]?.disconnectedAt){
      // remove after grace period
      r.seats[i] = null;
      r.state.ready.delete(playerId);
      // if player never came back mid-hand, forfeit -> reset to lobby (simple)
      if (r.state.phase !== "lobby"){
        r.state = makeInitialGameState();
      }
      broadcastRoom(r.id, { t:"room:update", room: roomSummary(r) });
      broadcastRoom(r.id, { t:"game:state", state: publicGameState(r, null) });
      const any = r.seats.some(Boolean) || r.spectators.length > 0;
      if (!any) rooms.delete(r.id);
    }
    purgeTimers.delete(playerId);
  }, 3 * 60 * 1000); // 3 minutes
  purgeTimers.set(playerId, t);
}

function makeRoom({ targetScore = 301, turnSeconds = 20, isPrivate = false, password = "" } = {}){
  const id = nanoid(6).toUpperCase();
  return {
    id,
    createdAt: now(),
    settings: { targetScore, turnSeconds, isPrivate, password },
    seats: [null, null, null, null], // {id,name,joinedAt}
    spectators: [],
    state: makeInitialGameState(),
    chat: []
  };
}

function makeInitialGameState(){
  return {
    phase: "lobby", // lobby | dealing | bidding | declarations | trick | scoring | finished
    ready: new Set(),
    dealerSeat: 0,
    handNo: 0,

    // hand state
    trumpSuit: null,
    contract: null, // {type:"points", bid:80..160, suit} or {type:"capot", suit}
    declarerTeam: null,
    contra: 1, // 1 normal, 2 contra, 4 recontra

    bidding: null, // {turnSeat, highestBid, highestBidderSeat, passesInRow, ended}
    bidLog: [],
    hands: new Map(), // playerId -> [cardIds]
    trick: null, // {leadSeat, plays: [{seat,card}], completed}
    tricksWon: [[],[]], // team -> array of cards won
    tricksCount: [0,0], // tricks won count
    lastTrickWinnerTeam: null,

    melds: { // computed by server, revealed after bidding
      team0: { points:0, detail:[] },
      team1: { points:0, detail:[] },
      beloteHolders: new Set(), // playerIds
      beloteAwarded: new Set() // playerIds (awarded 20 when both K/Q played)
    },

    // scoring totals
    totals: [0,0],

    // turn enforcement
    turnSeat: 0,
    turnDeadline: 0
  };
}

function roomSummary(room){
  const seats = room.seats.map(s => s ? ({ id:s.id, name:s.name, disconnected: Boolean(s.disconnectedAt) }) : null);
  return {
    id: room.id,
    createdAt: room.createdAt,
    settings: room.settings,
    seats,
    spectators: room.spectators.length,
    phase: room.state.phase
  };
}

function send(ws, obj){
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function maybeBotAct(room){
  const s = room.game;
  if (!s) return;
  const seat = s.turnSeat;
  const pl = room.seats?.[seat];
  if (!isBotPlayer(pl)) return;

  const skill = pl.skill || "easy";
  setTimeout(()=>{
    try{
      if (s.phase === "bidding"){
        // bot decides bid or pass
        const dec = botDecideBid(room, seat);
        if (dec.type === "pass") handlePass(room, seat);
        else if (dec.type === "bid") handleBid(room, seat, { bid: dec.bid, suit: dec.suit });
      } else if (s.phase === "trick"){
        const card = botDecidePlay(room, seat);
        if (card) handlePlay(room, seat, card);
      }
    }catch(e){}
  }, botDelay(skill));
}
function botDecideBid(room, seat){
  const s = room.game;
  const pid = s.seats?.[seat]?.id;
  const hand = pid ? (s.hands?.[pid]?.cards || []) : [];
  const suits = ["S","H","D","C"];
  const scoreSuit = (suit)=>{
    let sc=0;
    for (const c of hand){
      const r = c.slice(0,-1), su=c.slice(-1);
      if (su!==suit) continue;
      if (r==="J") sc+=5;
      else if (r==="9") sc+=4;
      else if (r==="A") sc+=3;
      else if (r==="10") sc+=2;
      else if (r==="K"||r==="Q") sc+=1;
    }
    return sc;
  };
  let best = "S", bestScore=-1;
  for (const suit of suits){
    const sc = scoreSuit(suit);
    if (sc>bestScore){ bestScore=sc; best=suit; }
  }
  const skill = room.botLevel || "easy";
  const thresh = skill === "easy" ? 8 : 6;
  if (bestScore < thresh) return { type:"pass" };

  // propose bid: 80..140, but must beat current highest
  const proposed = Math.min(140, 80 + Math.max(0, bestScore-6)*10);
  const current = s.bidding?.highestBid?.bid || 0;
  const bid = Math.max(current + 10, proposed);
  if (bid > 160) return { type:"pass" };
  return { type:"bid", bid, suit: best };
}
function botDecidePlay(room, seat){
  const s = room.game;
  // use existing legal move calculation if present
  const legal = getLegalPlays(s, seat);
  if (!legal || !legal.length) return null;
  const skill = room.botLevel || "easy";
  if (skill === "easy"){
    return legal[Math.floor(Math.random()*legal.length)];
  }
  // normal: prefer winning with low cost, otherwise dump low
  const leadSuit = s.trick?.leadSuit;
  const trump = s.trumpSuit;
  const value = (card)=>{
    const r = card.slice(0,-1), su = card.slice(-1);
    const trumpOrder = ["J","9","A","10","K","Q","8","7"];
    const plainOrder = ["A","10","K","Q","J","9","8","7"];
    const pointsTrump = {J:20,"9":14,A:11,"10":10,K:4,Q:3,"8":0,"7":0};
    const pointsPlain = {A:11,"10":10,K:4,Q:3,J:2,"9":0,"8":0,"7":0};
    const isTrump = (su===trump);
    const pts = isTrump ? (pointsTrump[r]||0) : (pointsPlain[r]||0);
    // lower is better (try to spend fewer points) unless trump/lead suited
    const ord = (isTrump ? trumpOrder : plainOrder).indexOf(r);
    return pts*10 + ord;
  };
  return [...legal].sort((a,b)=> value(a)-value(b))[0];
}

function broadcastRoom(roomId, obj){
  const payload = JSON.stringify(obj);
  for (const [ws, info] of clients.entries()){
    if (info.roomId === roomId && ws.readyState === ws.OPEN){
      ws.send(payload);
    }
  }
}

function listPublicRooms(){
  const list = [];
  for (const r of rooms.values()){
    if (!r.settings.isPrivate) list.push(roomSummary(r));
  }
  list.sort((a,b)=>b.createdAt-a.createdAt);
  return list.slice(0, 50);
}

function seatIndexForPlayer(room, playerId){
  return room.seats.findIndex(s => s?.id === playerId);
}

function removeFromRoom(ws){
  const info = clients.get(ws);
  if (!info?.roomId) return;
  const room = rooms.get(info.roomId);
  if (!room) return;

  const idx = seatIndexForPlayer(room, info.id);
  if (idx !== -1){
    room.seats[idx] = null;
    room.state.ready.delete(info.id);
    // if player leaves mid-hand, treat as forfeit -> reset hand to lobby (simple)
    if (room.state.phase !== "lobby"){
      room.state = makeInitialGameState();
    }
    broadcastRoom(room.id, { t:"room:update", room: roomSummary(room) });
    broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
  } else {
    room.spectators = room.spectators.filter(x => x.id !== info.id);
    broadcastRoom(room.id, { t:"room:update", room: roomSummary(room) });
  }

  const any = room.seats.some(Boolean) || room.spectators.length > 0;
  if (!any) rooms.delete(room.id);
  info.roomId = null;
  info.seat = null;

  if (info.token && tokens.has(info.token)){
    const t = tokens.get(info.token);
    t.roomId = null;
    t.seat = null;
    t.lastSeen = now();
  }
}


function joinRoom(ws, roomId, { password = "" } = {}){
  const info = clients.get(ws);
  const room = rooms.get(roomId);
  if (!info || !room) return { ok:false, error:"Room not found." };

  if (room.settings.isPrivate){
    if ((room.settings.password||"") !== (password||"")){
      return { ok:false, error:"Wrong password." };
    }
  }

  const existing = seatIndexForPlayer(room, info.id);
  if (existing !== -1){
    // reconnect or rejoin: keep their old seat
    room.seats[existing].name = info.name;
    delete room.seats[existing].disconnectedAt;
    info.seat = existing;
  } else {
    const seat = room.seats.findIndex(s => s === null);
    if (seat !== -1){
      room.seats[seat] = { id:info.id, name:info.name, joinedAt: now() };
      info.seat = seat;
    } else {
      room.spectators.push({ id:info.id, name:info.name, joinedAt: now() });
      info.seat = null;
    }
  }
  info.roomId = roomId;

  // persist last room for reconnect token
  if (info.token && tokens.has(info.token)){
    const t = tokens.get(info.token);
    t.roomId = roomId;
    t.seat = info.seat;
    t.name = info.name;
    t.lastSeen = now();
  }

  if (purgeTimers.has(info.id)){
    clearTimeout(purgeTimers.get(info.id));
    purgeTimers.delete(info.id);
  }

  broadcastRoom(roomId, { t:"room:update", room: roomSummary(room) });
  return { ok:true, room: roomSummary(room) };
}

function quickMatch(ws, settings = {}){
  const info = clients.get(ws);
  if (!info) return { ok:false, error:"Not connected." };
  for (const r of rooms.values()){
    if (r.settings.isPrivate) continue;
    const open = r.seats.some(s => s === null);
    if (open && r.state.phase === "lobby"){
      const jr = joinRoom(ws, r.id);
      if (jr.ok) return jr;
    }
  }
  const room = makeRoom(settings);
  rooms.set(room.id, room);
  return joinRoom(ws, room.id);
}

function canStart(room){
  const seated = room.seats.filter(Boolean);
  if (seated.length !== 4) return false;
  return seated.every(p => room.state.ready.has(p.id));
}

// Public game state for a viewer; if viewerId provided, includes their hand.
function publicGameState(room, viewerId){
  const s = room.state;
  const seats = room.seats.map(p => p ? ({ id:p.id, name:p.name }) : null);

  // build hands visibility: only your hand, and card counts for others
  const hands = {};
  for (const p of room.seats){
    if (!p) continue;
    const cards = s.hands.get(p.id) || [];
    if (viewerId && p.id === viewerId) hands[p.id] = { count: cards.length, cards: [...cards].sort() };
    else hands[p.id] = { count: cards.length };
  }

  const bidding = s.bidding ? {
    turnSeat: s.bidding.turnSeat,
    highestBid: s.bidding.highestBid,
    highestBidderSeat: s.bidding.highestBidderSeat,
    passesInRow: s.bidding.passesInRow
  } : null;

  const trick = s.trick ? {
    leadSeat: s.trick.leadSeat,
    plays: s.trick.plays.map(x => ({ seat:x.seat, card:x.card }))
  } : null;

  return {
    phase: s.phase,
    handNo: s.handNo,
    dealerSeat: s.dealerSeat,
    turnSeat: s.turnSeat,
    turnDeadline: s.turnDeadline,
    seats,
    totals: s.totals,
    trumpSuit: s.trumpSuit,
    contract: s.contract,
    declarerTeam: s.declarerTeam,
    contra: s.contra,
    bidding,
    bidLog: (s.bidLog || []).slice(-30),
    trick,
    tricksCount: s.tricksCount,
    hands,
    meldsPublic: {
      team0: s.melds.team0,
      team1: s.melds.team1,
      beloteHoldersCount: s.melds.beloteHolders.size
    }
  };
}

function setTurn(room, seat){
  room.state.turnSeat = seat;
  room.state.turnDeadline = now() + room.settings.turnSeconds * 1000;
}

function nextSeat(seat){ return (seat + 1) % 4; }

function startHand(room){
  const s = room.state;
  s.phase = "dealing";
  s.handNo += 1;

  // rotate dealer
  s.dealerSeat = (s.handNo === 1) ? s.dealerSeat : nextSeat(s.dealerSeat);

  // create deck of 32
  const deck = [];
  for (const suit of SUITS){
    for (const rank of RANKS){
      deck.push(cardId(suit, rank));
    }
  }
  shuffle(deck);

  // deal 8 each (simple 8 rounds)
  s.hands = new Map();
  for (let seat = 0; seat < 4; seat++){
    const pid = room.seats[seat].id;
    s.hands.set(pid, []);
  }
  for (let i = 0; i < 32; i++){
    const seat = i % 4;
    const pid = room.seats[seat].id;
    s.hands.get(pid).push(deck[i]);
  }

  // init other hand state
  s.tricksWon = [[],[]];
  s.tricksCount = [0,0];
  s.lastTrickWinnerTeam = null;
  s.trumpSuit = null;
  s.contract = null;
  s.declarerTeam = null;
  s.contra = 1;
  s.melds = {
    team0:{ points:0, detail:[] },
    team1:{ points:0, detail:[] },
    beloteHolders:new Set(),
    beloteAwarded:new Set()
  };

  // start bidding: player left of dealer
  s.phase = "bidding";
  s.bidLog = [];
  s._playedLog = [];

  s.bidding = {
    turnSeat: nextSeat(s.dealerSeat),
    highestBid: null, // {type, bid, suit} or {type:"capot", suit}
    highestBidderSeat: null,
    passesInRow: 0
  };
  setTurn(room, s.bidding.turnSeat);
}

function endBidding(room){
  const s = room.state;
  const hb = s.bidding.highestBid;
  if (!hb){
    // everyone passed -> redeal
    startHand(room);
    return;
  }
  s.contract = hb;
  s.trumpSuit = hb.suit;
  s.declarerTeam = TEAM_OF_SEAT(s.bidding.highestBidderSeat);

  // compute melds now (server-owned, no cheating)
  computeMelds(room);

  s.phase = "declarations"; // brief; then trick
  // first trick lead = player left of dealer (common) OR left of dealer always; we'll use left of dealer for simplicity.
  s.trick = { leadSeat: nextSeat(s.dealerSeat), plays: [] };
  setTurn(room, s.trick.leadSeat);
}

function computeMelds(room){
  const s = room.state;
  // map seat->playerId/cards
  const seatCards = [];
  for (let seat=0; seat<4; seat++){
    const pid = room.seats[seat].id;
    const cards = s.hands.get(pid);
    seatCards.push({ seat, pid, cards });
  }

  // best meld per team for comparison: (four-of-kind beats sequence) else sequence
  function bestMeldForTeam(team){
    const players = seatCards.filter(x => TEAM_OF_SEAT(x.seat) === team);
    let best = null;
    let allDetail = [];
    let total = 0;

    // gather candidates
    for (const p of players){
      const seqs = longestSequences(p.cards);
      const bestSeq = bestSequence(seqs);
      if (bestSeq){
        const pts = meldValueForSequence(bestSeq.ranks.length);
        allDetail.push({ type:"sequence", seat:p.seat, suit:bestSeq.suit, len:bestSeq.ranks.length, top:bestSeq.ranks[bestSeq.ranks.length-1], points:pts });
      }
      const fours = fourOfAKind(p.cards);
      for (const f of fours){
        allDetail.push({ type:"four", seat:p.seat, rank:f.rank, points:f.points });
      }
    }

    // determine best for comparison
    const nat = ["7","8","9","10","J","Q","K","A"];
    function cmp(a,b){
      // return b better than a => positive
      // four beats sequence
      if (a.type !== b.type){
        if (a.type === "four") return -1;
        if (b.type === "four") return 1;
      }
      // both four: higher points then rank
      if (a.type === "four" && b.type === "four"){
        if (b.points !== a.points) return b.points - a.points;
        return nat.indexOf(b.rank) - nat.indexOf(a.rank);
      }
      // both sequence: longer then top
      if (a.type === "sequence" && b.type === "sequence"){
        if (b.len !== a.len) return b.len - a.len;
        return nat.indexOf(b.top) - nat.indexOf(a.top);
      }
      return 0;
    }

    for (const d of allDetail){
      if (!best) best = d;
      else if (cmp(best, d) > 0) best = d;
    }

    // scoring rule: only team with higher best meld scores ALL their meld points (common online simplification).
    // We'll compute totals later after comparing teams.
    // For now, sum all meld points in detail.
    total = allDetail.reduce((acc,x)=>acc + (x.points||0), 0);
    return { best, total, detail: allDetail };
  }

  const t0 = bestMeldForTeam(0);
  const t1 = bestMeldForTeam(1);

  function better(teamA, teamB){
    if (!teamA.best && !teamB.best) return null;
    if (teamA.best && !teamB.best) return 0;
    if (!teamA.best && teamB.best) return 1;
    // compare best items
    const a = teamA.best, b = teamB.best;
    // four beats sequence
    if (a.type !== b.type){
      return (a.type === "four") ? 0 : 1;
    }
    if (a.type === "four"){
      if (a.points !== b.points) return (a.points > b.points) ? 0 : 1;
      const nat = ["7","8","9","10","J","Q","K","A"];
      return (nat.indexOf(a.rank) > nat.indexOf(b.rank)) ? 0 : 1;
    }
    // sequences
    if (a.len !== b.len) return (a.len > b.len) ? 0 : 1;
    const nat = ["7","8","9","10","J","Q","K","A"];
    return (nat.indexOf(a.top) > nat.indexOf(b.top)) ? 0 : 1;
  }

  const winner = better(t0, t1);
  if (winner === 0){
    room.state.melds.team0 = { points: t0.total, detail: t0.detail };
    room.state.melds.team1 = { points: 0, detail: [] };
  } else if (winner === 1){
    room.state.melds.team0 = { points: 0, detail: [] };
    room.state.melds.team1 = { points: t1.total, detail: t1.detail };
  } else {
    room.state.melds.team0 = { points: 0, detail: [] };
    room.state.melds.team1 = { points: 0, detail: [] };
  }

  // belote holders
  const holders = new Set();
  for (let seat=0; seat<4; seat++){
    const pid = room.seats[seat].id;
    const cards = room.state.hands.get(pid);
    if (cards.includes("K"+room.state.trumpSuit) && cards.includes("Q"+room.state.trumpSuit)){
      holders.add(pid);
    }
  }
  room.state.melds.beloteHolders = holders;
  room.state.melds.beloteAwarded = new Set();
}

// -------------------- trick play rules --------------------
function currentTrickWinner(trick, trumpSuit){
  if (trick.plays.length === 0) return null;
  const leadSuit = parseCard(trick.plays[0].card).suit;
  let win = trick.plays[0];
  for (const p of trick.plays.slice(1)){
    if (isHigher(p.card, win.card, leadSuit, trumpSuit)) win = p;
  }
  return win;
}

function legalPlays(room, seat){
  const s = room.state;
  const pid = room.seats[seat].id;
  const hand = s.hands.get(pid) || [];
  if (s.phase !== "trick") return [];
  const trick = s.trick;
  if (!trick || trick.plays.length === 0) return [...hand]; // lead anything

  const leadSuit = parseCard(trick.plays[0].card).suit;
  const trumpSuit = s.trumpSuit;

  const hasLead = hand.filter(c => parseCard(c).suit === leadSuit);
  if (hasLead.length > 0){
    // must follow suit; if suit is trump, must overtrump if possible (handled below)
    if (leadSuit === trumpSuit){
      const currentWinner = currentTrickWinner(trick, trumpSuit);
      const winningTrump = currentWinner.card;
      const higherTrumps = hasLead.filter(c => isHigher(c, winningTrump, leadSuit, trumpSuit));
      if (higherTrumps.length > 0) return higherTrumps; // must overtrump if can
    }
    return hasLead;
  }

  // no lead suit -> check if must trump
  const trumps = hand.filter(c => parseCard(c).suit === trumpSuit);
  if (trumps.length === 0) return [...hand]; // can discard

  const currentWinner = currentTrickWinner(trick, trumpSuit);
  const winnerSeat = currentWinner.seat;
  const winnerTeam = TEAM_OF_SEAT(winnerSeat);
  const yourTeam = TEAM_OF_SEAT(seat);

  if (winnerTeam === yourTeam){
    // partner winning -> you may discard any card (Armenian rule)
    return [...hand];
  }

  // opponents winning -> must trump; must overtrump if possible
  const leadSuitForCompare = leadSuit; // used in isHigher
  const higher = trumps.filter(c => isHigher(c, currentWinner.card, leadSuitForCompare, trumpSuit));
  if (higher.length > 0) return higher;
  return trumps;
}

function playCard(room, seat, card){
  const s = room.state;
  if (s.phase !== "trick") return { ok:false, error:"Not in trick phase." };
  if (seat !== s.turnSeat) return { ok:false, error:"Not your turn." };
  const pid = room.seats[seat].id;
  const hand = s.hands.get(pid) || [];
  if (!hand.includes(card)) return { ok:false, error:"You don't have that card." };

  const legal = legalPlays(room, seat);
  if (!legal.includes(card)) return { ok:false, error:"Illegal play (follow suit / trump / overtrump rules)." };

  // remove from hand
  s.hands.set(pid, hand.filter(c => c !== card));

  // add to trick
  s.trick.plays.push({ seat, card });

  // belote/rebelote auto-award: if holder plays both K/Q of trump across hand, award 20 once second is played
  if (s.melds.beloteHolders.has(pid) && parseCard(card).suit === s.trumpSuit){
    const r = parseCard(card).rank;
    if (r === "K" || r === "Q"){
      // check if both were played by this pid in any trick so far
      const played = [];
      for (const t of s._playedLog || []){
        if (t.pid === pid) played.push(t.card);
      }
      played.push(card);
      const hasK = played.includes("K"+s.trumpSuit);
      const hasQ = played.includes("Q"+s.trumpSuit);
      if (hasK && hasQ && !s.melds.beloteAwarded.has(pid)){
        s.melds.beloteAwarded.add(pid);
        // award directly into melds of that player's team
        const team = TEAM_OF_SEAT(seat);
        if (team === 0) s.melds.team0.points += 20;
        else s.melds.team1.points += 20;
      }
    }
  }

  // log for belote tracking
  s._playedLog = s._playedLog || [];
  s._playedLog.push({ pid, card });

  if (s.trick.plays.length === 4){
    // resolve trick
    const winner = currentTrickWinner(s.trick, s.trumpSuit);
    const winTeam = TEAM_OF_SEAT(winner.seat);
    s.tricksCount[winTeam] += 1;
    s.lastTrickWinnerTeam = winTeam;

    // collect cards
    for (const p of s.trick.plays){
      s.tricksWon[winTeam].push(p.card);
    }

    // if last trick
    const remaining = [...s.hands.values()].reduce((acc, arr)=>acc + arr.length, 0);
    if (remaining === 0){
      // end hand
      s.phase = "scoring";
      scoreHand(room);
      return { ok:true, trickComplete:true, handEnded:true };
    }

    // next trick: winner leads
    s.trick = { leadSeat: winner.seat, plays: [] };
    setTurn(room, winner.seat);
    return { ok:true, trickComplete:true, winnerSeat: winner.seat };
  }

  // next turn
  setTurn(room, nextSeat(seat));
  return { ok:true };
}

function scoreHand(room){
  const s = room.state;
  const trump = s.trumpSuit;
  const teamPoints = [0,0];

  for (let team=0; team<2; team++){
    const cards = s.tricksWon[team];
    let pts = 0;
    for (const c of cards) pts += cardPoints(c, trump);
    teamPoints[team] = pts;
  }

  // last trick bonus
  if (s.lastTrickWinnerTeam !== null) teamPoints[s.lastTrickWinnerTeam] += 10;

  // add meld points
  teamPoints[0] += s.melds.team0.points;
  teamPoints[1] += s.melds.team1.points;

  // contract check
  let declarer = s.declarerTeam;
  let made = false;
  if (s.contract.type === "capot"){
    made = (s.tricksCount[declarer] === 8);
  } else {
    made = (teamPoints[declarer] >= s.contract.bid);
  }

  let awarded = [0,0];
  const totalHand = teamPoints[0] + teamPoints[1];

  if (made){
    awarded = [...teamPoints];
  } else {
    // defenders get everything
    const defenders = declarer === 0 ? 1 : 0;
    awarded[defenders] = totalHand;
    awarded[declarer] = 0;
  }

  // contra multiplier
  awarded[0] *= s.contra;
  awarded[1] *= s.contra;

  // update totals
  s.totals[0] += awarded[0];
  s.totals[1] += awarded[1];

  // determine game end
  const target = room.settings.targetScore;
  if (s.totals[0] >= target || s.totals[1] >= target){
    s.phase = "finished";
  } else {
    // next hand: reset ready but keep players
    s.phase = "lobby";
    s.ready = new Set();
  }

  // send scoring breakdown
  broadcastRoom(room.id, {
    t:"hand:scored",
    breakdown: {
      trumpSuit: s.trumpSuit,
      contract: s.contract,
      declarerTeam: s.declarerTeam,
      contra: s.contra,
      tricksCount: s.tricksCount,
      melds: { team0: s.melds.team0, team1: s.melds.team1 },
      teamPointsRaw: teamPoints,
      awarded
    },
    totals: s.totals,
    phase: s.phase
  });
}

// -------------------- bidding / contra --------------------
function handleBid(room, seat, bidMsg){
  const s = room.state;
  if (s.phase !== "bidding") return { ok:false, error:"Not in bidding." };
  if (seat !== s.bidding.turnSeat) return { ok:false, error:"Not your turn." };

  const type = String(bidMsg.type || "points");
  const suit = String(bidMsg.suit || "").toUpperCase();
  if (!SUITS.includes(suit)) return { ok:false, error:"Bad suit." };

  if (type === "capot"){
    // capot ends bidding unless other side also bids capot later (we allow overcall capot only if not already capot)
    if (s.bidding.highestBid && s.bidding.highestBid.type === "capot"){
      // allow capot overcall only by other team? We'll allow any higher == capot (same), but last capot stands.
    }
    s.bidding.highestBid = { type:"capot", suit };
    s.bidding.highestBidderSeat = seat;
    s.bidding.passesInRow = 0;
  } else {
    let bid = Number(bidMsg.bid);
    if (!Number.isFinite(bid)) return { ok:false, error:"Bad bid." };
    // bids are in tens; enforce 80..160 step 10
    if (bid % 10 !== 0 || bid < 80 || bid > 160) return { ok:false, error:"Bid must be 80..160 in tens." };
    // must be higher than current highest points bid (capot is higher than any points)
    if (s.bidding.highestBid){
      if (s.bidding.highestBid.type === "capot"){
        return { ok:false, error:"Can't overcall a capot with points." };
      }
      if (bid <= s.bidding.highestBid.bid) return { ok:false, error:"Bid must be higher than current." };
    }
    s.bidding.highestBid = { type:"points", bid, suit };
    s.bidding.highestBidderSeat = seat;
    s.bidding.passesInRow = 0;
  }

  // log
  s.bidLog.push({ seat, action: "bid", bid: s.bidding.highestBid, ts: now() });

  // advance
  s.bidding.turnSeat = nextSeat(seat);
  setTurn(room, s.bidding.turnSeat);

  return { ok:true };
}

function handlePass(room, seat){
  const s = room.state;
  if (s.phase !== "bidding") return { ok:false, error:"Not in bidding." };
  if (seat !== s.bidding.turnSeat) return { ok:false, error:"Not your turn." };

  s.bidding.passesInRow += 1;

  s.bidLog.push({ seat, action: "pass", ts: now() });
  s.bidding.turnSeat = nextSeat(seat);
  setTurn(room, s.bidding.turnSeat);

  // if 3 passes after a bid -> end; if 4 passes with no bid -> redeal handled in endBidding
  const noBidYet = !s.bidding.highestBid;
  if (noBidYet && s.bidding.passesInRow >= 4){
    endBidding(room);
  } else if (!noBidYet && s.bidding.passesInRow >= 3){
    endBidding(room);
  }
  return { ok:true };
}

function handleContra(room, seat){
  const s = room.state;
  if (s.phase !== "bidding") return { ok:false, error:"Contra only during bidding end." };
  if (!s.bidding.highestBid) return { ok:false, error:"No bid to contra." };
  // Only opponents of current highest bidder can contra
  const hbTeam = TEAM_OF_SEAT(s.bidding.highestBidderSeat);
  const yourTeam = TEAM_OF_SEAT(seat);
  if (hbTeam === yourTeam) return { ok:false, error:"You can't contra your own bid." };
  if (s.contra !== 1) return { ok:false, error:"Already contra/recontra set." };
  s.contra = 2;
  s.bidLog.push({ seat, action: "contra", ts: now() });
  // lock bidding immediately
  endBidding(room);
  return { ok:true };
}

function handleRecontra(room, seat){
  const s = room.state;
  if (s.phase !== "declarations" && s.phase !== "trick" && s.phase !== "bidding") return { ok:false, error:"Bad timing." };
  // We allow recontra only if contra=2 and you're declarer team before first trick starts
  if (s.contra !== 2) return { ok:false, error:"No contra to recontra." };
  if (s.declarerTeam === null) return { ok:false, error:"No declarer." };
  const yourTeam = TEAM_OF_SEAT(seat);
  if (yourTeam !== s.declarerTeam) return { ok:false, error:"Only declarers can recontra." };
  if (s.phase === "trick" && s.trick && s.trick.plays.length > 0) return { ok:false, error:"Too late (already played)." };
  s.contra = 4;
  s.bidLog.push({ seat, action: "recontra", ts: now() });
  return { ok:true };
}

// -------------------- game start from lobby --------------------
function startGame(room){
  room.state = makeInitialGameState();
  room.state.totals = [0,0];
  room.state.dealerSeat = 0;
  room.state.ready = new Set(room.state.ready); // empty
  startHand(room);
  // move to trick immediately after bidding ends; declarations are auto-handled server-side
  room.state.phase = "bidding"; // startHand set this
}

// -------------------- websocket --------------------
wss.on("connection", (ws)=>{
  // provisional identity until auth:hello
  const tmpId = nanoid(10);
  clients.set(ws, { id: tmpId, name: `Player-${tmpId.slice(0,4)}`, roomId:null, seat:null, token:null, authed:false });

  send(ws, { t:"hello", needAuth:true, rooms: listPublicRooms() });

  ws.on("message", (data)=>{
    let msg;
    try { msg = JSON.parse(String(data)); }
    catch { return send(ws, { t:"error", error:"Bad JSON." }); }

    const info = clients.get(ws);
    if (!info) return;

    // Require auth first (stable player id for reconnect)
    if (!info.authed && msg.t !== "auth:hello"){
      return send(ws, { t:"error", error:"Not authenticated yet. Send auth:hello first." });
    }

    const room = info.roomId ? rooms.get(info.roomId) : null;

    switch(msg.t){

      case "auth:hello": {
        const ident = getOrCreateIdentity(msg.token, msg.name);
        info.id = ident.id;
        info.name = ident.name;
        info.token = ident.token;
        info.authed = true;

        // cancel any purge timer for this player (they came back)
        if (purgeTimers.has(info.id)){
          clearTimeout(purgeTimers.get(info.id));
          purgeTimers.delete(info.id);
        }

        // Auto-rejoin last room/seat if possible
        const t = tokens.get(info.token);
        if (t?.roomId && rooms.has(t.roomId)){
          const r = rooms.get(t.roomId);
          const idx = seatIndexForPlayer(r, info.id);
          if (idx !== -1){
            // reclaim seat
            r.seats[idx].name = info.name;
            delete r.seats[idx].disconnectedAt;
            info.roomId = r.id;
            info.seat = idx;
            broadcastRoom(r.id, { t:"room:update", room: roomSummary(r) });
            broadcastRoom(r.id, { t:"game:state", state: publicGameState(r, null) });
          }
        }

        send(ws, { t:"auth:ok", you:{ id: info.id, name: info.name, token: info.token }, rooms: listPublicRooms() });
        // if already in room, send state
        if (info.roomId){
          const r = rooms.get(info.roomId);
          if (r){
            send(ws, { t:"room:update", room: roomSummary(r) });
            send(ws, { t:"game:state", state: publicGameState(r, info.id) });
          }
        }
        break;
      }

      case "voice:offer":
      case "voice:answer":
      case "voice:ice": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const to = String(msg.to || "");
        if (!to) return send(ws, { t:"error", error:"Missing 'to'." });
        const target = wsForPlayer(room.id, to);
        if (!target) return send(ws, { t:"error", error:"Target not connected." });
        // only allow voice between seated players
        const fromSeat = seatIndexForPlayer(room, info.id);
        const toSeat = seatIndexForPlayer(room, to);
        if (fromSeat === -1 || toSeat === -1) return send(ws, { t:"error", error:"Voice is for seated players only." });

        const payload = { t: msg.t, from: info.id };
        if (msg.t === "voice:offer") payload.offer = msg.offer;
        if (msg.t === "voice:answer") payload.answer = msg.answer;
        if (msg.t === "voice:ice") payload.candidate = msg.candidate;
        send(target, payload);
        break;
      }


      case "profile:set": {
        const name = String(msg.name||"").trim().slice(0,20) || info.name;
        info.name = name;
        send(ws, { t:"profile:ok", you:{ id:info.id, name:info.name } });
        // update seat name
        if (room){
          const si = seatIndexForPlayer(room, info.id);
          if (si !== -1) room.seats[si].name = name;
          broadcastRoom(room.id, { t:"room:update", room: roomSummary(room) });
          broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, info.id) });
        }
        break;
      }

      case "rooms:list":
        send(ws, { t:"rooms:list", rooms: listPublicRooms() });
        break;

      case "room:create": {
        const r = makeRoom({
          targetScore: Number(msg.targetScore)||301,
          turnSeconds: Number(msg.turnSeconds)||20,
          isPrivate: Boolean(msg.isPrivate),
          password: String(msg.password||"").slice(0,32)
        });
        rooms.set(r.id, r);
        send(ws, { t:"room:created", room: roomSummary(r) });
        break;
      }

      case "room:join": {
        const roomId = String(msg.roomId||"").toUpperCase();
        const password = String(msg.password||"");
        const jr = joinRoom(ws, roomId, { password });
        if (!jr.ok) send(ws, { t:"room:join:error", error: jr.error });
        else {
          send(ws, { t:"room:join:ok", room: jr.room });
          // send game state
          const r = rooms.get(roomId);
          send(ws, { t:"game:state", state: publicGameState(r, info.id) });
        }
        break;
      }

      case "room:leave": {
        if (room) removeFromRoom(ws);
        send(ws, { t:"room:left" });
        send(ws, { t:"rooms:list", rooms: listPublicRooms() });
        break;
      }

      case "match:quick": {
        const jr = quickMatch(ws, {
          targetScore: Number(msg.targetScore)||301,
          turnSeconds: Number(msg.turnSeconds)||20,
          isPrivate:false
        });
        if (!jr.ok) send(ws, { t:"match:error", error: jr.error });
        else {
          send(ws, { t:"room:join:ok", room: jr.room });
          const r = rooms.get(jr.room.id);
          send(ws, { t:"game:state", state: publicGameState(r, info.id) });
        }
        break;
      }

      case "room:ready": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        if (seat === -1) return send(ws, { t:"error", error:"Spectators can't ready." });

        const isReady = Boolean(msg.ready);
        if (isReady) room.state.ready.add(info.id);
        else room.state.ready.delete(info.id);

        broadcastRoom(room.id, { t:"room:ready:update", ready: Array.from(room.state.ready) });

        if (canStart(room)){
          startGame(room);
          broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
          // personalized state (hands)
          for (const [w, inf] of clients.entries()){
            if (inf.roomId === room.id){
              send(w, { t:"game:state", state: publicGameState(room, inf.id) });
            }
          }
        }
        break;
      }

      case "chat:send": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const text = String(msg.text||"").trim().slice(0,300);
        if (!text) return;
        const entry = { id:nanoid(8), from:{ id:info.id, name:info.name }, text, ts: now() };
        room.chat.push(entry);
        room.chat = room.chat.slice(-100);
        broadcastRoom(room.id, { t:"chat:new", entry });
        break;
      }

      // ---------- game actions ----------
      case "game:bid": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        const r = handleBid(room, seat, msg);
        if (!r.ok) return send(ws, { t:"game:error", error: r.error });
        broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        // personalized hands
        for (const [w, inf] of clients.entries()){
          if (inf.roomId === room.id){
            send(w, { t:"game:state", state: publicGameState(room, inf.id) });
          }
        }
        // if bidding ended via endBidding, phase will move; push state
        break;
      }

      case "game:pass": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        const r = handlePass(room, seat);
        if (!r.ok) return send(ws, { t:"game:error", error: r.error });
        // if bidding ended, move into trick phase automatically now:
        if (room.state.phase === "declarations"){
          room.state.phase = "trick";
        }
        broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        for (const [w, inf] of clients.entries()){
          if (inf.roomId === room.id){
            send(w, { t:"game:state", state: publicGameState(room, inf.id) });
          }
        }
        break;
      }

      case "game:contra": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        const r = handleContra(room, seat);
        if (!r.ok) return send(ws, { t:"game:error", error: r.error });
        // after contra ends bidding, go into trick
        if (room.state.phase === "declarations") room.state.phase = "trick";
        broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        for (const [w, inf] of clients.entries()){
          if (inf.roomId === room.id){
            send(w, { t:"game:state", state: publicGameState(room, inf.id) });
          }
        }
        break;
      }

      case "game:recontra": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        const r = handleRecontra(room, seat);
        if (!r.ok) return send(ws, { t:"game:error", error: r.error });
        broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        for (const [w, inf] of clients.entries()){
          if (inf.roomId === room.id){
            send(w, { t:"game:state", state: publicGameState(room, inf.id) });
          }
        }
        break;
      }

      case "game:play": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        const card = String(msg.card||"");
        const r = playCard(room, seat, card);
        if (!r.ok) return send(ws, { t:"game:error", error: r.error });

        // broadcast state updates (public + per-player hands)
        broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        for (const [w, inf] of clients.entries()){
          if (inf.roomId === room.id){
            send(w, { t:"game:state", state: publicGameState(room, inf.id) });
          }
        }
        break;
      }

      case "game:legal": {
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        const seat = seatIndexForPlayer(room, info.id);
        const legal = legalPlays(room, seat);
        send(ws, { t:"game:legal", legal });
        break;
      }

      case "game:next": {
        // after scoring, players ready again; this just starts next hand if phase lobby and all seated present
        if (!room) return send(ws, { t:"error", error:"Not in a room." });
        if (room.state.phase !== "lobby") return send(ws, { t:"game:error", error:"Not ready for next hand." });
        // require 4 seated
        if (room.seats.filter(Boolean).length !== 4) return send(ws, { t:"game:error", error:"Need 4 players." });
        // keep totals, rotate dealer, start hand
        const totals = room.state.totals;
        const dealer = room.state.dealerSeat;
        room.state = makeInitialGameState();
        room.state.totals = totals;
        room.state.dealerSeat = dealer;
        startHand(room);
        broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        for (const [w, inf] of clients.entries()){
          if (inf.roomId === room.id){
            send(w, { t:"game:state", state: publicGameState(room, inf.id) });
          }
        }
        break;
      }

      default:
        send(ws, { t:"error", error:"Unknown message type." });
    }
  });

  ws.on("close", ()=>{
    const info = clients.get(ws);

    if (info?.authed && info?.token && tokens.has(info.token)){
      const t = tokens.get(info.token);
      t.lastSeen = now();
      t.roomId = info.roomId;
      t.seat = info.seat;
      t.name = info.name;
    }

    if (info?.roomId){
      const room = rooms.get(info.roomId);
      if (room){
        const idx = seatIndexForPlayer(room, info.id);
        if (idx !== -1){
          // keep the seat for a short grace period
          markDisconnected(room, info.id);
          broadcastRoom(room.id, { t:"room:update", room: roomSummary(room) });
          broadcastRoom(room.id, { t:"game:state", state: publicGameState(room, null) });
        } else {
          // spectator disconnect
          room.spectators = room.spectators.filter(x => x.id !== info.id);
          broadcastRoom(room.id, { t:"room:update", room: roomSummary(room) });
        }
      }
    }
    clients.delete(ws);
  });
});

server.listen(PORT, ()=>{
  console.log(`Server running on http://localhost:${PORT}`);
});
