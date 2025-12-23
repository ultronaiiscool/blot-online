export const state = {
  user: null,
  phase: "MENU", // MENU | LOBBY | BIDDING | PLAY
  socket: null,
  room: null,
  roomState: null,
  bidState: null,
  gameState: null,
  joinOpen: false,
  joinCode: "",
  lang: localStorage.getItem("lang") || "en",
  micAllowed: JSON.parse(localStorage.getItem("micAllowed") || "false"),
  muted: JSON.parse(localStorage.getItem("muted") || "{}"),
  rulesDraft: JSON.parse(localStorage.getItem("rulesDraft") || "null")
};
