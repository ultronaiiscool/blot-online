# Armenian Blot Online (Team + Bidding + Trump + Scoring)

This is a **team Blot** foundation:
- 4 seats, teams are across: Seats 0&2 vs 1&3
- Bidding chooses **trump suit**
- Trump ranking + points (J=20, 9=14, etc.)
- Belote/Rebelote bonus (+20) if you hold K+Q of trump and play one
- Last trick bonus (+10)
- Team scores accumulate to target (151 or 301)

## Setup
Create `server/.env`:
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=dev-secret

## Run
cd server
npm install
npm start
Open http://localhost:3000

## Notes
This is a **simplified** Armenian Blot:
- Bidding is simplified (bid suit or pass; contract fixed at 80/90)
- Forced bid if everyone passes (to keep game flowing)
- Overtrumping / strict belote rules are simplified


## Variations Supported (Host Rules)
- Targets: 151 / 301 / 501 / 1001
- Modes: Suit Trump / No Trump / All Trump
- Coinche (double) + Re-coinche (x4) optional
- Melds optional (sequences + four-of-a-kind)
- Auto-melds (demo) optional

### Notes
- Full announcement-based meld claiming is simplified via auto-melds if enabled.


## Admin Features
- Live admin log (last 500 actions)
- Ban / unban users by ID
- Banned users cannot join rooms
- All bans logged server-side

⚠️ Admin panel is intentionally simple and not exposed by default.


## Mobile / PWA
- This build includes a PWA manifest + service worker caching for faster repeat loads.
- On iPhone: Share → Add to Home Screen (best full-screen experience).
