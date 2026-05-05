import {
  MUTE_BUTTON_MARGIN,
  MUTE_BUTTON_SIZE,
  STEER_ZONE_DEADZONE_RATIO,
  STEER_ZONE_FULL_POWER_RATIO,
  STEER_ZONE_TOP_RATIO,
  TOUCH_BOTTOM_MARGIN,
  TOUCH_BUTTON_SIZE
} from "../game/constants";
import { FrameInput } from "../sim/state";

export interface InputVisualState {
  steer: number;
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
  let steeringPointerId: number | null = null;
  let steerTouch: Point | null = null;
  let touchingSteer = false;
  const firePointers = new Set<number>();
  const boostPointers = new Set<number>();

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
      firePointers.add(event.pointerId);
      capturePointer(canvas, event.pointerId);
      return;
    }

    if (action === "boost") {
      pendingBoost = true;
      boostPointers.add(event.pointerId);
      capturePointer(canvas, event.pointerId);
      return;
    }

    if (steeringPointerId !== null) {
      return;
    }

    steeringPointerId = event.pointerId;
    steerTouch = point;
    touchingSteer = true;
    capturePointer(canvas, event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (steeringPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    steerTouch = getPoint(canvas, event);
  };

  const endPointer = (event: PointerEvent): void => {
    firePointers.delete(event.pointerId);
    boostPointers.delete(event.pointerId);

    if (steeringPointerId === event.pointerId) {
      steeringPointerId = null;
      steerTouch = null;
      touchingSteer = false;
    }

    releasePointer(canvas, event.pointerId);
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
        firePressed: pendingFire || firePointers.size > 0,
        boostPressed: pendingBoost || boostPointers.size > 0,
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

  function getSteer(): number {
    const keyboard =
      (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) -
      (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);

    if (keyboard !== 0) {
      return keyboard > 0 ? 1 : -1;
    }

    if (!steerTouch) {
      return 0;
    }

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const dx = steerTouch.x - centerX;

    if (Math.abs(dx) < rect.width * STEER_ZONE_DEADZONE_RATIO) {
      return 0;
    }

    const amount = Math.max(-1, Math.min(1, dx / (rect.width * STEER_ZONE_FULL_POWER_RATIO)));
    return Math.sign(amount) * Math.min(1, Math.pow(Math.abs(amount), 0.86));
  }

  function getDragAmount(): number {
    return getSteer();
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
  const buttonCenterY = buttonY + TOUCH_BUTTON_SIZE / 2;
  const boostCenterX = TOUCH_BOTTOM_MARGIN + TOUCH_BUTTON_SIZE / 2;
  const fireCenterX = rect.width - TOUCH_BOTTOM_MARGIN - TOUCH_BUTTON_SIZE / 2;
  const buttonRadius = TOUCH_BUTTON_SIZE * 0.66;

  if (
    point.x > rect.width - MUTE_BUTTON_MARGIN - MUTE_BUTTON_SIZE &&
    point.y > MUTE_BUTTON_MARGIN &&
    point.y < MUTE_BUTTON_MARGIN + MUTE_BUTTON_SIZE
  ) {
    return "mute";
  }

  if (distance(point.x, point.y, fireCenterX, buttonCenterY) <= buttonRadius) {
    return "fire";
  }

  if (distance(point.x, point.y, boostCenterX, buttonCenterY) <= buttonRadius) {
    return "boost";
  }

  if (point.y >= rect.height * STEER_ZONE_TOP_RATIO) {
    return "steer";
  }

  return "steer";
}

function distance(aX: number, aY: number, bX: number, bY: number): number {
  return Math.hypot(aX - bX, aY - bY);
}

function capturePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  if (canvas.hasPointerCapture(pointerId)) {
    return;
  }

  canvas.setPointerCapture(pointerId);
}

function releasePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  if (!canvas.hasPointerCapture(pointerId)) {
    return;
  }

  canvas.releasePointerCapture(pointerId);
}
