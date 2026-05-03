import { hashStringToUint32, mixUint32 } from "../sim/rng";
import { ResultBlob } from "./checksum";

const WIN_LINES = [
  "You out-booped the road.",
  "Cannon cart diplomacy worked.",
  "The cones never saw it coming.",
  "A tidy sprint with extra kaboom."
];

const LOSS_LINES = [
  "The cones voted no.",
  "A brave sprint, a rude road.",
  "Almost heroic. Mostly sideways.",
  "The road filed a tiny complaint."
];

export function getResultQuip(result: ResultBlob): string {
  const lines = result.outcome === "win" ? WIN_LINES : LOSS_LINES;
  const index = mixUint32(hashStringToUint32(`${result.seed}:${result.checksum}:${result.outcome}`)) % lines.length;

  return lines[index];
}
