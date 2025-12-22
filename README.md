# Armenian Blot Online (Rules Engine Build)

This build includes:
- Multiplayer lobby/rooms/WebSockets
- Full server-side rules engine (bidding, contra/recontra, trick rules, scoring)
- Mobile support (PWA) for iPhone/Android

## Run locally
```bash
cd server
npm install
npm run dev
```
Open http://localhost:3000

## Notes on rule fidelity
Armenian Blot has house-rule variations. This implementation follows a practical, widely-used online ruleset:
- Bids 80..160 in tens + suit
- Capot contract supported
- Follow suit; if void must trump when opponents winning; overtrump when possible
- Trump order J,9,A,10,K,Q,8,7
- Last trick +10
- Melds auto-calculated by server; only team with stronger best meld scores meld points
- Belote (K+Q of trump) awards +20 when both have been played

Card textures/art are not included yet. Next step is visual card rendering + assets.


## Card textures
This build ships with a custom SVG deck (32 cards + back) in `server/public/assets/cards/`.


## Polish UI
This build adds a 4-player table layout, hand sorting, bid history, simple animations, and sound effects.
