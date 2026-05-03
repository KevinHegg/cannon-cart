# AGENTS.md

## Project

This is a mobile-first TypeScript Canvas 2D game currently titled **Cannon Cart: AsymSprint**.

The desired game is an 8-12 second deterministic micro-racing encounter generated from a tiny seed.

This is NOT a side-view artillery game. Do not build a slow cannon wagon on hills. Do not anchor a cannon cart at the bottom of the screen shooting at distant targets.

The core experience is:

- A tiny vehicle races along a deterministic ribbon track.
- The camera follows the vehicle from a top-down or tilted 2.5D arcade view.
- The track scrolls and curves ahead like a compact portrait racing board.
- A roof cannon is a tactical tool, not the whole game.
- The cannon can clear obstacles, tag a rival, or open a route.
- Matches last 8-12 seconds.
- Each match is generated from a tiny seed.
- Future versions will support attacker/defender challenge sharing and leaderboards.

## Desired MVP

Build **AsymSprint**, not artillery.

MVP loop:

1. Load deterministic seed.
2. Generate a short ribbon track with curves, lanes, obstacles, pickups, and a finish gate.
3. Start a 10-12 second encounter.
4. Player drives a tiny car/cart.
5. Player can steer, boost, and fire a roof cannon.
6. Cannon shots cost momentum or have a cooldown.
7. Obstacles slow the player unless cleared or avoided.
8. Pickups provide one-use boost or shield.
9. A deterministic rival/defender/hazard script creates pressure.
10. End with win/loss/result summary.

## Hard Requirements

- Use TypeScript.
- Use Canvas 2D.
- Use a fixed-step simulation at 60 Hz.
- Keep deterministic gameplay under `src/sim`.
- Keep seed and match generation under `src/seed`.
- Keep result and checksum logic under `src/result`.
- Keep rendering under `src/render`.
- Keep input under `src/input`.
- Keep constants in `src/game/constants.ts`.
- Do not use `Math.random()` in gameplay code.
- Use seeded RNG only.
- Quantize inputs on frame boundaries.
- Keep Canvas, DOM, and audio code out of deterministic simulation files.
- Keep rendering and audio separate from simulation.
- Replays must record only seed plus input events, not game states or video.
- Keep replay payloads small enough to fit in a URL.
- Prefer simple code over framework complexity.
- Mobile controls matter: drag left/right to steer and use on-screen fire/boost buttons.
- Do not add React, Phaser, Three.js, Pixi, or a backend.
- Do not implement Netlify, Apps Script, replay sharing, GIF sharing, or leaderboards until requested.
- Do not copy Nintendo or Mario Kart intellectual property, characters, item designs, logos, UI motifs, or track motifs.

## Architecture

Preferred folders:

- `src/game` for constants and shared types.
- `src/seed` for seed parsing, encoding, and deterministic match generation.
- `src/sim` for pure deterministic simulation.
- `src/input` for keyboard, pointer, and touch input.
- `src/render` for Canvas rendering.
- `src/audio` for browser-only procedural audio.
- `src/result` for local result serialization/checksum.

## Commands

- `npm run dev`
- `npm run build`
- `npm run test`

## Validation

Before finishing a task, run:

```bash
npm run build
npm run test
```
