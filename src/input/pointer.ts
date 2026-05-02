import { AimVector, FrameInput, normalizeAim } from "../sim/state";

interface ScreenPoint {
  x: number;
  y: number;
}

export interface PointerInput {
  readFrameInput(): FrameInput;
  isDragging(): boolean;
  dispose(): void;
}

function aimFromScreenPoint(point: ScreenPoint, origin: ScreenPoint): AimVector {
  return normalizeAim({
    x: point.x - origin.x,
    y: origin.y - point.y
  });
}

export function createPointerInput(
  canvas: HTMLCanvasElement,
  getCartScreenPosition: () => ScreenPoint
): PointerInput {
  let dragging = false;
  let pendingFire = false;
  let activePointerId: number | null = null;
  let aim: AimVector | undefined;

  const updateAim = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    aim = aimFromScreenPoint(
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      },
      getCartScreenPosition()
    );
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    updateAim(event);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || activePointerId !== event.pointerId) {
      return;
    }

    updateAim(event);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging || activePointerId !== event.pointerId) {
      return;
    }

    updateAim(event);
    pendingFire = true;
    dragging = false;
    activePointerId = null;
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    dragging = false;
    activePointerId = null;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return {
    readFrameInput(): FrameInput {
      const frameInput: FrameInput = {
        aim,
        fire: pendingFire
      };
      pendingFire = false;
      return frameInput;
    },
    isDragging(): boolean {
      return dragging;
    },
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    }
  };
}
