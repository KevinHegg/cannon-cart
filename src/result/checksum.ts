import { hashStringToUint32, mixUint32 } from "../sim/rng";
import { GameState } from "../sim/state";

export interface ResultBlob {
  seed: string;
  outcome: "running" | "win" | "loss";
  timeTicks: number;
  timeSeconds: number;
  obstaclesCleared: number;
  pickupsUsed: number;
  cannonHits: number;
  playerProgress: number;
  rivalProgress: number;
  checksum: string;
}

export function createResultBlob(state: GameState): ResultBlob {
  const outcome: ResultBlob["outcome"] =
    state.phase === "finished" && state.outcome ? state.outcome : "running";
  const fields = {
    seed: state.match.seed,
    outcome,
    timeTicks: state.frame,
    timeSeconds: Number((state.frame / 60).toFixed(2)),
    obstaclesCleared: state.stats.obstaclesCleared,
    pickupsUsed: state.stats.pickupsUsed,
    cannonHits: state.stats.cannonHits,
    playerProgress: Math.round(state.player.progress),
    rivalProgress: Math.round(state.rival.progress)
  };

  return {
    ...fields,
    checksum: checksumFields(fields)
  };
}

function checksumFields(fields: Omit<ResultBlob, "checksum">): string {
  const canonical = [
    fields.seed,
    fields.outcome,
    fields.timeTicks,
    fields.timeSeconds,
    fields.obstaclesCleared,
    fields.pickupsUsed,
    fields.cannonHits,
    fields.playerProgress,
    fields.rivalProgress
  ].join("|");
  const mixed = mixUint32(hashStringToUint32(canonical));

  return mixed.toString(16).padStart(8, "0");
}
