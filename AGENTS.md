# AGENTS.md

## Project

This is a mobile-first TypeScript Canvas 2D game called Cannon Cart: AsymSprint.

The player controls a tiny cannon cart in a short top-down/tilted 2.5D arcade micro-race. The vehicle sprints along a deterministic ribbon track, steers around obstacles, collects pickups, fires a roof cannon forward, and races a deterministic rival or defender pressure system.

## Hard requirements

- Use TypeScript.
- Use Canvas 2D for the game renderer.
- Keep the simulation deterministic.
- Do not use Math.random() in gameplay code. Use src/sim/rng.ts.
- Use a fixed-step simulation at 60 Hz.
- Replays must record only seed plus input events, not game states or video.
- Keep replay payloads small enough to fit in a URL.
- Prefer simple code over framework complexity.
- Mobile controls matter: drag left/right to steer and use on-screen fire/boost buttons.

## Commands

- npm run dev
- npm run build
- npm run test

## Validation

Before finishing a task, run:

```bash
npm run build
npm run test
```
