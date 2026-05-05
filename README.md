# Cannon Cart: AsymSprint

Portrait-first TypeScript Canvas 2D prototype for a deterministic 8-12 second arcade cannon-cart sprint set in **Camp Wobblewood**, an original cartoon campground and picnic-derby world.

The current run is paced around readable moments on a wide portrait rally ribbon: steer through a quiet intro, line up the roof cannon for a few clearable blockers, grab a useful pickup, dodge a small number of camp props, and beat the rival to the finish.

## Run

```bash
npm install
npm run dev
npm run dev:host
npm run build
npm run test
```

`npm run dev` starts the local desktop server. `npm run dev:host` exposes Vite on your local network so a phone on the same Wi-Fi can open the displayed Network URL.

## Controls

Desktop:

- `A` / `Left Arrow`: steer left
- `D` / `Right Arrow`: steer right
- `Space`: fire the roof cannon
- `Shift` / `K`: use boost when a boost charge is available
- `M`: mute or unmute procedural effects audio
- `R`: restart after the result screen

Mobile:

- Steer from the lower central driving zone. Touch left of center to steer left, right of center to steer right, and move farther from center for stronger steering.
- Tap `FIRE` in the bottom-right corner to shoot forward along the cart lane.
- Tap `BOOST` in the bottom-left corner to spend a stored boost charge.
- Multi-touch is supported, so you can steer with one thumb while firing or boosting with the other.
- Tap the speaker button in the top HUD to mute or unmute.
- Shield pickups store one automatic shield charge for the next obstacle or hazard hit.

## Audio

The game uses short procedural Web Audio sound effects for UI taps, cannon fire, pickups, boost, shield blocks, hits, rival tags, and result stings. Audio unlocks only after the first user interaction, as required by browsers. The mute preference is stored in `localStorage`, and gameplay continues silently if Web Audio is unavailable.

## Mobile-First Presentation

Cannon Cart uses one portrait logical playfield on every device. Desktop browsers show the same phone-shaped game board centered and scaled larger; the HUD, track, cart, and controls keep the same relative layout as mobile.

To test on a phone:

1. Run `npm run dev:host`.
2. Make sure the phone and computer are on the same Wi-Fi network.
3. Open the Vite Network URL shown in the terminal, usually something like `http://192.168.x.x:5173/`.
4. Rotate the phone to portrait and use the lower central steering zone plus the bottom-left `BOOST` and bottom-right `FIRE` buttons.

## Determinism

Gameplay state lives under `src/sim`, match generation lives under `src/seed`, rendering under `src/render`, input under `src/input`, and result/checksum logic under `src/result`. Gameplay uses the seeded RNG in `src/sim/rng.ts`; Canvas and DOM code stay out of deterministic simulation modules.

Visual effects, browser input, and procedural audio are driven by gameplay events after deterministic simulation steps. They never feed back into physics, scoring, or checksums.
