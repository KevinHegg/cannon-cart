import { describe, expect, it } from "vitest";
import { MATCH_FRAMES } from "../game/constants";
import { collectGameEvents, GameEvent } from "../game/events";
import { createResultBlob } from "../result/checksum";
import { getResultQuip } from "../result/quip";
import { generateMatch } from "../seed/match";
import { createRng } from "./rng";
import { createInitialState, FrameInput, GameState } from "./state";
import { step } from "./step";

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

  it("same seed generates the same track and encounter", () => {
    const first = generateMatch("track-seed");
    const second = generateMatch("track-seed");

    expect(second).toEqual(first);
    expect(first.samples.length).toBeGreaterThan(20);
    expect(first.obstacles.length).toBeGreaterThan(8);
    expect(first.pickups.some((pickup) => pickup.kind === "boost")).toBe(true);
    expect(first.pickups.some((pickup) => pickup.kind === "shield")).toBe(true);
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
});
