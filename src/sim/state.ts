import { BOOST_FRAMES, DEFAULT_SEED, PLAYER_START_SPEED, RIVAL_CRUISE_SPEED, RIVAL_TAGGED_FRAMES } from "../game/constants";
import {
  HazardDefinition,
  MatchDefinition,
  ObstacleDefinition,
  PickupDefinition,
  generateMatch
} from "../seed/match";

export interface FrameInput {
  steer: number;
  fire: boolean;
  boost: boolean;
  restart?: boolean;
}

export interface PlayerState {
  progress: number;
  lateral: number;
  speed: number;
  boostCharges: number;
  boostFrames: number;
  shieldCharges: number;
  bumpFrames: number;
}

export interface RivalState {
  progress: number;
  lateral: number;
  speed: number;
  taggedFrames: number;
}

export interface ShotState {
  id: number;
  progress: number;
  lateral: number;
  ageFrames: number;
  targetProgress: number | null;
  targetLateral: number | null;
}

export interface ObstacleState extends ObstacleDefinition {
  destroyed: boolean;
  collided: boolean;
}

export interface PickupState extends PickupDefinition {
  collected: boolean;
}

export interface HazardState extends HazardDefinition {
  destroyed: boolean;
  collided: boolean;
}

export interface MatchStats {
  obstaclesCleared: number;
  obstaclesHit: number;
  pickupsUsed: number;
  cannonHits: number;
  shotsFired: number;
}

export type GamePhase = "running" | "finished";
export type GameOutcome = "win" | "loss";

export interface GameState {
  phase: GamePhase;
  outcome: GameOutcome | null;
  frame: number;
  match: MatchDefinition;
  player: PlayerState;
  rival: RivalState;
  shots: ShotState[];
  obstacles: ObstacleState[];
  pickups: PickupState[];
  hazards: HazardState[];
  stats: MatchStats;
  cannonCooldown: number;
  nextShotId: number;
}

export const EMPTY_INPUT: FrameInput = {
  steer: 0,
  fire: false,
  boost: false
};

export function createInitialState(seed = DEFAULT_SEED): GameState {
  const match = generateMatch(seed);

  return {
    phase: "running",
    outcome: null,
    frame: 0,
    match,
    player: {
      progress: 0,
      lateral: 0,
      speed: PLAYER_START_SPEED,
      boostCharges: 1,
      boostFrames: 0,
      shieldCharges: 0,
      bumpFrames: 0
    },
    rival: {
      progress: match.rival.startProgress,
      lateral: 0,
      speed: RIVAL_CRUISE_SPEED,
      taggedFrames: 0
    },
    shots: [],
    obstacles: match.obstacles.map((obstacle) => ({
      ...obstacle,
      destroyed: false,
      collided: false
    })),
    pickups: match.pickups.map((pickup) => ({
      ...pickup,
      collected: false
    })),
    hazards: match.hazards.map((hazard) => ({
      ...hazard,
      destroyed: false,
      collided: false
    })),
    stats: {
      obstaclesCleared: 0,
      obstaclesHit: 0,
      pickupsUsed: 0,
      cannonHits: 0,
      shotsFired: 0
    },
    cannonCooldown: 0,
    nextShotId: 1
  };
}

export function hasShield(player: Pick<PlayerState, "shieldCharges">): boolean {
  return player.shieldCharges > 0;
}

export function isBoosting(player: Pick<PlayerState, "boostFrames">): boolean {
  return player.boostFrames > 0;
}

export function activateShield(player: PlayerState): PlayerState {
  return {
    ...player,
    shieldCharges: player.shieldCharges + 1
  };
}

export function activateBoost(player: PlayerState): PlayerState {
  return {
    ...player,
    boostCharges: Math.max(0, player.boostCharges - 1),
    boostFrames: BOOST_FRAMES
  };
}

export function tagRival(rival: RivalState): RivalState {
  return {
    ...rival,
    taggedFrames: RIVAL_TAGGED_FRAMES
  };
}
