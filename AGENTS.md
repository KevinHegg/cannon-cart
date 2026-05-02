# AGENTS.md

## Project

This is a mobile-first TypeScript Canvas 2D game called Cannon Cart.

The player controls a cannon cart rendered near the bottom center of the screen. The simulation advances through a scrolling deterministic world. Terrain, targets, and events are generated from a seed. The player aims and fires projectiles to hit targets.

## Hard requirements

- Use TypeScript.
- Use Canvas 2D for the game renderer.
- Keep the simulation deterministic.
- Do not use Math.random() in gameplay code. Use src/sim/rng.ts.
- Use a fixed-step simulation at 60 Hz.
- Replays must record only seed plus input events, not game states or video.
- Keep replay payloads small enough to fit in a URL.
- Prefer simple code over framework complexity.
- Mobile controls matter: drag to aim, tap/release to fire.

## Commands

- npm run dev
- npm run build
- npm run test

## Validation

Before finishing a task, run:

```bash
npm run build
npm run test
