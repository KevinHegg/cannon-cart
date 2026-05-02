import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { createInitialState, FrameInput, GameState } from "./state";
import { step } from "./step";
import { getTerrainHeight } from "./terrain";

function runFrames(seed: string, frames: number, inputs: Map<number, FrameInput>): GameState {
  let state = createInitialState(seed);

  for (let frame = 0; frame < frames; frame += 1) {
    state = step(state, inputs.get(frame) ?? {});
  }

  return state;
}

describe("deterministic simulation", () => {
  it("RNG gives the same sequence for the same seed", () => {
    const a = createRng("stable-seed");
    const b = createRng("stable-seed");

    const sequenceA = Array.from({ length: 12 }, () => a.nextUint32());
    const sequenceB = Array.from({ length: 12 }, () => b.nextUint32());

    expect(sequenceA).toEqual(sequenceB);
  });

  it("terrain height is stable for the same seed and worldX", () => {
    const positions = [-128, 0, 42.5, 320, 1024.75, 4096];
    const firstPass = positions.map((worldX) => getTerrainHeight("terrain-seed", worldX));
    const secondPass = positions.map((worldX) => getTerrainHeight("terrain-seed", worldX));

    expect(firstPass).toEqual(secondPass);
  });

  it("same seed plus same input frames produces the same final state", () => {
    const inputs = new Map<number, FrameInput>([
      [10, { aim: { x: 0.8, y: 0.6 } }],
      [18, { aim: { x: 0.8, y: 0.6 }, fire: true }],
      [76, { aim: { x: 0.68, y: 0.74 } }],
      [90, { aim: { x: 0.68, y: 0.74 }, fire: true }],
      [140, { aim: { x: 0.95, y: 0.31 }, fire: true }]
    ]);

    const first = runFrames("replay-seed", 240, inputs);
    const second = runFrames("replay-seed", 240, inputs);

    expect(second).toEqual(first);
    expect(second.score).toBe(first.score);
    expect(second.frame).toBe(240);
  });
});
