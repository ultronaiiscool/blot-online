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


## Step B: Lobby polish + Bots + Google Sign-In (secure)

### Bots
- Quick Match can fill remaining seats with bots when Bots != Off.
- Bot play is simple (random card) until full Belote rules are implemented.

### Google Sign-In
This build supports secure Google ID token verification on the server.

#### 1) Create Google OAuth Client ID
- Create a Google Cloud project
- Enable "OAuth consent screen"
- Create OAuth Client ID (Web)
- Add Authorized JavaScript origins:
  - https://YOUR_RAILWAY_PUBLIC_URL
  - https://YOUR_CUSTOM_DOMAIN (if used)
- Add Authorized redirect URIs (not used for GIS ID token button, but keep consistent):
  - https://YOUR_DOMAIN/

#### 2) Configure server env var on Railway
Set environment variable:
- GOOGLE_CLIENT_ID = your-client-id.apps.googleusercontent.com

#### 3) Configure client meta tag
Edit:
- server/public/index.html
Set:
<meta name="google-client-id" content="PUT_GOOGLE_CLIENT_ID_HERE" />
to your real client id (same as GOOGLE_CLIENT_ID).

Then redeploy.



## Next Step (Auth Required + Bugfixes + Bots)

- Removed manual name input. Players must use Google Sign-In to play.
- Fixed server auth handler so it cannot block gameplay.
- Server enforces sign-in for create/join/quick/leave/play.
- Auto-join room links after sign-in.
- Bots remain available in Quick Match to fill seats.

### Google setup (required)
1) Set Client ID in `server/public/index.html` meta tag.
2) Set Railway variable `GOOGLE_CLIENT_ID` to the same ID.
