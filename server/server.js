require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const { WebSocketServer } = require("ws");
const initGoogleAuth = require("./auth/google");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname,"..","public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave:false,
  saveUninitialized:false
}));
app.use(passport.initialize());
app.use(passport.session());
initGoogleAuth(app);

app.get("/me",(req,res)=>{
  if(!req.user) return res.status(401).json({ok:false});
  res.json({ok:true,user:req.user});
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --------- Blot/Belote core (simplified but team-based) ----------
const SUITS = ["hearts","diamonds","clubs","spades"];
const RANKS = ["A","10","K","Q","J","9","8","7"]; // for display
const NON_TRUMP_ORDER = ["A","10","K","Q","J","9","8","7"]; // winning order within lead suit
const TRUMP_ORDER = ["J","9","A","10","K","Q","8","7"];

const NON_TRUMP_POINTS = {A:11,"10":10,K:4,Q:3,J:2,"9":0,"8":0,"7":0};
const TRUMP_POINTS = {J:20,"9":14,A:11,"10":10,K:4,Q:3,"8":0,"7":0};

const LAST_TRICK_BONUS = 10;
const BELOTE_BONUS = 20;

const MODES = {
  SUIT: "SUIT",
  NO_TRUMP: "NO_TRUMP",
  ALL_TRUMP: "ALL_TRUMP"
};

function sortRankForSequence(r){
  const order = ["A","K","Q","J","10","9","8","7"];
  return order.indexOf(r);
}
function seqValue(len){
  if(len >= 5) return 100;
  if(len === 4) return 50;
  if(len === 3) return 20;
  return 0;
}
function meldsForHand(hand){
  const bySuit = {};
  for(const c of hand){
    bySuit[c.s] ||= [];
    bySuit[c.s].push(c.r);
  }
  let points = 0;
  const details = [];

  for(const suit of Object.keys(bySuit)){
    const ranks = [...new Set(bySuit[suit])].sort((a,b)=>sortRankForSequence(a)-sortRankForSequence(b));
    let run = [];
    for(let i=0;i<ranks.length;i++){
      if(i===0){ run=[ranks[i]]; continue; }
      const prev = sortRankForSequence(ranks[i-1]);
      const cur = sortRankForSequence(ranks[i]);
      if(cur === prev+1) run.push(ranks[i]);
      else {
        if(run.length>=3){
          const v = seqValue(run.length);
          points += v;
          details.push({type:"sequence", suit, length:run.length, points:v, ranks:[...run]});
        }
        run=[ranks[i]];
      }
    }
    if(run.length>=3){
      const v = seqValue(run.length);
      points += v;
      details.push({type:"sequence", suit, length:run.length, points:v, ranks:[...run]});
    }
  }

  const counts = {};
  for(const c of hand) counts[c.r] = (counts[c.r]||0)+1;
  for(const r of Object.keys(counts)){
    if(counts[r]===4){
      let v=0;
      if(r==="J") v=200;
      else if(r==="9") v=150;
      else if(["A","10","K","Q"].includes(r)) v=100;
      if(v){
        points += v;
        details.push({type:"four", rank:r, points:v});
      }
    }
  }
  return {points, details};
}

function makeDeck(){
  const deck=[];
  for(const s of SUITS){
    for(const r of RANKS){
      deck.push({r,s,id:`${r}_of_${s}`});
    }
  }
  return deck;
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function roomCode(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }

const rooms = new Map();
const ADMIN_LOG = [];
const BANNED_USERS = new Set();

function logAdmin(action, payload){
  ADMIN_LOG.push({
    time: new Date().toISOString(),
    action,
    payload
  });
  if(ADMIN_LOG.length > 500) ADMIN_LOG.shift();
}


function teamOf(room, pid){
  const idx = room.seats.indexOf(pid);
  return (idx % 2 === 0) ? "A" : "B"; // seats 0&2 vs 1&3
}
function nextSeat(room, pid){
  const i = room.seats.indexOf(pid);
  return room.seats[(i+1) % room.seats.length];
}

let botCounter = 1;
function addBot(room){
  const id = `bot-${botCounter++}`;
  room.players.set(id,{id,name:`Bot ${botCounter-1}`,bot:true,ws:null});
  room.seats.push(id);
}
function ensureBots(room){
  while(room.seats.length < 4) addBot(room);
}

function broadcastRoom(room){
  const payload = {
    type:"room:state",
    room:{
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      target: room.target,
      scores: room.scores,
      rules: room.rules,
      ready: room.ready,
      players: room.seats.map(pid=>{
        const p=room.players.get(pid);
        return {id:p.id,name:p.name,bot:!!p.bot};
      })
    }
  };
  for(const pid of room.seats){
    const p=room.players.get(pid);
    if(p?.ws?.readyState===1) p.ws.send(JSON.stringify(payload));
  }
}

function sendTo(room, pid, msg){
  const p=room.players.get(pid);
  if(p?.ws?.readyState===1) p.ws.send(JSON.stringify(msg));
}

function broadcastBid(room){
  const b = room.bid;
  const payloadPublic = {
    type:"bid:state",
    bid:{
      turn: b.turn,
      dealer: b.dealer,
      highest: b.highest, // {pid,suit,contract} or null
      passed: b.passed,
      round: room.round,
      scores: room.scores,
      seats: room.seats.map(id=>{
        const p=room.players.get(id);
        return {id:p.id,name:p.name,bot:!!p.bot};
      })
    }
  };
  for(const pid of room.seats){
    const p=room.players.get(pid);
    if(p?.ws?.readyState===1) p.ws.send(JSON.stringify(payloadPublic));
  }
}

function broadcastGame(room){
  const g = room.game;
  if(!g) return;
  for(const pid of room.seats){
    const p=room.players.get(pid);
    if(!p?.ws || p.ws.readyState!==1) continue;
    const hand = g.hands[pid] || [];
    p.ws.send(JSON.stringify({
      type:"game:state",
      game:{
        phase: room.phase,
        turn: g.turn,
        leader: g.leader,
        trump: g.trump,
        contract: g.contract,
        contractor: g.contractor,
        trick: g.trick,
        leadSuit: g.leadSuit,
        trickCount: g.trickCount,
        roundPoints: g.roundPoints,
        scores: room.scores,
        seats: room.seats,
        players: room.seats.map(id=>{
          const pl=room.players.get(id);
          return {id:pl.id,name:pl.name,bot:!!pl.bot};
        }),
        yourHand: p.bot ? [] : hand
      }
    }));
  }
}

function cardPoints(card, trump){
  if(card.s === trump) return TRUMP_POINTS[card.r] ?? 0;
  return NON_TRUMP_POINTS[card.r] ?? 0;
}

function compareCards(a,b, leadSuit, mode, trump){
  // returns true if a beats b
  const aTrump = (mode===MODES.ALL_TRUMP) ? true : (mode===MODES.SUIT ? a.s === trump : false);
  const bTrump = (mode===MODES.ALL_TRUMP) ? true : (mode===MODES.SUIT ? b.s === trump : false);
  if(aTrump && !bTrump) return true;
  if(!aTrump && bTrump) return false;

  // both trump
  if(aTrump && bTrump){
    return TRUMP_ORDER.indexOf(a.r) < TRUMP_ORDER.indexOf(b.r);
  }

  // neither trump: must be lead suit to matter
  const aLead = a.s === leadSuit;
  const bLead = b.s === leadSuit;
  if(aLead && !bLead) return true;
  if(!aLead && bLead) return false;
  if(!aLead && !bLead){
    // In ALL_TRUMP, any suit can win since all are treated as trump.
    if(mode===MODES.ALL_TRUMP){
      return TRUMP_ORDER.indexOf(a.r) < TRUMP_ORDER.indexOf(b.r);
    }
    return false; // off-suit can't beat lead in NO_TRUMP/SUIT simplified rules
  }

  return NON_TRUMP_ORDER.indexOf(a.r) < NON_TRUMP_ORDER.indexOf(b.r);
}

function legalCards(hand, leadSuit, mode, trump){
  if(!leadSuit) return hand;

  const sameSuit = hand.filter(c=>c.s===leadSuit);
  if(sameSuit.length) return sameSuit;

  // if can't follow suit, must trump only in SUIT mode (simplified)
  if(mode===MODES.SUIT){
    const trumps = hand.filter(c=>c.s===trump);
    if(trumps.length) return trumps;
  }

  return hand;
}

function resolveTrick(room){
  const g = room.game;
  const leadSuit = g.leadSuit;
  let best = g.trick[0];
  for(const play of g.trick.slice(1)){
    if(compareCards(play.card, best.card, leadSuit, g.mode, g.trump)) best = play;
  }
  const winnerPid = best.pid;
  const winnerTeam = teamOf(room, winnerPid);

  let pts = 0;
  for(const play of g.trick) pts += cardPoints(play.card, g.trump);
  // last trick bonus
  if(g.trickCount === 7) pts += LAST_TRICK_BONUS;

  g.roundPoints[winnerTeam] += pts;

  g.trick = [];
  g.leadSuit = null;
  g.leader = winnerPid;
  g.turn = winnerPid;
  g.trickCount += 1;

  if(g.trickCount >= 8){
    // round end: apply contract
    const contractorTeam = teamOf(room, g.contractor);
    const defTeam = contractorTeam === "A" ? "B" : "A";

    const contractorPts = g.roundPoints[contractorTeam];
    const defPts = g.roundPoints[defTeam];

    const mult = g.coincheLevel || 1;
    if(contractorPts >= g.contract){
      room.scores[contractorTeam] += (contractorPts * mult);
      room.scores[defTeam] += (defPts * mult);
    } else {
      // failed contract: defenders take all trick points (but keep belote attribution already in roundPoints)
      room.scores[defTeam] += ((contractorPts + defPts) * mult);
    }

    room.phase = "LOBBY";
    room.game = null;
    room.bid = null;

    broadcastRoom(room);
    // notify end
    for(const pid of room.seats){
      sendTo(room, pid, {type:"round:end", scores: room.scores, target: room.target});
    }
    return;
  }
}

function maybeBelote(room, pid, card){
  // Belote/Rebelote: K+Q of trump in same hand, awarded once to contractor team when either is played first time.
  const g = room.game;
  if(!g || !g.trump) return;
  if(card.s !== g.trump) return;
  if(card.r !== "K" && card.r !== "Q") return;
  if(g.beloteAwarded) return;

  const hand = g.hands[pid] || [];
  const hasOther = hand.some(c=>c.s===g.trump && c.r === (card.r==="K" ? "Q" : "K"));
  if(hasOther){
    const team = teamOf(room, pid);
    g.roundPoints[team] += BELOTE_BONUS;
    g.beloteAwarded = true;
  }
}

function playCard(room, pid, cardId){
  if(room.phase !== "PLAY") return;
  const g = room.game;
  if(g.turn !== pid) return;

  const hand = g.hands[pid];
  const idx = hand.findIndex(c=>c.id===cardId);
  if(idx === -1) return;

  const card = hand[idx];
  const legal = legalCards(hand, g.leadSuit, g.mode, g.trump).map(c=>c.id);
  if(!legal.includes(cardId)) return;

  hand.splice(idx,1);
  g.trick.push({pid, card});
  if(!g.leadSuit) g.leadSuit = card.s;

  maybeBelote(room, pid, card);

  if(g.trick.length === 4){
    resolveTrick(room);
    broadcastGame(room);
    maybeBotPlay(room);
    return;
  }
  g.turn = nextSeat(room, pid);
  broadcastGame(room);
  maybeBotPlay(room);
}

function botChoose(room, pid){
  const g = room.game;
  const hand = g.hands[pid];
  const legal = legalCards(hand, g.leadSuit, g.mode, g.trump);
  // tiny bit smarter: prefer higher point cards if leading, else random
  const scored = legal.map(c=>({c, p: cardPoints(c, g.trump)})).sort((a,b)=>b.p-a.p);
  if(Math.random()<0.55) return scored[0].c;
  return legal[Math.floor(Math.random()*legal.length)];
}

function maybeBotPlay(room){
  if(room.phase !== "PLAY") return;
  const g = room.game;

  function step(){
    const pid = g.turn;
    const p = room.players.get(pid);
    if(!p || !p.bot) return;

    const chosen = botChoose(room, pid);
    setTimeout(()=>{
      playCard(room, pid, chosen.id);
      if(room.phase === "PLAY") step();
    }, 450);
  }
  step();
}

function startBidding(room){
  room.phase = "BIDDING";
  room.round = (room.round || 0) + 1;
  const dealer = room.dealer || room.hostId;
  room.bid = {
    dealer,
    turn: nextSeat(room, dealer),
    highest: null,
    passed: {},
    doneCount: 0
  };
  broadcastRoom(room);
  broadcastBid(room);
  maybeBotBid(room);
}

function setTrumpAndDeal(room, contractorPid, mode, trumpSuit, contract, coincheLevel=1){
  room.phase = "PLAY";
  const deck = shuffle(makeDeck());
  const hands = {};
  for(const pid of room.seats) hands[pid] = deck.splice(0,8);

  room.game = {
    meldState: { announced: {}, done: false },
    hands,
    mode,
    trump: (mode===MODES.SUIT ? trumpSuit : null),
    contract: contract,
    coincheLevel,
    contractor: contractorPid,
    leader: contractorPid,
    turn: contractorPid,
    trick: [],
    leadSuit: null,
    trickCount: 0,
    roundPoints: {A:0,B:0},
    beloteAwarded: false
  };

    // Optional: meld scoring
  if(room.rules.allowMelds){
    if(room.rules.autoMelds){
      const meldA = room.seats.filter((pid,idx)=>idx%2===0).reduce((sum,pid)=>sum+meldsForHand(hands[pid]).points,0);
      const meldB = room.seats.filter((pid,idx)=>idx%2===1).reduce((sum,pid)=>sum+meldsForHand(hands[pid]).points,0);
      room.game.roundPoints.A += meldA;
      room.game.roundPoints.B += meldB;
      room.game.melds = {A: meldA, B: meldB};
    } else {
      room.game.melds = {A:0,B:0};
    }
  } else {
    room.game.melds = {A:0,B:0};
  }

  broadcastRoom(room);
  broadcastGame(room);
  maybeBotPlay(room);
}

function advanceBidTurn(room){
  const b = room.bid;
  const current = b.turn;
  b.turn = nextSeat(room, current);

  // if we've come back to dealer and everyone passed and no highest => force dealer to bid random trump
  const allPassed = room.seats.every(pid=>b.passed[pid]);
  if(allPassed && !b.highest){
    const forced = b.turn; // dealer+1 after rotation, but fine
    const suit = SUITS[Math.floor(Math.random()*SUITS.length)];
    b.highest = { pid: forced, mode: MODES.SUIT, trumpSuit: suit, contract: room.target === 301 ? 90 : 80, coincheLevel: 1 };
    setTrumpAndDeal(room, b.highest.pid, b.highest.mode, b.highest.trumpSuit, b.highest.contract, b.highest.coincheLevel);
    return;
  }

  // if bidding completed (everyone after highest has acted and back to highest)
  // Simple completion: once 4 actions after highest set, end.
  if(b.highest && b.doneCount >= 3){
    setTrumpAndDeal(room, b.highest.pid, b.highest.mode, b.highest.trumpSuit, b.highest.contract, b.highest.coincheLevel);
    return;
  }

  broadcastBid(room);
  maybeBotBid(room);
}

function bidAction(room, pid, action){
  if(room.phase !== "BIDDING") return;
  const b = room.bid;
  if(b.turn !== pid) return;

  b.doneCount = b.doneCount || 0;

  if(action.type === "pass"){
    b.passed[pid] = true;
    b.doneCount += (b.highest ? 1 : 0);
    advanceBidTurn(room);
    return;
  }

  if(action.type === "bid"){
    const mode = action.mode || MODES.SUIT;
    const contract = Number(action.contract || 80);
    const trumpSuit = (mode===MODES.SUIT) ? action.suit : null;
    if(!room.rules.allowModes.includes(mode)) return;
    if(mode===MODES.SUIT && !SUITS.includes(trumpSuit)) return;
    if(!Number.isFinite(contract) || contract < 80 || contract > 180) return;
    b.highest = { pid, mode, trumpSuit, contract, coincheLevel: 1 };
    b.passed[pid] = false;
    b.doneCount = 0;
    advanceBidTurn(room);
    return;
  }

  if(action.type === "coinche"){
    if(!room.rules.allowCoinche) return;
    if(!b.highest) return;
    const opp = teamOf(room, pid) !== teamOf(room, b.highest.pid);
    if(!opp) return;
    if(b.highest.coincheLevel !== 1) return;
    b.highest.coincheLevel = 2;
    b.doneCount += 1;
    advanceBidTurn(room);
    return;
  }

  if(action.type === "recoinche"){
    if(!room.rules.allowCoinche) return;
    if(!b.highest) return;
    const same = teamOf(room, pid) === teamOf(room, b.highest.pid);
    if(!same) return;
    if(b.highest.coincheLevel !== 2) return;
    b.highest.coincheLevel = 4;
    b.doneCount += 1;
    advanceBidTurn(room);
    return;
  }
}

function botBidChoice(room, pid){
  const b = room.bid;
  // If no bid yet, small chance to bid; if someone already bid, mostly pass
  if(!b.highest){
    if(Math.random() < 0.35){
      const modes = room.rules.allowModes;
      const mode = modes[Math.floor(Math.random()*modes.length)];
      const suit = SUITS[Math.floor(Math.random()*SUITS.length)];
      const contract = (room.target===301?90:80);
      return {type:"bid", mode, suit, contract};
    }
    return {type:"pass"};
  } else {
    if(room.rules.allowCoinche && Math.random()<0.10){
      const opp = teamOf(room, pid) !== teamOf(room, b.highest.pid);
      if(opp && b.highest.coincheLevel===1) return {type:"coinche"};
      const same = teamOf(room, pid) === teamOf(room, b.highest.pid);
      if(same && b.highest.coincheLevel===2) return {type:"recoinche"};
    }
    return {type:"pass"};
  }
}

function maybeBotBid(room){
  if(room.phase !== "BIDDING") return;
  const pid = room.bid.turn;
  const p = room.players.get(pid);
  if(!p?.bot) return;

  setTimeout(()=>{
    const act = botBidChoice(room, pid);
    bidAction(room, pid, act);
  }, 450);
}

// --------- WebSocket wiring ----------
wss.on("connection",(ws)=>{
  ws.meta = { id:null, name:null, room:null };

  ws.on("message",(raw)=>{
    let msg;
    try{ msg = JSON.parse(raw); } catch { return; }

    if(msg.type === "init"){
      ws.meta.id = msg.id;
      ws.meta.name = msg.name;
      return;
    }

    if(msg.type === "room:create"){
      if(!ws.meta.id) return ws.send(JSON.stringify({type:"error", message:"Not authenticated"}));
      const code = roomCode();
      const room = {
        code,
        hostId: ws.meta.id,
        target: 151,
        rules: {
          preset: 'ARMENIAN',
          allowModes: ['SUIT','NO_TRUMP','ALL_TRUMP'],
          allowCoinche: true,
          allowMelds: true,
          autoMelds: false,
          strictTrumping: false
        },
        scores: {A:0,B:0},
        ready: {},
        seats: [ws.meta.id],
        players: new Map([[ws.meta.id,{id:ws.meta.id,name:ws.meta.name,bot:false,ws}]]),
        phase: "LOBBY",
        dealer: ws.meta.id,
        round: 0
      };
      ensureBots(room);
      rooms.set(code, room);
      ws.meta.room = code;

      broadcastRoom(room);
      ws.send(JSON.stringify({type:"room:joined", code}));
      return;
    }

    if(msg.type === "room:join"){
      if(!ws.meta.id) return ws.send(JSON.stringify({type:"error", message:"Not authenticated"}));
      const code = (msg.code||"").toUpperCase();
      const room = rooms.get(code);
      if(!room) return ws.send(JSON.stringify({type:"error", message:"Room not found"}));

      // add human if not present and there is a bot to replace
      if(!room.seats.includes(ws.meta.id)){
        // replace first bot seat
        const botIndex = room.seats.findIndex(pid => room.players.get(pid)?.bot);
        if(botIndex === -1) return ws.send(JSON.stringify({type:"error", message:"Room full"}));
        const botId = room.seats[botIndex];
        room.players.delete(botId);
        room.seats[botIndex] = ws.meta.id;
      }
      room.players.set(ws.meta.id,{id:ws.meta.id,name:ws.meta.name,bot:false,ws});
      ws.meta.room = code;

      broadcastRoom(room);
      ws.send(JSON.stringify({type:"room:joined", code}));
      return;
    }

    if(msg.type === "room:leave"){
      const code = ws.meta.room;
      const room = rooms.get(code);
      if(!room) return;
      const idx = room.seats.indexOf(ws.meta.id);
      if(idx !== -1){
        room.players.delete(ws.meta.id);
        // replace leaving human with a bot to keep 4 seats
        const botId = `bot-${botCounter++}`;
        room.players.set(botId,{id:botId,name:`Bot ${botCounter-1}`,bot:true,ws:null});
        room.seats[idx] = botId;
      }
      ws.meta.room = null;

      // if host left, promote next non-bot
      if(room.hostId === ws.meta.id){
        const nextHuman = room.seats.find(pid => !room.players.get(pid)?.bot);
        room.hostId = nextHuman || room.seats[0];
      }
      broadcastRoom(room);
      return;
    }

    if(msg.type === "room:settings"){
      const code = ws.meta.room;
      const room = rooms.get(code);
      if(!room) return;
      if(room.hostId !== ws.meta.id) return;
      if([151,301,501,1001].includes(msg.target)) room.target = msg.target;
      if(msg.rules && typeof msg.rules === "object"){
        room.rules = {...room.rules, ...msg.rules};
      }
      broadcastRoom(room);
      return;
    }

    if(msg.type === "game:start"){
      const code = ws.meta.room;
      const room = rooms.get(code);
      if(!room) return;
      if(room.hostId !== ws.meta.id) return;

      // win condition check
      if(room.scores.A >= room.target || room.scores.B >= room.target){
        room.scores = {A:0,B:0};
      }

      // rotate dealer each round
      room.dealer = nextSeat(room, room.dealer || room.hostId);
      startBidding(room);
      return;
    }

    if(msg.type === "bid:act"){
      const room = rooms.get(ws.meta.room);
      if(!room) return;
      bidAction(room, ws.meta.id, msg.action);
      broadcastBid(room);
      return;
    }

    if(msg.type === "game:play"){
      const room = rooms.get(ws.meta.room);
      if(!room) return;
      playCard(room, ws.meta.id, msg.cardId);
      return;
    }
  });

  ws.on("close",()=>{
    const code = ws.meta.room;
    if(!code) return;
    const room = rooms.get(code);
    if(!room) return;
    const idx = room.seats.indexOf(ws.meta.id);
    if(idx !== -1){
      room.players.delete(ws.meta.id);
      // replace with bot
      const botId = `bot-${botCounter++}`;
      room.players.set(botId,{id:botId,name:`Bot ${botCounter-1}`,bot:true,ws:null});
      room.seats[idx] = botId;
      broadcastRoom(room);
    }
  });
});

server.listen(PORT, ()=>console.log("Server on http://localhost:"+PORT));
