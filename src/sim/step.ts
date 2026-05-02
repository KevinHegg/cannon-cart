import {
  BARREL_LENGTH,
  CART_SPEED,
  FIRE_COOLDOWN_FRAMES,
  FIXED_TIME_STEP,
  PROJECTILE_GRAVITY,
  PROJECTILE_MAX_AGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  SCORE_PER_TARGET
} from "../game/constants";
import {
  FrameInput,
  GameState,
  Projectile,
  Target,
  getCartGroundY,
  normalizeAim
} from "./state";
import { getTerrainHeight } from "./terrain";

function spawnProjectile(state: GameState): Projectile {
  const cartY = getCartGroundY(state);
  const muzzleX = state.worldX + state.aim.x * BARREL_LENGTH;
  const muzzleY = cartY + 24 + state.aim.y * BARREL_LENGTH;

  return {
    id: state.nextProjectileId,
    x: muzzleX,
    y: muzzleY,
    vx: state.aim.x * PROJECTILE_SPEED + CART_SPEED * 0.32,
    vy: state.aim.y * PROJECTILE_SPEED,
    age: 0
  };
}

function updateProjectile(projectile: Projectile): Projectile {
  const vy = projectile.vy - PROJECTILE_GRAVITY * FIXED_TIME_STEP;

  return {
    ...projectile,
    x: projectile.x + projectile.vx * FIXED_TIME_STEP,
    y: projectile.y + vy * FIXED_TIME_STEP,
    vy,
    age: projectile.age + FIXED_TIME_STEP
  };
}

function projectileIsAlive(state: GameState, projectile: Projectile): boolean {
  if (projectile.age > PROJECTILE_MAX_AGE) {
    return false;
  }

  if (projectile.x < state.worldX - 260 || projectile.x > state.worldX + 1600) {
    return false;
  }

  return projectile.y > getTerrainHeight(state.seed, projectile.x) - PROJECTILE_RADIUS;
}

function resolveHits(
  projectiles: Projectile[],
  targets: Target[]
): { projectiles: Projectile[]; targets: Target[]; scoreDelta: number } {
  let scoreDelta = 0;
  const remainingProjectiles: Projectile[] = [];
  const nextTargets = targets.map((target) => ({ ...target }));

  for (const projectile of projectiles) {
    let projectileHit = false;

    for (const target of nextTargets) {
      if (target.hit) {
        continue;
      }

      const dx = projectile.x - target.x;
      const dy = projectile.y - target.y;
      const hitRadius = target.radius + PROJECTILE_RADIUS;

      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        target.hit = true;
        projectileHit = true;
        scoreDelta += SCORE_PER_TARGET;
        break;
      }
    }

    if (!projectileHit) {
      remainingProjectiles.push(projectile);
    }
  }

  return {
    projectiles: remainingProjectiles,
    targets: nextTargets,
    scoreDelta
  };
}

export function step(state: GameState, input: FrameInput = {}): GameState {
  const aim = input.aim ? normalizeAim(input.aim) : state.aim;
  const readyToFire = Boolean(input.fire) && state.fireCooldown <= 0;
  const spawned = readyToFire ? [spawnProjectile({ ...state, aim })] : [];
  const movedProjectiles = [...state.projectiles, ...spawned]
    .map(updateProjectile)
    .filter((projectile) => projectileIsAlive(state, projectile));
  const hitResolution = resolveHits(movedProjectiles, state.targets);

  return {
    ...state,
    frame: state.frame + 1,
    worldX: state.worldX + CART_SPEED * FIXED_TIME_STEP,
    score: state.score + hitResolution.scoreDelta,
    aim,
    fireCooldown: readyToFire
      ? FIRE_COOLDOWN_FRAMES
      : Math.max(0, state.fireCooldown - 1),
    nextProjectileId: state.nextProjectileId + spawned.length,
    projectiles: hitResolution.projectiles,
    targets: hitResolution.targets
  };
}
