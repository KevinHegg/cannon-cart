import {
  HAZARD_COUNT,
  LANE_COUNT,
  MATCH_FRAMES,
  OBSTACLE_COUNT,
  PICKUP_COUNT,
  RIVAL_START_LEAD,
  TRACK_LENGTH,
  TRACK_SAMPLE_STEP,
  TRACK_WIDTH
} from "../game/constants";
import { createRng } from "../sim/rng";

export type ObstacleKind = "cone" | "barrel" | "oil" | "gate";
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

const OBSTACLE_KINDS: ObstacleKind[] = ["cone", "barrel", "oil", "gate"];
const PICKUP_KINDS: PickupKind[] = ["boost", "shield"];

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

  const obstacles: ObstacleDefinition[] = [];
  for (let id = 0; id < OBSTACLE_COUNT; id += 1) {
    const lane = rng.nextInt(-1, 1);
    const kind = OBSTACLE_KINDS[rng.nextInt(0, OBSTACLE_KINDS.length - 1)];
    obstacles.push({
      id,
      kind,
      progress: 280 + id * ((finishProgress - 560) / OBSTACLE_COUNT) + rng.nextRange(-34, 52),
      lane,
      lateral: laneToLateral(lane) + rng.nextRange(-14, 14),
      radius: kind === "gate" ? 27 : kind === "oil" ? 25 : 20,
      clearable: kind !== "oil"
    });
  }

  const pickups: PickupDefinition[] = [];
  for (let id = 0; id < PICKUP_COUNT; id += 1) {
    const lane = rng.nextInt(-1, 1);
    pickups.push({
      id,
      kind: PICKUP_KINDS[rng.nextInt(0, PICKUP_KINDS.length - 1)],
      progress: 340 + id * ((finishProgress - 680) / PICKUP_COUNT) + rng.nextRange(-44, 56),
      lane,
      lateral: laneToLateral(lane) + rng.nextRange(-12, 12),
      radius: 24
    });
  }

  const hazards: HazardDefinition[] = [];
  for (let id = 0; id < HAZARD_COUNT; id += 1) {
    const lane = rng.nextInt(-1, 1);
    hazards.push({
      id,
      startFrame: 112 + id * 92 + rng.nextInt(-18, 24),
      durationFrames: 62 + rng.nextInt(0, 32),
      progress: 520 + id * ((finishProgress - 940) / HAZARD_COUNT) + rng.nextRange(-60, 70),
      lane,
      lateral: laneToLateral(lane),
      radius: 38
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
      startProgress: RIVAL_START_LEAD + rng.nextRange(-25, 35),
      lateralAmplitude: rng.nextRange(34, 72),
      weaveFrequency: rng.nextRange(0.006, 0.011),
      phase: rng.nextRange(0, Math.PI * 2)
    }
  };
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
