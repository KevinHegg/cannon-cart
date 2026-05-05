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
  SECTOR_COUNT,
  TRACK_LENGTH,
  TRACK_SAMPLE_STEP,
  TRACK_WIDTH
} from "../game/constants";
import { createRng } from "../sim/rng";

export type ObstacleKind = "cone" | "cooler" | "mud" | "barricade" | "log";
export type HazardKind = "rollingCooler" | "swingSign" | "logArm" | "marshmallowBarrel" | "rotator";
export type HazardMotion = "cross" | "sweep" | "wobble";
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
  kind: HazardKind;
  motion: HazardMotion;
  startFrame: number;
  durationFrames: number;
  progress: number;
  lane: number;
  lateral: number;
  baseLateral: number;
  amplitude: number;
  periodFrames: number;
  phase: number;
  radius: number;
  clearable: boolean;
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
  sectorCount: number;
  sectorLength: number;
  trackWidth: number;
  samples: TrackSample[];
  obstacles: ObstacleDefinition[];
  pickups: PickupDefinition[];
  hazards: HazardDefinition[];
  rival: RivalScript;
}

const CLEARABLE_KINDS: ObstacleKind[] = ["barricade", "cooler"];
const STEER_AROUND_KINDS: ObstacleKind[] = ["cone", "log", "mud"];
const HAZARD_KINDS: HazardKind[] = ["rollingCooler", "swingSign", "logArm", "marshmallowBarrel", "rotator"];
const PICKUP_KINDS: PickupKind[] = ["boost", "shield"];

export function laneToLateral(lane: number, trackWidth = TRACK_WIDTH): number {
  const laneWidth = trackWidth / LANE_COUNT;
  return lane * laneWidth;
}

export function generateMatch(seed: string): MatchDefinition {
  const rng = createRng(`${seed}:asym-sprint`);
  const finishProgress = TRACK_LENGTH + rng.nextInt(-160, 180);
  const sectorLength = finishProgress / SECTOR_COUNT;
  const samples: TrackSample[] = [];
  let centerX = 0;
  let drift = rng.nextRange(-52, 52);

  for (let progress = -TRACK_SAMPLE_STEP * 2; progress <= finishProgress + 720; progress += TRACK_SAMPLE_STEP) {
    const sector = Math.floor(Math.max(0, progress) / sectorLength);
    const drama = 1 + Math.min(2, sector) * 0.18;
    drift = clamp(drift + rng.nextRange(-30, 36) * drama, -130, 130);
    centerX += drift * 0.25;
    centerX = clamp(centerX, -420, 420);
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
    const beatSpacing = (finishProgress - INTRO_SAFE_PROGRESS - 620) / totalDangerous;
    const sector = Math.min(SECTOR_COUNT - 1, Math.floor((beatIndex / totalDangerous) * SECTOR_COUNT));
    const baseProgress = INTRO_SAFE_PROGRESS + 220 + beatIndex * beatSpacing + sector * 60;
    const progress = spacedProgress(
      clamp(baseProgress + rng.nextRange(-42, 48), INTRO_SAFE_PROGRESS + 48, finishProgress - 240),
      usedDangerProgresses
    );
    usedDangerProgresses.push(progress);
    const lane = chooseLane(rng, beatIndex);

    if (hazardBeatIndexes.has(beatIndex)) {
      const kind = HAZARD_KINDS[(hazards.length + beatIndex) % HAZARD_KINDS.length];
      const motion: HazardMotion = kind === "swingSign" || kind === "logArm" ? "sweep" : kind === "rotator" ? "wobble" : "cross";
      const startFrame = Math.max(110, Math.round((progress / finishProgress) * MATCH_FRAMES) - rng.nextInt(45, 82));
      const baseLateral = laneToLateral(lane) + rng.nextRange(-12, 12);
      const amplitude = motion === "wobble" ? rng.nextRange(22, 38) : rng.nextRange(58, 88);
      hazards.push({
        id: hazards.length,
        kind,
        motion,
        startFrame,
        durationFrames: 165 + rng.nextInt(0, 92),
        progress,
        lane,
        lateral: baseLateral,
        baseLateral,
        amplitude,
        periodFrames: motion === "sweep" ? rng.nextInt(112, 156) : rng.nextInt(88, 132),
        phase: rng.nextRange(0, Math.PI * 2),
        radius: kind === "logArm" ? 38 : 32,
        clearable: kind === "rollingCooler" || kind === "marshmallowBarrel"
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
    const baseProgress = INTRO_SAFE_PROGRESS + 420 + id * ((finishProgress - INTRO_SAFE_PROGRESS - 920) / pickupCount);
    pickups.push({
      id,
      kind: PICKUP_KINDS[id % PICKUP_KINDS.length],
      progress: clamp(baseProgress + rng.nextRange(-70, 80), INTRO_SAFE_PROGRESS + 220, finishProgress - 230),
      lane,
      lateral: laneToLateral(lane) + rng.nextRange(-10, 10),
      radius: 23
    });
  }

  return {
    seed,
    durationFrames: MATCH_FRAMES,
    finishProgress,
    sectorCount: SECTOR_COUNT,
    sectorLength,
    trackWidth: TRACK_WIDTH,
    samples,
    obstacles,
    pickups,
    hazards,
    rival: {
      startProgress: RIVAL_START_LEAD + rng.nextRange(35, 90),
      lateralAmplitude: rng.nextRange(38, 72),
      weaveFrequency: rng.nextRange(0.0052, 0.0095),
      phase: rng.nextRange(0, Math.PI * 2)
    }
  };
}

function chooseHazardBeatIndexes(totalDangerous: number, hazardCount: number, rng: ReturnType<typeof createRng>): Set<number> {
  const candidates = Array.from({ length: totalDangerous }, (_, index) => index).filter((index) => index > 3);
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
  const preferred = [1, 3, 5, 7, 9, 11, 13, 15, 2, 4, 6, 8, 10, 12, 14].filter(
    (index) => index < totalDangerous && !hazardBeatIndexes.has(index)
  );
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
