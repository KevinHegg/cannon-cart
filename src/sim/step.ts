import {
  CANNON_COOLDOWN_FRAMES,
  CANNON_SPEED_COST,
  FIXED_TIME_STEP,
  MATCH_FRAMES,
  PLAYER_ACCELERATION,
  PLAYER_BUMP_FRAMES,
  PLAYER_CRUISE_SPEED,
  PLAYER_MAX_SPEED,
  PLAYER_OFFROAD_SLOWDOWN,
  PLAYER_RADIUS,
  PLAYER_STEER_SPEED,
  RIVAL_CRUISE_SPEED,
  RIVAL_RADIUS,
  RIVAL_TAGGED_SPEED,
  SHOT_MAX_AGE_FRAMES,
  SHOT_RADIUS,
  SHOT_SPEED,
  TRACK_WIDTH
} from "../game/constants";
import { HazardDefinition, getTrackCenterX } from "../seed/match";
import {
  EMPTY_INPUT,
  FrameInput,
  GameState,
  ObstacleState,
  PickupState,
  ShotState,
  activateBoost,
  activateShield,
  hasShield,
  tagRival
} from "./state";

export function step(state: GameState, input: FrameInput = EMPTY_INPUT): GameState {
  if (state.phase === "finished") {
    return state;
  }

  const next: GameState = {
    ...state,
    frame: state.frame + 1,
    player: { ...state.player },
    rival: { ...state.rival },
    shots: state.shots.map((shot) => ({ ...shot })),
    obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
    pickups: state.pickups.map((pickup) => ({ ...pickup })),
    stats: { ...state.stats },
    cannonCooldown: Math.max(0, state.cannonCooldown - 1)
  };

  applyBoostInput(next, input);
  movePlayer(next, input);
  moveRival(next);
  fireCannon(next, input);
  moveShots(next);
  resolveShotHits(next);
  resolvePickups(next);
  resolveObstacleHits(next);
  resolveHazards(next);
  resolveFinish(next);

  return next;
}

function applyBoostInput(state: GameState, input: FrameInput): void {
  if (input.boost && state.player.boostCharges > 0 && state.player.boostFrames <= 0) {
    state.player = activateBoost(state.player);
    state.stats.pickupsUsed += 1;
  }
}

function movePlayer(state: GameState, input: FrameInput): void {
  const boosting = state.player.boostFrames > 0;
  const targetSpeed = boosting ? PLAYER_MAX_SPEED : PLAYER_CRUISE_SPEED;

  state.player.speed += (targetSpeed - state.player.speed) * Math.min(1, PLAYER_ACCELERATION * FIXED_TIME_STEP / 100);
  state.player.lateral += input.steer * PLAYER_STEER_SPEED * FIXED_TIME_STEP * (0.78 + state.player.speed / PLAYER_MAX_SPEED);

  const roadLimit = TRACK_WIDTH / 2 - PLAYER_RADIUS;
  if (Math.abs(state.player.lateral) > roadLimit) {
    state.player.speed *= PLAYER_OFFROAD_SLOWDOWN;
  }

  state.player.lateral = clamp(state.player.lateral, -TRACK_WIDTH / 2 - 22, TRACK_WIDTH / 2 + 22);
  state.player.progress += state.player.speed * FIXED_TIME_STEP;
  state.player.boostFrames = Math.max(0, state.player.boostFrames - 1);
  state.player.bumpFrames = Math.max(0, state.player.bumpFrames - 1);
}

function moveRival(state: GameState): void {
  const tagged = state.rival.taggedFrames > 0;
  const speed = tagged ? RIVAL_TAGGED_SPEED : RIVAL_CRUISE_SPEED;
  const script = state.match.rival;

  state.rival.speed += (speed - state.rival.speed) * 0.08;
  state.rival.progress += state.rival.speed * FIXED_TIME_STEP;
  state.rival.lateral =
    Math.sin(state.frame * script.weaveFrequency + script.phase) * script.lateralAmplitude;
  state.rival.taggedFrames = Math.max(0, state.rival.taggedFrames - 1);
}

function fireCannon(state: GameState, input: FrameInput): void {
  if (!input.fire || state.cannonCooldown > 0) {
    return;
  }

  state.shots.push({
    id: state.nextShotId,
    progress: state.player.progress + 30,
    lateral: state.player.lateral,
    ageFrames: 0
  });
  state.nextShotId += 1;
  state.cannonCooldown = CANNON_COOLDOWN_FRAMES;
  state.player.speed = Math.max(80, state.player.speed - CANNON_SPEED_COST);
  state.stats.shotsFired += 1;
}

function moveShots(state: GameState): void {
  state.shots = state.shots
    .map((shot) => ({
      ...shot,
      progress: shot.progress + SHOT_SPEED * FIXED_TIME_STEP,
      ageFrames: shot.ageFrames + 1
    }))
    .filter((shot) => shot.ageFrames <= SHOT_MAX_AGE_FRAMES && shot.progress < state.player.progress + 920);
}

function resolveShotHits(state: GameState): void {
  const remainingShots: ShotState[] = [];

  for (const shot of state.shots) {
    const hitObstacle = state.obstacles.find(
      (obstacle) =>
        !obstacle.destroyed &&
        obstacle.clearable &&
        distanceSq(shot.progress, shot.lateral, obstacle.progress, obstacle.lateral) <=
          (SHOT_RADIUS + obstacle.radius) ** 2
    );

    if (hitObstacle) {
      hitObstacle.destroyed = true;
      state.stats.obstaclesCleared += 1;
      state.stats.cannonHits += 1;
      continue;
    }

    if (
      distanceSq(shot.progress, shot.lateral, state.rival.progress, state.rival.lateral) <=
      (SHOT_RADIUS + RIVAL_RADIUS) ** 2
    ) {
      state.rival = tagRival(state.rival);
      state.stats.cannonHits += 1;
      continue;
    }

    remainingShots.push(shot);
  }

  state.shots = remainingShots;
}

function resolvePickups(state: GameState): void {
  for (const pickup of state.pickups) {
    if (pickup.collected || !overlapsPlayer(state, pickup)) {
      continue;
    }

    pickup.collected = true;

    if (pickup.kind === "boost") {
      state.player.boostCharges += 1;
    } else {
      state.player = activateShield(state.player);
    }
  }
}

function resolveObstacleHits(state: GameState): void {
  for (const obstacle of state.obstacles) {
    if (obstacle.destroyed || obstacle.collided || !overlapsPlayer(state, obstacle)) {
      continue;
    }

    if (hasShield(state.player)) {
      obstacle.destroyed = true;
      state.player.shieldCharges = Math.max(0, state.player.shieldCharges - 1);
      state.stats.obstaclesCleared += 1;
      state.stats.pickupsUsed += 1;
      continue;
    }

    obstacle.collided = true;
    state.player.bumpFrames = PLAYER_BUMP_FRAMES;
    state.player.speed = Math.max(92, state.player.speed * (obstacle.kind === "mud" ? 0.64 : 0.56));
    state.player.lateral += state.player.lateral >= obstacle.lateral ? 22 : -22;
    state.stats.obstaclesHit += 1;
  }
}

function resolveHazards(state: GameState): void {
  for (const hazard of state.match.hazards) {
    if (!hazardIsActive(state, hazard)) {
      continue;
    }

    if (
      Math.abs(state.player.progress - hazard.progress) < 44 &&
      Math.abs(state.player.lateral - hazard.lateral) < 42
    ) {
      if (hasShield(state.player)) {
        state.player.shieldCharges = Math.max(0, state.player.shieldCharges - 1);
        state.stats.pickupsUsed += 1;
      } else {
        state.player.bumpFrames = Math.max(state.player.bumpFrames, 10);
        state.player.speed = Math.max(110, state.player.speed * 0.91);
      }
    }
  }
}

function resolveFinish(state: GameState): void {
  if (state.player.progress >= state.match.finishProgress) {
    finish(state, "win");
    return;
  }

  if (state.rival.progress >= state.match.finishProgress && state.player.progress + 80 < state.match.finishProgress) {
    finish(state, "loss");
    return;
  }

  if (state.frame >= MATCH_FRAMES) {
    finish(state, state.player.progress >= state.match.finishProgress ? "win" : "loss");
  }
}

function finish(state: GameState, outcome: "win" | "loss"): void {
  state.phase = "finished";
  state.outcome = outcome;
}

function overlapsPlayer(state: GameState, item: ObstacleState | PickupState): boolean {
  return (
    distanceSq(state.player.progress, state.player.lateral, item.progress, item.lateral) <=
    (PLAYER_RADIUS + item.radius) ** 2
  );
}

export function hazardIsActive(state: Pick<GameState, "frame">, hazard: HazardDefinition): boolean {
  return state.frame >= hazard.startFrame && state.frame < hazard.startFrame + hazard.durationFrames;
}

function distanceSq(aProgress: number, aLateral: number, bProgress: number, bLateral: number): number {
  const dProgress = aProgress - bProgress;
  const dLateral = aLateral - bLateral;
  return dProgress * dProgress + dLateral * dLateral;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getWorldX(state: GameState, progress: number, lateral: number): number {
  return getTrackCenterX(state.match, progress) + lateral;
}
