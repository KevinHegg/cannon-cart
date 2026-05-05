import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLEARABLE_BLOCKER_MAX,
  CLEARABLE_BLOCKER_MIN,
  DENSITY_LOOKAHEAD_PROGRESS,
  INTRO_SAFE_PROGRESS,
  MAJOR_HAZARD_MAX,
  MAJOR_HAZARD_MIN,
  MATCH_FRAMES,
  MAX_VISIBLE_DANGEROUS_OBSTACLES,
  MAX_VISIBLE_PICKUPS,
  MIN_CLUSTER_GAP,
  PLAYER_CRUISE_SPEED,
  SECTOR_COUNT,
  TOTAL_DANGEROUS_MAX,
  TOTAL_DANGEROUS_MIN,
  TOTAL_PICKUP_MAX,
  TOTAL_PICKUP_MIN
} from "../game/constants";
import { collectGameEvents, GameEvent } from "../game/events";
import { calculateDragSteer } from "../input/controller";
import { createResultBlob } from "../result/checksum";
import { getResultQuip } from "../result/quip";
import { generateMatch } from "../seed/match";
import { createRng } from "./rng";
import { createInitialState, FrameInput, GameState } from "./state";
import { getHazardLateral, selectAutoAimTarget, step } from "./step";

interface PacingObject {
  progress: number;
  lane: number;
}

function runFrames(seed: string, frames: number, inputs: Map<number, FrameInput>): GameState {
  let state = createInitialState(seed);

  for (let frame = 0; frame < frames; frame += 1) {
    state = step(state, inputs.get(frame) ?? { steer: 0, fire: false, boost: false });
  }

  return state;
}

function runFramesWithEvents(
  seed: string,
  frames: number,
  inputs: Map<number, FrameInput>
): { state: GameState; events: GameEvent[] } {
  let state = createInitialState(seed);
  const events: GameEvent[] = [];

  for (let frame = 0; frame < frames; frame += 1) {
    const input = inputs.get(frame) ?? { steer: 0, fire: false, boost: false };
    const previous = state;
    state = step(state, input);
    events.push(...collectGameEvents(previous, state, input));
  }

  return { state, events };
}

describe("AsymSprint determinism", () => {
  it("RNG gives the same sequence for the same seed", () => {
    const a = createRng("stable-seed");
    const b = createRng("stable-seed");

    const sequenceA = Array.from({ length: 12 }, () => a.nextUint32());
    const sequenceB = Array.from({ length: 12 }, () => b.nextUint32());

    expect(sequenceA).toEqual(sequenceB);
  });

  it("same seed generates the same Camp Wobblewood track and encounter", () => {
    const first = generateMatch("track-seed");
    const second = generateMatch("track-seed");

    expect(second).toEqual(first);
    expect(first.samples.length).toBeGreaterThan(20);
    expect(first.obstacles.length + first.hazards.length).toBeGreaterThanOrEqual(TOTAL_DANGEROUS_MIN);
    expect(first.obstacles.length + first.hazards.length).toBeLessThanOrEqual(TOTAL_DANGEROUS_MAX);
    expect(first.pickups.some((pickup) => pickup.kind === "boost")).toBe(true);
    expect(first.pickups.some((pickup) => pickup.kind === "shield")).toBe(true);
    expect(first.sectorCount).toBe(SECTOR_COUNT);
    expect(first.sectorLength).toBeCloseTo(first.finishProgress / SECTOR_COUNT);
  });

  it("same seed plus same input frames produces the same final result", () => {
    const inputs = new Map<number, FrameInput>();

    for (let frame = 0; frame < MATCH_FRAMES; frame += 1) {
      inputs.set(frame, {
        steer: frame % 92 < 30 ? -1 : frame % 92 > 58 ? 1 : 0,
        fire: frame === 38 || frame === 142 || frame === 258 || frame === 406,
        boost: frame === 74 || frame === 330
      });
    }

    const first = runFrames("replay-seed", MATCH_FRAMES, inputs);
    const second = runFrames("replay-seed", MATCH_FRAMES, inputs);

    expect(second).toEqual(first);
    expect(createResultBlob(second)).toEqual(createResultBlob(first));
  });

  it("analog steering inputs are deterministic after frame quantization", () => {
    const inputs = new Map<number, FrameInput>();

    for (let frame = 0; frame < 150; frame += 1) {
      inputs.set(frame, {
        steer: frame < 50 ? -0.35 : frame < 95 ? 0.72 : -1,
        fire: frame === 32 || frame === 96,
        boost: frame === 64
      });
    }

    const first = runFrames("analog-steer-seed", 210, inputs);
    const second = runFrames("analog-steer-seed", 210, inputs);

    expect(second).toEqual(first);
    expect(createResultBlob(second).checksum).toBe(createResultBlob(first).checksum);
    expect(Math.abs(second.player.lateral)).toBeGreaterThan(4);
  });

  it("result blob and checksum generation are stable", () => {
    const inputs = new Map<number, FrameInput>([
      [1, { steer: 1, fire: false, boost: false }],
      [20, { steer: 1, fire: true, boost: false }],
      [80, { steer: -1, fire: false, boost: true }],
      [160, { steer: 0, fire: true, boost: false }]
    ]);
    const state = runFrames("checksum-seed", MATCH_FRAMES, inputs);
    const result = createResultBlob(state);

    expect(result).toEqual(createResultBlob(state));
    expect(result.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(result.timeTicks).toBe(state.frame);
    expect(getResultQuip(result)).toBe(getResultQuip(result));
  });

  it("deterministic gameplay events are stable for the same replay inputs", () => {
    const inputs = new Map<number, FrameInput>();

    for (let frame = 0; frame < MATCH_FRAMES; frame += 1) {
      inputs.set(frame, {
        steer: frame % 78 < 26 ? -1 : frame % 78 > 52 ? 1 : 0,
        fire: frame === 22 || frame === 98 || frame === 214 || frame === 362,
        boost: frame === 42 || frame === 260
      });
    }

    const first = runFramesWithEvents("event-seed", MATCH_FRAMES, inputs);
    const second = runFramesWithEvents("event-seed", MATCH_FRAMES, inputs);

    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(second.events.map((event) => event.kind)).toContain("fire");
    expect(createResultBlob(second.state).checksum).toBe(createResultBlob(first.state).checksum);
  });

  it("generated runs respect Camp Wobblewood pacing budgets", () => {
    for (const seed of ["pace-a", "pace-b", "pace-c", "pace-d"]) {
      const match = generateMatch(seed);
      const totalDangerous = match.obstacles.length + match.hazards.length;
      const clearable = match.obstacles.filter((obstacle) => obstacle.clearable).length;

      expect(totalDangerous).toBeGreaterThanOrEqual(TOTAL_DANGEROUS_MIN);
      expect(totalDangerous).toBeLessThanOrEqual(TOTAL_DANGEROUS_MAX);
      expect(match.pickups.length).toBeGreaterThanOrEqual(TOTAL_PICKUP_MIN);
      expect(match.pickups.length).toBeLessThanOrEqual(TOTAL_PICKUP_MAX);
      expect(clearable).toBeGreaterThanOrEqual(CLEARABLE_BLOCKER_MIN);
      expect(clearable).toBeLessThanOrEqual(CLEARABLE_BLOCKER_MAX);
      expect(match.hazards.length).toBeGreaterThanOrEqual(MAJOR_HAZARD_MIN);
      expect(match.hazards.length).toBeLessThanOrEqual(MAJOR_HAZARD_MAX);
    }
  });

  it("drag-to-steer input maps horizontal motion smoothly", () => {
    expect(calculateDragSteer(0, 390)).toBe(0);
    expect(calculateDragSteer(8, 390)).toBe(0);
    expect(calculateDragSteer(80, 390)).toBeGreaterThan(0.4);
    expect(calculateDragSteer(-80, 390)).toBeLessThan(-0.4);
    expect(calculateDragSteer(999, 390)).toBe(1);
    expect(calculateDragSteer(-999, 390)).toBe(-1);
  });

  it("boost creates a deterministic speed surge", () => {
    const boosted = step(createInitialState("boost-seed"), { steer: 0, fire: false, boost: true });
    const cruising = step(createInitialState("boost-seed"), { steer: 0, fire: false, boost: false });

    expect(boosted.player.boostFrames).toBeGreaterThan(0);
    expect(boosted.player.speed).toBeGreaterThan(PLAYER_CRUISE_SPEED);
    expect(boosted.player.speed).toBeGreaterThan(cruising.player.speed);
    expect(boosted.stats.pickupsUsed).toBe(1);
  });

  it("auto-aim deterministically prefers clearable blockers", () => {
    let state = createInitialState("auto-aim-seed");
    const blocker = state.obstacles.find((obstacle) => obstacle.clearable);
    expect(blocker).toBeDefined();

    if (!blocker) {
      return;
    }

    state = {
      ...state,
      player: {
        ...state.player,
        progress: blocker.progress - 180,
        lateral: blocker.lateral
      },
      rival: {
        ...state.rival,
        progress: blocker.progress - 100,
        lateral: blocker.lateral
      }
    };

    const target = selectAutoAimTarget(state);
    expect(target).toEqual({
      kind: "obstacle",
      id: blocker.id,
      progress: blocker.progress,
      lateral: blocker.lateral,
      radius: blocker.radius
    });

    const fired = step(state, { steer: 0, fire: true, boost: false });
    expect(fired.shots[0].targetLateral).toBe(blocker.lateral);
  });

  it("moving hazards are generated and move deterministically", () => {
    const first = generateMatch("moving-hazards");
    const second = generateMatch("moving-hazards");
    const hazard = first.hazards[0];

    expect(first.hazards.length).toBeGreaterThan(0);
    expect(second.hazards).toEqual(first.hazards);
    expect(first.hazards.some((candidate) => candidate.clearable)).toBe(true);
    expect(getHazardLateral(hazard, hazard.startFrame)).toBe(getHazardLateral(hazard, hazard.startFrame));
    expect(getHazardLateral(hazard, hazard.startFrame + Math.floor(hazard.periodFrames / 4))).not.toBe(
      getHazardLateral(hazard, hazard.startFrame)
    );
  });

  it("intro quiet zone has no immediate dangerous obstacles", () => {
    const match = generateMatch("quiet-zone");
    const dangerous = getDangerousObjects(match);

    expect(dangerous.every((item) => item.progress > INTRO_SAFE_PROGRESS)).toBe(true);
  });

  it("lookahead density stays readable", () => {
    for (const seed of ["density-a", "density-b", "density-c", "density-d"]) {
      const match = generateMatch(seed);
      const dangerous = getDangerousObjects(match);

      for (const item of dangerous) {
        const visibleDangerous = dangerous.filter(
          (candidate) =>
            candidate.progress >= item.progress &&
            candidate.progress <= item.progress + DENSITY_LOOKAHEAD_PROGRESS
        );
        const visiblePickups = match.pickups.filter(
          (candidate) =>
            candidate.progress >= item.progress &&
            candidate.progress <= item.progress + DENSITY_LOOKAHEAD_PROGRESS
        );

        expect(visibleDangerous.length).toBeLessThanOrEqual(MAX_VISIBLE_DANGEROUS_OBSTACLES);
        expect(visiblePickups.length).toBeLessThanOrEqual(MAX_VISIBLE_PICKUPS);
      }
    }
  });

  it("each obstacle cluster preserves at least one practical safe lane", () => {
    const match = generateMatch("safe-path");
    const clusters = clusterByGap(getDangerousObjects(match), MIN_CLUSTER_GAP);

    for (const cluster of clusters) {
      expect(new Set(cluster.map((item) => item.lane)).size).toBeLessThan(3);
    }
  });

  it("result quip selection is deterministic", () => {
    const state = runFrames("wobble-quip", MATCH_FRAMES, new Map());
    const result = createResultBlob(state);

    expect(getResultQuip(result)).toBe(getResultQuip(result));
  });

  it("gameplay source avoids unseeded time and random APIs", () => {
    const banned = ["Math." + "random", "Date." + "now"];
    const source = readSourceFiles(join(process.cwd(), "src")).join("\n");

    for (const pattern of banned) {
      expect(source.includes(pattern)).toBe(false);
    }
  });
});

function getDangerousObjects(match: ReturnType<typeof generateMatch>): PacingObject[] {
  return [...match.obstacles, ...match.hazards].sort((a, b) => a.progress - b.progress);
}

function clusterByGap(items: PacingObject[], gap: number): PacingObject[][] {
  const clusters: PacingObject[][] = [];

  for (const item of items) {
    const last = clusters[clusters.length - 1];
    if (!last || item.progress - last[last.length - 1].progress >= gap) {
      clusters.push([item]);
    } else {
      last.push(item);
    }
  }

  return clusters;
}

function readSourceFiles(dir: string): string[] {
  const contents: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store" || entry.endsWith(" 2.ts")) {
      continue;
    }

    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      contents.push(...readSourceFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      contents.push(readFileSync(fullPath, "utf8"));
    }
  }

  return contents;
}
