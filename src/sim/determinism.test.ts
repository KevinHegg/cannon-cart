import { describe, expect, it } from "vitest";
import { MATCH_FRAMES } from "../game/constants";
import { createResultBlob } from "../result/checksum";
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
  });
});
