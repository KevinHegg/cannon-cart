import {
  MUTE_BUTTON_MARGIN,
  MUTE_BUTTON_SIZE,
  STEER_ZONE_WIDTH_RATIO,
  TOUCH_BOTTOM_MARGIN,
  TOUCH_BUTTON_GAP,
  TOUCH_BUTTON_SIZE
} from "../game/constants";
import { FrameInput } from "../sim/state";

export interface InputVisualState {
  steer: -1 | 0 | 1;
  touchingSteer: boolean;
  firePressed: boolean;
  boostPressed: boolean;
  mutePressed: boolean;
  dragAmount: number;
}

export interface UiInputActions {
  muteToggle: boolean;
  userGesture: boolean;
}

export interface InputReadout {
  frame: FrameInput;
  ui: UiInputActions;
}

export interface InputController {
  readInput(): InputReadout;
  readFrameInput(): FrameInput;
  getVisualState(): InputVisualState;
  dispose(): void;
}

interface Point {
  x: number;
  y: number;
}

export function createInputController(canvas: HTMLCanvasElement): InputController {
  return createInputControllerWithRestart(canvas);
}

export function createInputControllerWithRestart(
  canvas: HTMLCanvasElement,
  canTapRestart: () => boolean = () => false
): InputController {
  const keys = new Set<string>();
  let pendingFire = false;
  let pendingBoost = false;
  let pendingRestart = false;
  let pendingMuteToggle = false;
  let pendingUserGesture = false;
  let mutePressedFrames = 0;
  let pointerId: number | null = null;
  let dragStart: Point | null = null;
  let dragCurrent: Point | null = null;
  let touchingSteer = false;

  const onKeyDown = (event: KeyboardEvent): void => {
    keys.add(event.code);
    pendingUserGesture = true;

    if (event.code === "Space") {
      event.preventDefault();
      pendingFire = true;
    }

    if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyK") {
      event.preventDefault();
      pendingBoost = true;
    }

    if (event.code === "KeyR") {
      pendingRestart = true;
    }

    if (event.code === "KeyM") {
      pendingMuteToggle = true;
      mutePressedFrames = 8;
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const point = getPoint(canvas, event);
    const action = getActionAt(canvas, point);

    event.preventDefault();
    pendingUserGesture = true;

    if (canTapRestart()) {
      pendingRestart = true;
      return;
    }

    if (action === "mute") {
      pendingMuteToggle = true;
      mutePressedFrames = 8;
      return;
    }

    if (action === "fire") {
      pendingFire = true;
      return;
    }

    if (action === "boost") {
      pendingBoost = true;
      return;
    }

    pointerId = event.pointerId;
    dragStart = point;
    dragCurrent = point;
    touchingSteer = true;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    dragCurrent = getPoint(canvas, event);
  };

  const endPointer = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }

    pointerId = null;
    dragStart = null;
    dragCurrent = null;
    touchingSteer = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  return {
    readInput(): InputReadout {
      const readout: InputReadout = {
        frame: {
          steer: getSteer(),
          fire: pendingFire,
          boost: pendingBoost,
          restart: pendingRestart
        },
        ui: {
          muteToggle: pendingMuteToggle,
          userGesture: pendingUserGesture
        }
      };

      pendingFire = false;
      pendingBoost = false;
      pendingRestart = false;
      pendingMuteToggle = false;
      pendingUserGesture = false;
      mutePressedFrames = Math.max(0, mutePressedFrames - 1);
      return readout;
    },
    readFrameInput(): FrameInput {
      const input: FrameInput = {
        steer: getSteer(),
        fire: pendingFire,
        boost: pendingBoost,
        restart: pendingRestart
      };

      pendingFire = false;
      pendingBoost = false;
      pendingRestart = false;
      pendingMuteToggle = false;
      pendingUserGesture = false;
      return input;
    },
    getVisualState(): InputVisualState {
      mutePressedFrames = Math.max(0, mutePressedFrames - 1);
      return {
        steer: getSteer(),
        touchingSteer,
        firePressed: pendingFire,
        boostPressed: pendingBoost,
        mutePressed: mutePressedFrames > 0,
        dragAmount: getDragAmount()
      };
    },
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
    }
  };

  function getSteer(): -1 | 0 | 1 {
    const keyboard =
      (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) -
      (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);

    if (keyboard !== 0) {
      return keyboard > 0 ? 1 : -1;
    }

    if (!dragStart || !dragCurrent) {
      return 0;
    }

    const dx = dragCurrent.x - dragStart.x;

    if (Math.abs(dx) < 18) {
      return 0;
    }

    return dx > 0 ? 1 : -1;
  }

  function getDragAmount(): number {
    if (!dragStart || !dragCurrent) {
      return 0;
    }

    return Math.max(-1, Math.min(1, (dragCurrent.x - dragStart.x) / 86));
  }
}

function getPoint(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function getActionAt(canvas: HTMLCanvasElement, point: Point): "fire" | "boost" | "steer" | "mute" {
  const rect = canvas.getBoundingClientRect();
  const buttonY = rect.height - TOUCH_BOTTOM_MARGIN - TOUCH_BUTTON_SIZE;

  if (
    point.x > rect.width - MUTE_BUTTON_MARGIN - MUTE_BUTTON_SIZE &&
    point.y > MUTE_BUTTON_MARGIN &&
    point.y < MUTE_BUTTON_MARGIN + MUTE_BUTTON_SIZE
  ) {
    return "mute";
  }

  if (point.x < rect.width * STEER_ZONE_WIDTH_RATIO && point.y > rect.height * 0.52) {
    return "steer";
  }

  if (point.y < buttonY) {
    return "steer";
  }

  if (point.x > rect.width - TOUCH_BOTTOM_MARGIN - TOUCH_BUTTON_SIZE) {
    return "fire";
  }

  if (point.x > rect.width - TOUCH_BOTTOM_MARGIN - TOUCH_BUTTON_SIZE * 2 - TOUCH_BUTTON_GAP) {
    return "boost";
  }

  return "steer";
}
