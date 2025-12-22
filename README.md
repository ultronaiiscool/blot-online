# Blot Online (Clean Step D)

This is a **clean**, working multiplayer skeleton for Armenian Blot.
It includes:
- WebSocket server (Express + ws)
- Create Room / Join Room / Quick Match (queues 4 players)
- Deal 8 cards each and a simple turn-based trick loop
- Working language dropdown (EN / HY / RU) for UI labels
- Name saved in localStorage

## Run locally

```powershell
cd server
npm install
npm start
```

Open:
- http://localhost:3000

## Deploy on Render

- Root directory: `server`
- Build: `npm install`
- Start: `npm start`


## Step A: Language System Expansion
- Centralized all UI strings in `i18n.js`
- English / Armenian / Russian complete
- Language selector fully wired
