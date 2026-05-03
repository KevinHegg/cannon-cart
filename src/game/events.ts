import { hashStringToUint32, mixUint32 } from "../sim/rng";
import { FrameInput, GameOutcome, GameState } from "../sim/state";
import { ObstacleKind, PickupKind } from "../seed/match";

export type GameEventKind =
  | "fire"
  | "cannonReady"
  | "pickupBoost"
  | "pickupShield"
  | "useBoost"
  | "shieldBlocked"
  | "obstacleHit"
  | "obstacleCleared"
  | "rivalTagged"
  | "finish"
  | "win"
  | "loss"
  | "restart"
  | "uiTap";

export interface GameEvent {
  kind: GameEventKind;
  frame: number;
  progress: number;
  lateral: number;
  callout?: string;
  obstacleKind?: ObstacleKind;
  pickupKind?: PickupKind;
  outcome?: GameOutcome;
}

const CLEAR_CALLOUTS = ["POP!", "CLEAR!", "PLOP!"];
const HIT_CALLOUTS = ["BONK!", "OOPS!", "THUNK!"];
const SHIELD_CALLOUTS = ["BOING!", "SAFE!", "PING!"];
const RIVAL_CALLOUTS = ["ZAP!", "TAG!", "POP!"];

export function collectGameEvents(previous: GameState, next: GameState, input: FrameInput): GameEvent[] {
  const events: GameEvent[] = [];
  const frame = next.frame;

  if (next.stats.shotsFired > previous.stats.shotsFired) {
    events.push({
      kind: "fire",
      frame,
      progress: previous.player.progress,
      lateral: previous.player.lateral
    });
  }

  if (previous.cannonCooldown > 0 && next.cannonCooldown === 0) {
    events.push({
      kind: "cannonReady",
      frame,
      progress: next.player.progress,
      lateral: next.player.lateral
    });
  }

  if (input.boost && previous.player.boostCharges > next.player.boostCharges && next.player.boostFrames > 0) {
    events.push({
      kind: "useBoost",
      frame,
      progress: next.player.progress,
      lateral: next.player.lateral
    });
  }

  for (const pickup of next.pickups) {
    const oldPickup = previous.pickups.find((candidate) => candidate.id === pickup.id);
    if (!oldPickup || oldPickup.collected || !pickup.collected) {
      continue;
    }

    events.push({
      kind: pickup.kind === "boost" ? "pickupBoost" : "pickupShield",
      frame,
      progress: pickup.progress,
      lateral: pickup.lateral,
      pickupKind: pickup.kind
    });
  }

  for (const obstacle of next.obstacles) {
    const oldObstacle = previous.obstacles.find((candidate) => candidate.id === obstacle.id);
    if (!oldObstacle) {
      continue;
    }

    if (!oldObstacle.destroyed && obstacle.destroyed) {
      const shieldBlocked = previous.player.shieldCharges > next.player.shieldCharges;
      events.push({
        kind: shieldBlocked ? "shieldBlocked" : "obstacleCleared",
        frame,
        progress: obstacle.progress,
        lateral: obstacle.lateral,
        obstacleKind: obstacle.kind,
        callout: chooseCallout(next.match.seed, frame, obstacle.id, shieldBlocked ? SHIELD_CALLOUTS : CLEAR_CALLOUTS)
      });
    }

    if (!oldObstacle.collided && obstacle.collided) {
      events.push({
        kind: "obstacleHit",
        frame,
        progress: obstacle.progress,
        lateral: obstacle.lateral,
        obstacleKind: obstacle.kind,
        callout: chooseCallout(next.match.seed, frame, obstacle.id, HIT_CALLOUTS)
      });
    }
  }

  if (previous.player.shieldCharges > next.player.shieldCharges && next.stats.pickupsUsed > previous.stats.pickupsUsed) {
    const hasObstacleShieldEvent = events.some((event) => event.kind === "shieldBlocked");
    if (!hasObstacleShieldEvent) {
      events.push({
        kind: "shieldBlocked",
        frame,
        progress: next.player.progress,
        lateral: next.player.lateral,
        callout: chooseCallout(next.match.seed, frame, 97, SHIELD_CALLOUTS)
      });
    }
  }

  if (next.rival.taggedFrames > previous.rival.taggedFrames) {
    events.push({
      kind: "rivalTagged",
      frame,
      progress: next.rival.progress,
      lateral: next.rival.lateral,
      callout: chooseCallout(next.match.seed, frame, 211, RIVAL_CALLOUTS)
    });
  }

  if (previous.phase !== "finished" && next.phase === "finished" && next.outcome) {
    events.push({
      kind: "finish",
      frame,
      progress: next.player.progress,
      lateral: next.player.lateral,
      outcome: next.outcome
    });
    events.push({
      kind: next.outcome,
      frame,
      progress: next.player.progress,
      lateral: next.player.lateral,
      outcome: next.outcome
    });
  }

  return events;
}

export function createManualEvent(
  kind: Extract<GameEventKind, "restart" | "uiTap">,
  state: GameState
): GameEvent {
  return {
    kind,
    frame: state.frame,
    progress: state.player.progress,
    lateral: state.player.lateral
  };
}

function chooseCallout(seed: string, frame: number, salt: number, choices: string[]): string {
  const index = mixUint32(hashStringToUint32(`${seed}:${frame}:${salt}`)) % choices.length;
  return choices[index];
}
