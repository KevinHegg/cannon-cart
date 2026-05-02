import "./style.css";
import { FIXED_TIME_STEP, DEFAULT_SEED } from "./game/constants";
import { createPointerInput } from "./input/pointer";
import { Renderer } from "./render/renderer";
import { createInitialState } from "./sim/state";
import { step } from "./sim/step";

const canvas = document.querySelector<HTMLCanvasElement>("#game");

if (!canvas) {
  throw new Error("Game canvas was not found.");
}

const seedFromUrl = new URLSearchParams(window.location.search).get("seed") ?? DEFAULT_SEED;
let state = createInitialState(seedFromUrl);
const renderer = new Renderer(canvas);
const pointerInput = createPointerInput(canvas, () => renderer.getCartScreenPosition());

let previousTime = performance.now();
let accumulator = 0;

function tick(now: number): void {
  const elapsedSeconds = Math.min((now - previousTime) / 1000, 0.25);
  previousTime = now;
  accumulator += elapsedSeconds;

  while (accumulator >= FIXED_TIME_STEP) {
    state = step(state, pointerInput.readFrameInput());
    accumulator -= FIXED_TIME_STEP;
  }

  renderer.draw(state);
  requestAnimationFrame(tick);
}

renderer.draw(state);
requestAnimationFrame(tick);

window.addEventListener("beforeunload", () => {
  pointerInput.dispose();
});
