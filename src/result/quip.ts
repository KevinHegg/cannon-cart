import { hashStringToUint32, mixUint32 } from "../sim/rng";
import { ResultBlob } from "./checksum";

const WIN_LINES = [
  "Camp Wobblewood salutes your questionable driving.",
  "The marshmallow barrels never stood a chance.",
  "You earned a tiny cannon badge.",
  "Picnic panic successfully avoided."
];

const LOSS_LINES = [
  "The cones formed a committee.",
  "A noble sprint. A rude cooler.",
  "Camp Wobblewood requests fewer bonks.",
  "Almost heroic. Mostly sideways."
];

export function getResultQuip(result: ResultBlob): string {
  const lines = result.outcome === "win" ? WIN_LINES : LOSS_LINES;
  const index = mixUint32(hashStringToUint32(`${result.seed}:${result.checksum}:${result.outcome}`)) % lines.length;

  return lines[index];
}
