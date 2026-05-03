import "./style.css";
import { createGameAudio } from "./audio/gameAudio";
import { FIXED_TIME_STEP, DEFAULT_SEED } from "./game/constants";
import { collectGameEvents, createManualEvent, GameEvent } from "./game/events";
import { createInputControllerWithRestart } from "./input/controller";
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
const inputController = createInputControllerWithRestart(canvas, () => state.phase === "finished");
const audio = createGameAudio();

let previousTime = performance.now();
let accumulator = 0;
let renderEvents: GameEvent[] = [];

function tick(now: number): void {
  const elapsedSeconds = Math.min((now - previousTime) / 1000, 0.25);
  previousTime = now;
  accumulator += elapsedSeconds;

  while (accumulator >= FIXED_TIME_STEP) {
    const input = inputController.readInput();

    if (input.ui.userGesture) {
      const unlockedNow = audio.noteUserGesture();
      if (unlockedNow && state.phase === "running" && state.frame < 180) {
        audio.play("runStart");
      }
    }

    if (input.ui.muteToggle) {
      audio.toggleMuted();
      const event = createManualEvent("uiTap", state);
      renderEvents.push(event);
    }

    if (state.phase === "finished" && input.frame.restart) {
      const event = createManualEvent("restart", state);
      state = createInitialState(seedFromUrl);
      audio.playEvents([event]);
      renderEvents.push(event);
    } else {
      const previous = state;
      state = step(state, input.frame);
      const events = collectGameEvents(previous, state, input.frame);
      audio.playSteerTick(state.frame, input.frame.steer);
      audio.playEvents(events);
      maybeVibrate(events);
      renderEvents.push(...events);
    }
    accumulator -= FIXED_TIME_STEP;
  }

  renderer.draw(state, inputController.getVisualState(), audio.getState(), renderEvents);
  renderEvents = [];
  requestAnimationFrame(tick);
}

renderer.draw(state, inputController.getVisualState(), audio.getState(), renderEvents);
requestAnimationFrame(tick);

window.addEventListener("beforeunload", () => {
  inputController.dispose();
});

function maybeVibrate(events: GameEvent[]): void {
  if (audio.getState().muted || !("vibrate" in navigator)) {
    return;
  }

  const major = events.find((event) =>
    event.kind === "fire" ||
    event.kind === "obstacleHit" ||
    event.kind === "shieldBlocked" ||
    event.kind === "obstacleCleared" ||
    event.kind === "rivalTagged" ||
    event.kind === "useBoost"
  );

  if (!major) {
    return;
  }

  const vibration =
    major.kind === "useBoost"
      ? [12, 24, 12]
      : major.kind === "obstacleHit"
        ? 36
        : major.kind === "shieldBlocked"
          ? [18, 18, 18]
          : 18;

  navigator.vibrate(vibration);
}
