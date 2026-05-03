import {
  CLEARABLE_BLOCKER_MAX,
  CLEARABLE_BLOCKER_MIN,
  INTRO_SAFE_PROGRESS,
  LANE_COUNT,
  MAJOR_HAZARD_MAX,
  MAJOR_HAZARD_MIN,
  MATCH_FRAMES,
  MIN_CLUSTER_GAP,
  TOTAL_DANGEROUS_MAX,
  TOTAL_DANGEROUS_MIN,
  TOTAL_PICKUP_MAX,
  TOTAL_PICKUP_MIN,
  RIVAL_START_LEAD,
  TRACK_LENGTH,
  TRACK_SAMPLE_STEP,
  TRACK_WIDTH
} from "../game/constants";
import { createRng } from "../sim/rng";

export type ObstacleKind = "cone" | "cooler" | "mud" | "barricade" | "log";
export type PickupKind = "boost" | "shield";

export interface TrackSample {
  progress: number;
  centerX: number;
}

export interface ObstacleDefinition {
  id: number;
  kind: ObstacleKind;
  progress: number;
  lane: number;
  lateral: number;
  radius: number;
  clearable: boolean;
}

export interface PickupDefinition {
  id: number;
  kind: PickupKind;
  progress: number;
  lane: number;
  lateral: number;
  radius: number;
}

export interface HazardDefinition {
  id: number;
  startFrame: number;
  durationFrames: number;
  progress: number;
  lane: number;
  lateral: number;
  radius: number;
}

export interface RivalScript {
  startProgress: number;
  lateralAmplitude: number;
  weaveFrequency: number;
  phase: number;
}

export interface MatchDefinition {
  seed: string;
  durationFrames: number;
  finishProgress: number;
  trackWidth: number;
  samples: TrackSample[];
  obstacles: ObstacleDefinition[];
  pickups: PickupDefinition[];
  hazards: HazardDefinition[];
  rival: RivalScript;
}

const CLEARABLE_KINDS: ObstacleKind[] = ["barricade", "cooler"];
const STEER_AROUND_KINDS: ObstacleKind[] = ["cone", "log", "mud"];
const PICKUP_KINDS: PickupKind[] = ["boost", "shield"];
const DANGER_BEATS = [430, 730, 1035, 1345, 1655, 1965, 2265];
const PICKUP_BEATS = [950, 1515, 2090];

export function laneToLateral(lane: number, trackWidth = TRACK_WIDTH): number {
  const laneWidth = trackWidth / LANE_COUNT;
  return lane * laneWidth;
}

export function generateMatch(seed: string): MatchDefinition {
  const rng = createRng(`${seed}:asym-sprint`);
  const finishProgress = TRACK_LENGTH + rng.nextInt(-80, 80);
  const samples: TrackSample[] = [];
  let centerX = 0;
  let drift = rng.nextRange(-42, 42);

  for (let progress = -TRACK_SAMPLE_STEP * 2; progress <= finishProgress + 720; progress += TRACK_SAMPLE_STEP) {
    drift = clamp(drift + rng.nextRange(-34, 34), -112, 112);
    centerX += drift * 0.24;
    centerX = clamp(centerX, -360, 360);
    samples.push({ progress, centerX });
  }

  const totalDangerous = rng.nextInt(TOTAL_DANGEROUS_MIN, TOTAL_DANGEROUS_MAX);
  const hazardCount = Math.min(rng.nextInt(MAJOR_HAZARD_MIN, MAJOR_HAZARD_MAX), totalDangerous - CLEARABLE_BLOCKER_MIN);
  const obstacleCount = totalDangerous - hazardCount;
  const clearableCount = Math.min(rng.nextInt(CLEARABLE_BLOCKER_MIN, CLEARABLE_BLOCKER_MAX), obstacleCount);
  const hazardBeatIndexes = chooseHazardBeatIndexes(totalDangerous, hazardCount, rng);
  const clearableBeatIndexes = chooseClearableBeatIndexes(totalDangerous, hazardBeatIndexes, clearableCount);
  const usedDangerProgresses: number[] = [];
  const obstacles: ObstacleDefinition[] = [];
  const hazards: HazardDefinition[] = [];

  for (let beatIndex = 0; beatIndex < totalDangerous; beatIndex += 1) {
    const baseProgress = DANGER_BEATS[beatIndex];
    const progress = spacedProgress(
      clamp(baseProgress + rng.nextRange(-28, 32), INTRO_SAFE_PROGRESS + 48, finishProgress - 145),
      usedDangerProgresses
    );
    usedDangerProgresses.push(progress);
    const lane = chooseLane(rng, beatIndex);

    if (hazardBeatIndexes.has(beatIndex)) {
      const startFrame = Math.max(118, Math.round((progress / finishProgress) * MATCH_FRAMES) - rng.nextInt(18, 34));
      hazards.push({
        id: hazards.length,
        startFrame,
        durationFrames: 54 + rng.nextInt(0, 18),
        progress,
        lane,
        lateral: laneToLateral(lane) + rng.nextRange(-8, 8),
        radius: 34
      });
      continue;
    }

    const clearable = clearableBeatIndexes.has(beatIndex);
    const kind = clearable
      ? CLEARABLE_KINDS[(obstacles.length + beatIndex) % CLEARABLE_KINDS.length]
      : STEER_AROUND_KINDS[(obstacles.length + rng.nextInt(0, STEER_AROUND_KINDS.length - 1)) % STEER_AROUND_KINDS.length];

    obstacles.push({
      id: obstacles.length,
      kind,
      progress,
      lane,
      lateral: laneToLateral(lane) + rng.nextRange(-10, 10),
      radius: radiusForObstacle(kind),
      clearable
    });
  }

  const pickupCount = rng.nextInt(TOTAL_PICKUP_MIN, TOTAL_PICKUP_MAX);
  const pickups: PickupDefinition[] = [];
  for (let id = 0; id < pickupCount; id += 1) {
    const lane = chooseLane(rng, id + 9);
    const baseProgress = PICKUP_BEATS[id];
    pickups.push({
      id,
      kind: PICKUP_KINDS[id % PICKUP_KINDS.length],
      progress: clamp(baseProgress + rng.nextRange(-38, 44), INTRO_SAFE_PROGRESS + 220, finishProgress - 160),
      lane,
      lateral: laneToLateral(lane) + rng.nextRange(-10, 10),
      radius: 23
    });
  }

  return {
    seed,
    durationFrames: MATCH_FRAMES,
    finishProgress,
    trackWidth: TRACK_WIDTH,
    samples,
    obstacles,
    pickups,
    hazards,
    rival: {
      startProgress: RIVAL_START_LEAD + rng.nextRange(25, 70),
      lateralAmplitude: rng.nextRange(28, 56),
      weaveFrequency: rng.nextRange(0.0048, 0.0085),
      phase: rng.nextRange(0, Math.PI * 2)
    }
  };
}

function chooseHazardBeatIndexes(totalDangerous: number, hazardCount: number, rng: ReturnType<typeof createRng>): Set<number> {
  const candidates = [Math.min(totalDangerous - 2, 4), Math.min(totalDangerous - 1, 5), 3].filter((index) => index > 1);
  const chosen = new Set<number>();

  while (chosen.size < hazardCount && candidates.length > 0) {
    const index = candidates.splice(rng.nextInt(0, candidates.length - 1), 1)[0];
    chosen.add(index);
  }

  return chosen;
}

function chooseClearableBeatIndexes(
  totalDangerous: number,
  hazardBeatIndexes: Set<number>,
  clearableCount: number
): Set<number> {
  const preferred = [1, 3, 5, 2, 4, 6].filter((index) => index < totalDangerous && !hazardBeatIndexes.has(index));
  return new Set(preferred.slice(0, clearableCount));
}

function chooseLane(rng: ReturnType<typeof createRng>, salt: number): number {
  const lanes = [-1, 0, 1];
  return lanes[(rng.nextInt(0, lanes.length - 1) + salt) % lanes.length];
}

function spacedProgress(progress: number, existing: number[]): number {
  let next = progress;
  for (const previous of existing) {
    if (Math.abs(next - previous) < MIN_CLUSTER_GAP) {
      next = previous + MIN_CLUSTER_GAP;
    }
  }
  return next;
}

function radiusForObstacle(kind: ObstacleKind): number {
  if (kind === "barricade") {
    return 29;
  }

  if (kind === "mud") {
    return 25;
  }

  if (kind === "log") {
    return 26;
  }

  if (kind === "cooler") {
    return 23;
  }

  return 19;
}

export function getTrackCenterX(match: MatchDefinition, progress: number): number {
  const samples = match.samples;

  if (progress <= samples[0].progress) {
    return samples[0].centerX;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index];
    if (progress <= next.progress) {
      const previous = samples[index - 1];
      const amount = (progress - previous.progress) / (next.progress - previous.progress);
      return previous.centerX + (next.centerX - previous.centerX) * smoothstep(amount);
    }
  }

  return samples[samples.length - 1].centerX;
}

export function getTrackTangentX(match: MatchDefinition, progress: number): number {
  const before = getTrackCenterX(match, progress - 24);
  const after = getTrackCenterX(match, progress + 24);
  return (after - before) / 48;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
