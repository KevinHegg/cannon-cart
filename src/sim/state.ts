import {
  DEFAULT_AIM_X,
  DEFAULT_AIM_Y,
  DEFAULT_SEED,
  TARGET_COUNT,
  TARGET_HEIGHT_MAX,
  TARGET_HEIGHT_MIN,
  TARGET_RADIUS_MAX,
  TARGET_RADIUS_MIN,
  TARGET_SPACING,
  TARGET_START_X
} from "../game/constants";
import { createRng } from "./rng";
import { getTerrainHeight } from "./terrain";

export interface AimVector {
  x: number;
  y: number;
}

export interface FrameInput {
  aim?: AimVector;
  fire?: boolean;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export interface Target {
  id: number;
  x: number;
  y: number;
  radius: number;
  hit: boolean;
}

export interface GameState {
  seed: string;
  frame: number;
  worldX: number;
  score: number;
  aim: AimVector;
  fireCooldown: number;
  nextProjectileId: number;
  projectiles: Projectile[];
  targets: Target[];
}

export function normalizeAim(aim: AimVector): AimVector {
  const length = Math.hypot(aim.x, aim.y);

  if (length <= 0.0001) {
    return { x: DEFAULT_AIM_X, y: DEFAULT_AIM_Y };
  }

  const normalized = {
    x: aim.x / length,
    y: aim.y / length
  };

  if (normalized.y < 0.08) {
    return normalizeAim({ x: normalized.x, y: 0.08 });
  }

  return normalized;
}

export function getCartGroundY(state: Pick<GameState, "seed" | "worldX">): number {
  return getTerrainHeight(state.seed, state.worldX);
}

export function createTargets(seed: string): Target[] {
  const rng = createRng(`${seed}:targets`);
  const targets: Target[] = [];

  for (let index = 0; index < TARGET_COUNT; index += 1) {
    const x = TARGET_START_X + index * TARGET_SPACING + rng.nextRange(-70, 84);
    const groundY = getTerrainHeight(seed, x);
    const radius = rng.nextRange(TARGET_RADIUS_MIN, TARGET_RADIUS_MAX);

    targets.push({
      id: index,
      x,
      y: groundY + rng.nextRange(TARGET_HEIGHT_MIN, TARGET_HEIGHT_MAX),
      radius,
      hit: false
    });
  }

  return targets;
}

export function createInitialState(seed = DEFAULT_SEED): GameState {
  return {
    seed,
    frame: 0,
    worldX: 0,
    score: 0,
    aim: normalizeAim({ x: DEFAULT_AIM_X, y: DEFAULT_AIM_Y }),
    fireCooldown: 0,
    nextProjectileId: 1,
    projectiles: [],
    targets: createTargets(seed)
  };
}
