export interface Rng {
  nextUint32(): number;
  nextFloat(): number;
  nextRange(min: number, max: number): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
}

export function hashStringToUint32(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function mixUint32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 3266489909);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function createRng(seed: string | number): Rng {
  let state = typeof seed === "number" ? seed >>> 0 : hashStringToUint32(seed);
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return (next ^ (next >>> 14)) >>> 0;
  };
  const nextFloat = (): number => nextUint32() / 4294967296;
  const nextRange = (min: number, max: number): number => min + (max - min) * nextFloat();

  return {
    nextUint32,
    nextFloat,
    nextRange,
    nextInt(minInclusive: number, maxInclusive: number): number {
      return Math.floor(nextRange(minInclusive, maxInclusive + 1));
    }
  };
}
