import {
  TERRAIN_AMPLITUDE,
  TERRAIN_BASE_HEIGHT,
  TERRAIN_DETAIL_AMPLITUDE,
  TERRAIN_SEGMENT_WIDTH
} from "../game/constants";
import { hashStringToUint32, mixUint32 } from "./rng";

function lattice(seedHash: number, index: number, salt: number): number {
  const mixed = mixUint32(seedHash ^ Math.imul(index, 374761393) ^ salt);
  return mixed / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function valueNoise(seedHash: number, x: number, width: number, salt: number): number {
  const scaled = x / width;
  const left = Math.floor(scaled);
  const fraction = scaled - left;
  const a = lattice(seedHash, left, salt);
  const b = lattice(seedHash, left + 1, salt);
  return lerp(a, b, smoothstep(fraction)) * 2 - 1;
}

export function getTerrainHeight(seed: string, worldX: number): number {
  const seedHash = hashStringToUint32(seed);
  const rolling = valueNoise(seedHash, worldX, TERRAIN_SEGMENT_WIDTH * 2.7, 0x9e3779b9);
  const detail = valueNoise(seedHash, worldX + 41, TERRAIN_SEGMENT_WIDTH * 0.9, 0x85ebca6b);
  const broad = valueNoise(seedHash, worldX - 73, TERRAIN_SEGMENT_WIDTH * 6, 0xc2b2ae35);

  return (
    TERRAIN_BASE_HEIGHT +
    rolling * TERRAIN_AMPLITUDE +
    detail * TERRAIN_DETAIL_AMPLITUDE +
    broad * TERRAIN_AMPLITUDE * 0.45
  );
}
