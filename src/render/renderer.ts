import {
  CAMERA_LOOKAHEAD,
  CANNON_COOLDOWN_FRAMES,
  MATCH_FRAMES,
  MUTE_BUTTON_MARGIN,
  MUTE_BUTTON_SIZE,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  RIVAL_RADIUS,
  SHOT_RADIUS,
  TOUCH_BOTTOM_MARGIN,
  TOUCH_BUTTON_GAP,
  TOUCH_BUTTON_SIZE,
  TRACK_WIDTH
} from "../game/constants";
import { AudioVisualState } from "../audio/gameAudio";
import { GameEvent } from "../game/events";
import { InputVisualState } from "../input/controller";
import { createResultBlob } from "../result/checksum";
import { getResultQuip } from "../result/quip";
import { ObstacleKind, getTrackCenterX, getTrackTangentX } from "../seed/match";
import { GameState, ObstacleState, PickupState, hasShield, isBoosting } from "../sim/state";
import { hazardIsActive } from "../sim/step";

interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

interface Point {
  x: number;
  y: number;
}

interface Camera {
  centerX: number;
  scale: number;
  playerY: number;
  shakeX: number;
  shakeY: number;
}

interface SmokePuff {
  progress: number;
  lateral: number;
  startFrame: number;
  driftLateral: number;
  driftProgress: number;
  radius: number;
}

interface Burst {
  progress: number;
  lateral: number;
  startFrame: number;
  color: string;
}

interface FloatingText {
  progress: number;
  lateral: number;
  startFrame: number;
  text: string;
  color: string;
}

interface LockTarget {
  progress: number;
  lateral: number;
  radius: number;
  kind: "obstacle" | "rival";
}

const EMPTY_INPUT_VISUAL: InputVisualState = {
  steer: 0,
  touchingSteer: false,
  firePressed: false,
  boostPressed: false,
  mutePressed: false,
  dragAmount: 0
};

const DEFAULT_AUDIO_VISUAL: AudioVisualState = {
  muted: false,
  unlocked: false,
  supported: true
};

const HUD_FONT = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
const ROAD_SIGNS = ["CONE ZONE", "TINY CANNON CLUB", "BOOP LANE", "CAUTION: WOBBLES", "NO REFUNDS"];

export class Renderer {
  private readonly context: CanvasRenderingContext2D;
  private viewport: Viewport = { width: 1, height: 1, dpr: 1 };
  private lastFrame = -1;
  private shakeUntilFrame = 0;
  private readonly seenShotIds = new Set<number>();
  private smokePuffs: SmokePuff[] = [];
  private bursts: Burst[] = [];
  private floatingTexts: FloatingText[] = [];
  private tutorialDismissed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D is not available.");
    }

    this.context = context;
    this.resize();
  }

  draw(
    state: GameState,
    inputVisual: InputVisualState = EMPTY_INPUT_VISUAL,
    audioVisual: AudioVisualState = DEFAULT_AUDIO_VISUAL,
    events: GameEvent[] = []
  ): void {
    this.resize();
    this.syncEffects(state, events);

    const ctx = this.context;
    const camera = this.getCamera(state);
    const lockTarget = this.findLockTarget(state);

    this.drawBackground(ctx, state, camera);
    this.drawTrack(ctx, state, camera);
    this.drawRoadDetails(ctx, state, camera);
    this.drawAimGuide(ctx, state, camera, lockTarget);
    this.drawSpeedLines(ctx, state, camera);
    this.drawHazards(ctx, state, camera);
    this.drawPickups(ctx, state, camera);
    this.drawObstacles(ctx, state, camera);
    this.drawFinishGate(ctx, state, camera);
    this.drawRival(ctx, state, camera);
    this.drawShots(ctx, state, camera);
    this.drawLockTarget(ctx, state, camera, lockTarget);
    this.drawPlayer(ctx, state, camera, inputVisual);
    this.drawVisualEffects(ctx, state, camera);
    this.drawHud(ctx, state, inputVisual, audioVisual);

    if (state.phase === "finished") {
      this.drawResultOverlay(ctx, state);
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    this.viewport = { width, height, dpr };
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private syncEffects(state: GameState, events: GameEvent[]): void {
    if (state.frame < this.lastFrame) {
      this.seenShotIds.clear();
      this.smokePuffs = [];
      this.bursts = [];
      this.floatingTexts = [];
      this.shakeUntilFrame = 0;
      this.tutorialDismissed = false;
    }

    for (const shot of state.shots) {
      if (this.seenShotIds.has(shot.id)) {
        continue;
      }

      this.seenShotIds.add(shot.id);
      this.addMuzzleSmoke(state, shot.id);
    }

    for (const event of events) {
      this.applyEventEffect(event);
    }

    this.lastFrame = state.frame;
    this.smokePuffs = this.smokePuffs.filter((puff) => state.frame - puff.startFrame < 44);
    this.bursts = this.bursts.filter((burst) => state.frame - burst.startFrame < 34);
    this.floatingTexts = this.floatingTexts.filter((text) => state.frame - text.startFrame < 52);
  }

  private applyEventEffect(event: GameEvent): void {
    if (event.kind === "fire") {
      this.shakeUntilFrame = Math.max(this.shakeUntilFrame, event.frame + 4);
      return;
    }

    if (event.kind === "pickupBoost") {
      this.addBurst(event.progress, event.lateral, event.frame, "#39e0ff", "BOOST!");
      return;
    }

    if (event.kind === "pickupShield") {
      this.addBurst(event.progress, event.lateral, event.frame, "#9aff81", "SHIELD!");
      return;
    }

    if (event.kind === "useBoost") {
      this.addBurst(event.progress, event.lateral, event.frame, "#39e0ff", "ZIP!");
      this.shakeUntilFrame = Math.max(this.shakeUntilFrame, event.frame + 6);
      return;
    }

    if (event.kind === "shieldBlocked") {
      this.addBurst(event.progress, event.lateral, event.frame, "#9aff81", event.callout ?? "BOING!");
      this.shakeUntilFrame = Math.max(this.shakeUntilFrame, event.frame + 12);
      return;
    }

    if (event.kind === "obstacleHit") {
      this.addBurst(event.progress, event.lateral, event.frame, "#ff8aa0", event.callout ?? "BONK!");
      this.shakeUntilFrame = Math.max(this.shakeUntilFrame, event.frame + 14);
      return;
    }

    if (event.kind === "obstacleCleared") {
      this.addBurst(
        event.progress,
        event.lateral,
        event.frame,
        colorForObstacle(event.obstacleKind ?? "gate"),
        event.callout ?? "CLEAR!"
      );
      this.shakeUntilFrame = Math.max(this.shakeUntilFrame, event.frame + 11);
      return;
    }

    if (event.kind === "rivalTagged") {
      this.addBurst(event.progress, event.lateral, event.frame, "#bf8cff", event.callout ?? "ZAP!");
      this.shakeUntilFrame = Math.max(this.shakeUntilFrame, event.frame + 16);
      return;
    }

    if (event.kind === "cannonReady") {
      this.floatingTexts.push({
        progress: event.progress + 58,
        lateral: event.lateral,
        startFrame: event.frame,
        text: "READY",
        color: "#39e0ff"
      });
    }
  }

  private addMuzzleSmoke(state: GameState, shotId: number): void {
    for (let index = 0; index < 6; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      this.smokePuffs.push({
        progress: state.player.progress + 31 + index * 3,
        lateral: state.player.lateral + direction * (3 + index * 1.4),
        startFrame: state.frame,
        driftLateral: direction * (0.18 + index * 0.05),
        driftProgress: -0.7 - index * 0.08,
        radius: 8 + index * 1.7 + (shotId % 3)
      });
    }
  }

  private addBurst(progress: number, lateral: number, frame: number, color: string, text: string): void {
    this.bursts.push({ progress, lateral, startFrame: frame, color });
    this.floatingTexts.push({ progress, lateral, startFrame: frame, text, color });
  }

  private getCamera(state: GameState): Camera {
    const shakeAmount = Math.max(0, this.shakeUntilFrame - state.frame) / 12;
    const shakeX = Math.sin(state.frame * 2.31) * 7 * shakeAmount;
    const shakeY = Math.cos(state.frame * 1.83) * 5 * shakeAmount;

    return {
      centerX: getTrackCenterX(state.match, state.player.progress),
      scale: clamp(Math.min(this.viewport.width / PORTRAIT_WIDTH, this.viewport.height / PORTRAIT_HEIGHT), 0.72, 1.16),
      playerY: this.viewport.height * 0.715,
      shakeX,
      shakeY
    };
  }

  private project(state: GameState, camera: Camera, progress: number, lateral: number): Point {
    const worldX = getTrackCenterX(state.match, progress) + lateral;

    return {
      x: this.viewport.width / 2 + (worldX - camera.centerX) * camera.scale + camera.shakeX,
      y: camera.playerY - (progress - state.player.progress) * camera.scale + camera.shakeY
    };
  }

  private drawBackground(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const sky = ctx.createLinearGradient(0, 0, 0, this.viewport.height);
    sky.addColorStop(0, "#18245f");
    sky.addColorStop(0.3, "#2472bd");
    sky.addColorStop(0.62, "#46cfe0");
    sky.addColorStop(1, "#28b58b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    this.drawDioramaFloor(ctx, state, camera);
    this.drawSun(ctx);
    this.drawClouds(ctx, state);
    this.drawParallaxHills(ctx, state, camera);
    this.drawToyScenery(ctx, state, camera);
    this.drawConfetti(ctx, state, camera);

    const vignette = ctx.createRadialGradient(
      this.viewport.width / 2,
      this.viewport.height * 0.42,
      this.viewport.width * 0.25,
      this.viewport.width / 2,
      this.viewport.height * 0.5,
      this.viewport.height * 0.75
    );
    vignette.addColorStop(0, "rgba(255, 255, 255, 0)");
    vignette.addColorStop(1, "rgba(5, 11, 28, 0.26)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
  }

  private drawDioramaFloor(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const horizon = this.viewport.height * 0.42;
    const floor = ctx.createLinearGradient(0, horizon, 0, this.viewport.height);
    floor.addColorStop(0, "rgba(91, 238, 193, 0.12)");
    floor.addColorStop(0.5, "rgba(20, 154, 134, 0.42)");
    floor.addColorStop(1, "rgba(9, 92, 96, 0.72)");

    ctx.save();
    ctx.translate(camera.shakeX * 0.12, camera.shakeY * 0.12);
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, this.viewport.width, this.viewport.height - horizon);

    const gridOffset = (state.player.progress * 0.08) % 48;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let y = horizon + gridOffset; y < this.viewport.height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.viewport.width, y + 18);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSun(ctx: CanvasRenderingContext2D): void {
    const x = this.viewport.width - 62;
    const y = 78;
    const glow = ctx.createRadialGradient(x, y, 8, x, y, 64);
    glow.addColorStop(0, "rgba(255, 247, 176, 0.92)");
    glow.addColorStop(0.44, "rgba(255, 145, 84, 0.32)");
    glow.addColorStop(1, "rgba(255, 145, 84, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 64, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff176";
    ctx.strokeStyle = "#ff8f5a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = "rgba(255, 241, 118, 0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = (Math.PI * 2 * ray) / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * 31, y + Math.sin(angle) * 31);
      ctx.lineTo(x + Math.cos(angle) * 42, y + Math.sin(angle) * 42);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawClouds(ctx: CanvasRenderingContext2D, state: GameState): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    for (let index = 0; index < 5; index += 1) {
      const span = this.viewport.width + 150;
      const x = ((index * 96 - state.frame * (0.18 + index * 0.02)) % span) - 72;
      const y = 78 + index * 48 + Math.sin(index * 1.7) * 16;
      const scale = 0.68 + index * 0.08;
      this.drawCloud(ctx, x, y, scale);
    }
    ctx.restore();
  }

  private drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.fillStyle = "rgba(236, 252, 255, 0.74)";
    ctx.beginPath();
    ctx.ellipse(x, y, 28 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 24 * scale, y - 5 * scale, 22 * scale, 15 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 50 * scale, y, 30 * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawParallaxHills(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const base = this.viewport.height * 0.48;
    const scroll = (state.player.progress * 0.055) % 120;

    ctx.save();
    ctx.translate(camera.shakeX * 0.18, camera.shakeY * 0.18);
    ctx.fillStyle = "#135d84";
    ctx.beginPath();
    ctx.moveTo(-80, base + 70);
    for (let x = -80; x <= this.viewport.width + 80; x += 34) {
      const y = base + Math.sin((x + scroll) * 0.028) * 24 - Math.cos((x - scroll) * 0.016) * 14;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.viewport.width + 80, this.viewport.height);
    ctx.lineTo(-80, this.viewport.height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1faa8d";
    ctx.beginPath();
    ctx.moveTo(-80, base + 120);
    for (let x = -80; x <= this.viewport.width + 80; x += 36) {
      const y = base + 54 + Math.sin((x - scroll * 1.8) * 0.031) * 28;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.viewport.width + 80, this.viewport.height);
    ctx.lineTo(-80, this.viewport.height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawToyScenery(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    ctx.save();
    ctx.translate(camera.shakeX * 0.35, camera.shakeY * 0.35);
    for (let index = -2; index < 12; index += 1) {
      const progress = state.player.progress + index * 150 - ((state.player.progress * 0.32) % 150);
      const y = camera.playerY - (progress - state.player.progress) * camera.scale * 0.42;
      if (y < -90 || y > this.viewport.height + 90) {
        continue;
      }

      const leftX = 26 + Math.sin(index * 2.1) * 16;
      const rightX = this.viewport.width - 36 + Math.cos(index * 1.7) * 16;
      this.drawToyBuilding(ctx, leftX, y, index, -1);
      this.drawToyBuilding(ctx, rightX, y + 42, index + 4, 1);

      if (index % 3 === 0) {
        this.drawRoadSign(ctx, leftX + 46, y + 36, index, -1);
      }

      if (index % 4 === 1) {
        this.drawRoadSign(ctx, rightX - 48, y - 18, index + 7, 1);
      }
    }
    ctx.restore();
  }

  private drawRoadSign(ctx: CanvasRenderingContext2D, x: number, y: number, index: number, side: -1 | 1): void {
    const label = ROAD_SIGNS[Math.abs(index) % ROAD_SIGNS.length];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side * 0.08 + Math.sin(index * 2.7) * 0.05);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = "#10253d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 15);
    ctx.lineTo(0, 44);
    ctx.stroke();

    const sign = ctx.createLinearGradient(-42, -18, 42, 18);
    sign.addColorStop(0, "#fff176");
    sign.addColorStop(0.55, "#ffb35c");
    sign.addColorStop(1, "#ff8aa0");
    ctx.fillStyle = sign;
    ctx.strokeStyle = "#10253d";
    ctx.lineWidth = 3;
    this.roundRect(ctx, -43, -18, 86, 34, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#10253d";
    ctx.font = `900 7.8px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  private drawToyBuilding(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    index: number,
    side: -1 | 1
  ): void {
    const width = 28 + (index % 3) * 7;
    const height = 34 + (index % 4) * 9;
    const color = index % 2 === 0 ? "#ffcc5c" : "#ff7fa5";

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    this.roundRect(ctx, -width / 2 + side * 4, height * 0.28, width, 10, 5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.strokeStyle = "#123047";
    ctx.lineWidth = 2;
    this.roundRect(ctx, -width / 2, -height / 2, width, height, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        ctx.globalAlpha = 0.68;
        this.roundRect(ctx, -width * 0.25 + col * width * 0.28, -height * 0.2 + row * 12, 5, 5, 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawConfetti(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const colors = ["#fff176", "#ff8aa0", "#39e0ff", "#9aff81", "#bf8cff"];

    ctx.save();
    ctx.translate(camera.shakeX * 0.08, camera.shakeY * 0.08);
    for (let index = 0; index < 36; index += 1) {
      const band = index % 2 === 0 ? 0.18 : 0.82;
      const x = this.viewport.width * band + Math.sin(index * 9.17) * 28;
      const y = ((index * 47 - state.frame * (0.24 + (index % 5) * 0.03)) % (this.viewport.height + 80)) - 40;
      if (y < 118 && x > 50 && x < this.viewport.width - 50) {
        continue;
      }

      ctx.globalAlpha = 0.22 + (index % 4) * 0.07;
      ctx.fillStyle = colors[index % colors.length];
      ctx.translate(x, y);
      ctx.rotate(state.frame * 0.01 + index);
      this.roundRect(ctx, -4, -2, 8, 4, 2);
      ctx.fill();
      ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
      ctx.translate(camera.shakeX * 0.08, camera.shakeY * 0.08);
    }
    ctx.restore();
  }

  private drawTrack(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const samples = this.visibleProgressSamples(state, 22);
    const left = samples.map((progress) => this.project(state, camera, progress, -TRACK_WIDTH / 2));
    const right = samples.map((progress) => this.project(state, camera, progress, TRACK_WIDTH / 2));
    const innerLeft = samples.map((progress) => this.project(state, camera, progress, -TRACK_WIDTH / 2 + 18));
    const innerRight = samples.map((progress) => this.project(state, camera, progress, TRACK_WIDTH / 2 - 18));
    const surfaceLeft = samples.map((progress) => this.project(state, camera, progress, -TRACK_WIDTH / 2 + 31));
    const surfaceRight = samples.map((progress) => this.project(state, camera, progress, TRACK_WIDTH / 2 - 31));

    ctx.save();
    ctx.translate(0, 18 * camera.scale);
    ctx.fillStyle = "rgba(4, 13, 30, 0.38)";
    this.fillRibbon(ctx, left, right);
    ctx.restore();

    const outer = ctx.createLinearGradient(0, 0, this.viewport.width, this.viewport.height);
    outer.addColorStop(0, "#1e2b68");
    outer.addColorStop(0.46, "#263a88");
    outer.addColorStop(1, "#0d7e83");
    ctx.fillStyle = outer;
    this.fillRibbon(ctx, left, right);

    const bevel = ctx.createLinearGradient(this.viewport.width * 0.18, 0, this.viewport.width * 0.82, 0);
    bevel.addColorStop(0, "#ffe26d");
    bevel.addColorStop(0.18, "#29f6df");
    bevel.addColorStop(0.82, "#29f6df");
    bevel.addColorStop(1, "#ffe26d");
    ctx.fillStyle = bevel;
    this.fillRibbon(ctx, innerLeft, innerRight);

    const road = ctx.createLinearGradient(this.viewport.width * 0.2, 0, this.viewport.width * 0.84, 0);
    road.addColorStop(0, "#6f55d6");
    road.addColorStop(0.24, "#604ec8");
    road.addColorStop(0.5, "#3476d3");
    road.addColorStop(0.78, "#2eb2ce");
    road.addColorStop(1, "#238faf");
    ctx.fillStyle = road;
    this.fillRibbon(ctx, surfaceLeft, surfaceRight);

    this.strokeTrackEdge(ctx, left, "rgba(42, 255, 232, 0.46)", 18 * camera.scale);
    this.strokeTrackEdge(ctx, right, "rgba(42, 255, 232, 0.46)", 18 * camera.scale);
    this.strokeTrackEdge(ctx, left, "#10253d", 5 * camera.scale);
    this.strokeTrackEdge(ctx, right, "#10253d", 5 * camera.scale);
    this.strokeTrackEdge(ctx, innerLeft, "#fff176", 7 * camera.scale);
    this.strokeTrackEdge(ctx, innerRight, "#fff176", 7 * camera.scale);
    this.strokeTrackEdge(ctx, surfaceLeft, "rgba(255, 255, 255, 0.2)", 3 * camera.scale);
    this.strokeTrackEdge(ctx, surfaceRight, "rgba(0, 22, 40, 0.26)", 3 * camera.scale);
  }

  private drawRoadDetails(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    this.drawRumbleStrips(ctx, state, camera);
    this.drawLaneLine(ctx, state, camera, -TRACK_WIDTH / 6, 0);
    this.drawLaneLine(ctx, state, camera, TRACK_WIDTH / 6, 18);
    this.drawTrackStickers(ctx, state, camera);
  }

  private drawLaneLine(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, lateral: number, phase: number): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.48)";
    ctx.lineWidth = 5 * camera.scale;
    ctx.lineCap = "round";
    ctx.setLineDash([22 * camera.scale, 28 * camera.scale]);
    ctx.lineDashOffset = -((state.player.progress + phase) * camera.scale) % 50;
    ctx.beginPath();
    this.visibleProgressSamples(state, 32).forEach((progress, index) => {
      const point = this.project(state, camera, progress, lateral);
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    ctx.restore();
  }

  private drawTrackStickers(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let index = 0; index < 18; index += 1) {
      const progress = state.player.progress - 160 + index * 76 - (state.player.progress % 76);
      const lateral = index % 2 === 0 ? -TRACK_WIDTH * 0.38 : TRACK_WIDTH * 0.38;
      const point = this.project(state, camera, progress, lateral);
      if (!this.isVisible(point, 40)) {
        continue;
      }

      ctx.translate(point.x, point.y);
      ctx.rotate(Math.sin(index) * 0.4);
      ctx.fillStyle = index % 3 === 0 ? "#fff176" : "#ffffff";
      this.roundRect(ctx, -11 * camera.scale, -3 * camera.scale, 22 * camera.scale, 6 * camera.scale, 3 * camera.scale);
      ctx.fill();
      ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
      ctx.globalAlpha = 0.18;
    }
    ctx.restore();
  }

  private drawRumbleStrips(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    ctx.save();
    for (let index = 0; index < 26; index += 1) {
      const progress = state.player.progress - 230 + index * 54 - (state.player.progress % 54);
      for (const side of [-1, 1] as const) {
        const point = this.project(state, camera, progress, side * (TRACK_WIDTH / 2 - 19));
        if (!this.isVisible(point, 42)) {
          continue;
        }

        const tangent = getTrackTangentX(state.match, progress);
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(Math.atan2(tangent, 1) + side * 0.12);
        ctx.fillStyle = index % 2 === 0 ? "#ff5d75" : "#f7fbff";
        ctx.strokeStyle = "rgba(16, 37, 61, 0.32)";
        ctx.lineWidth = 1.5 * camera.scale;
        this.roundRect(ctx, -14 * camera.scale, -5 * camera.scale, 28 * camera.scale, 10 * camera.scale, 4 * camera.scale);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawAimGuide(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    lockTarget: LockTarget | null
  ): void {
    if (state.phase !== "running") {
      return;
    }

    const start = this.project(state, camera, state.player.progress + 30, state.player.lateral);
    const end = this.project(state, camera, state.player.progress + 340, state.player.lateral);
    const beamColor = lockTarget ? "rgba(255, 241, 118, 0.9)" : "rgba(139, 239, 255, 0.54)";

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
    ctx.lineWidth = 15 * camera.scale;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.strokeStyle = beamColor;
    ctx.lineWidth = lockTarget ? 7 * camera.scale : 5 * camera.scale;
    ctx.setLineDash(lockTarget ? [18 * camera.scale, 7 * camera.scale] : [13 * camera.scale, 10 * camera.scale]);
    ctx.lineDashOffset = -state.frame * (lockTarget ? 1.9 : 1.25);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    const coneWidth = lockTarget ? 68 : 52;
    const farLeft = this.project(state, camera, state.player.progress + 285, state.player.lateral - coneWidth);
    const farRight = this.project(state, camera, state.player.progress + 285, state.player.lateral + coneWidth);
    const cone = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    cone.addColorStop(0, lockTarget ? "rgba(255, 241, 118, 0.24)" : "rgba(74, 216, 255, 0.16)");
    cone.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = cone;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(farLeft.x, farLeft.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.closePath();
    ctx.fill();

    if (lockTarget) {
      for (let ring = 0; ring < 3; ring += 1) {
        const amount = (state.frame * 0.04 + ring / 3) % 1;
        const point = this.project(state, camera, state.player.progress + 98 + amount * 185, state.player.lateral);
        ctx.globalAlpha = 1 - amount;
        ctx.strokeStyle = "#fff176";
        ctx.lineWidth = 2 * camera.scale;
        ctx.beginPath();
        ctx.arc(point.x, point.y, (10 + amount * 18) * camera.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const boostAlpha = isBoosting(state.player) ? 0.54 : 0.28;

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(231, 255, 255, ${boostAlpha})`;
    ctx.lineWidth = 3 * camera.scale;
    for (let index = 0; index < 14; index += 1) {
      const progress = state.player.progress + 120 + index * 58 - ((state.frame * 9) % 58);
      const side = index % 2 === 0 ? -1 : 1;
      const lateral = side * (TRACK_WIDTH * 0.5 + 32 + (index % 4) * 9);
      const a = this.project(state, camera, progress, lateral);
      const b = this.project(state, camera, progress - 58 - state.player.speed * 0.05, lateral + side * 10);
      if (!this.isVisible(a, 100) && !this.isVisible(b, 100)) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHazards(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    for (const hazard of state.match.hazards) {
      const point = this.project(state, camera, hazard.progress, hazard.lateral);
      if (!this.isVisible(point, 110)) {
        continue;
      }

      const active = hazardIsActive(state, hazard);
      const pulse = 0.5 + Math.sin((state.frame - hazard.startFrame) * 0.21) * 0.5;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.globalAlpha = active ? 0.94 : 0.38;
      ctx.fillStyle = active ? "rgba(255, 80, 116, 0.24)" : "rgba(255, 241, 118, 0.16)";
      ctx.strokeStyle = active ? "#ff5d75" : "rgba(255, 255, 255, 0.42)";
      ctx.lineWidth = 3.5 * camera.scale;
      ctx.beginPath();
      ctx.arc(0, 0, (42 + pulse * 6) * camera.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#10253d";
      ctx.strokeStyle = "#f7fbff";
      ctx.lineWidth = 3 * camera.scale;
      ctx.beginPath();
      ctx.arc(0, 0, 13 * camera.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.rotate(state.frame * 0.15 + hazard.id);
      ctx.lineCap = "round";
      ctx.strokeStyle = active ? "#fff176" : "rgba(255, 255, 255, 0.62)";
      ctx.lineWidth = 10 * camera.scale;
      ctx.beginPath();
      ctx.moveTo(-42 * camera.scale, 0);
      ctx.lineTo(42 * camera.scale, 0);
      ctx.stroke();
      ctx.strokeStyle = active ? "#ff5d75" : "rgba(255, 93, 117, 0.62)";
      ctx.lineWidth = 5 * camera.scale;
      ctx.setLineDash([10 * camera.scale, 8 * camera.scale]);
      ctx.beginPath();
      ctx.moveTo(-39 * camera.scale, 0);
      ctx.lineTo(39 * camera.scale, 0);
      ctx.stroke();
      ctx.restore();

      if (active) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.48 + pulse * 0.38})`;
        ctx.lineWidth = 2 * camera.scale;
        ctx.beginPath();
        ctx.arc(0, 0, (55 + pulse * 11) * camera.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawPickups(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    for (const pickup of state.pickups) {
      if (pickup.collected) {
        continue;
      }

      const point = this.project(state, camera, pickup.progress, pickup.lateral);
      if (!this.isVisible(point, 90)) {
        continue;
      }

      const bob = Math.sin(state.frame * 0.12 + pickup.id) * 4 * camera.scale;
      const glowColor = pickup.kind === "boost" ? "rgba(57, 224, 255, 0.36)" : "rgba(154, 255, 129, 0.34)";
      const color = pickup.kind === "boost" ? "#39e0ff" : "#9aff81";

      ctx.save();
      ctx.translate(point.x, point.y + bob);
      ctx.rotate(Math.sin(state.frame * 0.025 + pickup.id) * 0.08);
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(0, 0, 36 * camera.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 * camera.scale;
      ctx.setLineDash([8 * camera.scale, 7 * camera.scale]);
      ctx.lineDashOffset = -state.frame * 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, 29 * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const gem = ctx.createRadialGradient(-7 * camera.scale, -8 * camera.scale, 2, 0, 0, 24 * camera.scale);
      gem.addColorStop(0, "#ffffff");
      gem.addColorStop(0.25, color);
      gem.addColorStop(1, pickup.kind === "boost" ? "#146bba" : "#18845e");
      ctx.fillStyle = gem;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3 * camera.scale;
      this.drawHex(ctx, 0, 0, 23 * camera.scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#10253d";
      if (pickup.kind === "boost") {
        this.drawBolt(ctx, 0, 0, 0.78 * camera.scale);
      } else {
        this.drawShieldIcon(ctx, 0, 0, 0.78 * camera.scale);
      }
      ctx.restore();
    }
  }

  private drawObstacles(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    for (const obstacle of state.obstacles) {
      if (obstacle.destroyed) {
        continue;
      }

      const point = this.project(state, camera, obstacle.progress, obstacle.lateral);
      if (!this.isVisible(point, 92)) {
        continue;
      }

      const wobble = Math.sin(state.frame * 0.16 + obstacle.id * 1.7);
      const juicedPoint = {
        x: point.x + wobble * (obstacle.kind === "cone" ? 2.4 : 0.8) * camera.scale,
        y: point.y + Math.abs(wobble) * (obstacle.kind === "barrel" ? 2.8 : 1.2) * camera.scale
      };

      if (obstacle.kind === "cone") {
        this.drawCone(ctx, juicedPoint, camera.scale, obstacle.collided, wobble * 0.08);
      } else if (obstacle.kind === "barrel") {
        this.drawBarrel(ctx, juicedPoint, camera.scale, obstacle.collided);
      } else if (obstacle.kind === "oil") {
        this.drawOil(ctx, juicedPoint, camera.scale, state.frame, obstacle.id);
      } else {
        this.drawGate(ctx, juicedPoint, camera.scale, obstacle.collided);
      }
    }
  }

  private drawFinishGate(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const left = this.project(state, camera, state.match.finishProgress, -TRACK_WIDTH / 2 - 22);
    const right = this.project(state, camera, state.match.finishProgress, TRACK_WIDTH / 2 + 22);

    if (!this.isVisible(left, 170) && !this.isVisible(right, 170)) {
      return;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 14 * camera.scale;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();

    const stripeCount = 12;
    for (let index = 0; index < stripeCount; index += 1) {
      const t0 = index / stripeCount;
      const t1 = (index + 0.58) / stripeCount;
      ctx.strokeStyle = index % 2 === 0 ? "#ffffff" : "#151f35";
      ctx.lineWidth = 9 * camera.scale;
      ctx.beginPath();
      ctx.moveTo(lerp(left.x, right.x, t0), lerp(left.y, right.y, t0));
      ctx.lineTo(lerp(left.x, right.x, t1), lerp(left.y, right.y, t1));
      ctx.stroke();
    }

    ctx.fillStyle = "#fff176";
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 4 * camera.scale;
    ctx.font = `900 ${Math.max(13, 18 * camera.scale)}px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText("FINISH", (left.x + right.x) / 2, left.y - 28 * camera.scale);
    ctx.fillText("FINISH", (left.x + right.x) / 2, left.y - 28 * camera.scale);
    ctx.restore();
  }

  private drawRival(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    const point = this.project(state, camera, state.rival.progress, state.rival.lateral);
    if (!this.isVisible(point, 100)) {
      return;
    }

    const angle = Math.atan2(getTrackTangentX(state.match, state.rival.progress), 1);
    this.drawRivalCar(ctx, point, angle, RIVAL_RADIUS * camera.scale, state.rival.taggedFrames > 0, state.frame);
  }

  private drawShots(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    for (const shot of state.shots) {
      const point = this.project(state, camera, shot.progress, shot.lateral);
      const tail = this.project(state, camera, shot.progress - 54, shot.lateral);
      if (!this.isVisible(point, 70)) {
        continue;
      }

      ctx.save();
      ctx.strokeStyle = "rgba(255, 241, 118, 0.34)";
      ctx.lineWidth = 15 * camera.scale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 122, 72, 0.86)";
      ctx.lineWidth = 6 * camera.scale;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 241, 118, 0.42)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, SHOT_RADIUS * 1.9 * camera.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5 * camera.scale;
      ctx.beginPath();
      ctx.arc(point.x, point.y, SHOT_RADIUS * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff176";
      ctx.beginPath();
      ctx.arc(point.x, point.y, SHOT_RADIUS * 0.82 * camera.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawLockTarget(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camera: Camera,
    lockTarget: LockTarget | null
  ): void {
    if (!lockTarget) {
      return;
    }

    const point = this.project(state, camera, lockTarget.progress, lockTarget.lateral);
    const pulse = 0.5 + Math.sin(state.frame * 0.28) * 0.5;

    ctx.save();
    ctx.strokeStyle = "rgba(16, 37, 61, 0.8)";
    ctx.lineWidth = 8 * camera.scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, (lockTarget.radius + 17 + pulse * 5) * camera.scale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = lockTarget.kind === "rival" ? "#bf8cff" : "#fff176";
    ctx.lineWidth = 4.5 * camera.scale;
    ctx.setLineDash([9 * camera.scale, 7 * camera.scale]);
    ctx.lineDashOffset = -state.frame * 0.85;
    ctx.beginPath();
    ctx.arc(point.x, point.y, (lockTarget.radius + 13 + pulse * 5) * camera.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 3 * camera.scale;
    ctx.beginPath();
    ctx.moveTo(point.x - (lockTarget.radius + 25) * camera.scale, point.y);
    ctx.lineTo(point.x - (lockTarget.radius + 11) * camera.scale, point.y);
    ctx.moveTo(point.x + (lockTarget.radius + 25) * camera.scale, point.y);
    ctx.lineTo(point.x + (lockTarget.radius + 11) * camera.scale, point.y);
    ctx.moveTo(point.x, point.y - (lockTarget.radius + 25) * camera.scale);
    ctx.lineTo(point.x, point.y - (lockTarget.radius + 11) * camera.scale);
    ctx.moveTo(point.x, point.y + (lockTarget.radius + 25) * camera.scale);
    ctx.lineTo(point.x, point.y + (lockTarget.radius + 11) * camera.scale);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, inputVisual: InputVisualState): void {
    const point = this.project(state, camera, state.player.progress, state.player.lateral);
    const trackAngle = Math.atan2(getTrackTangentX(state.match, state.player.progress), 1);
    const lean = (inputVisual.dragAmount || inputVisual.steer * 0.7) * 0.17;
    const bump = state.player.bumpFrames > 0 ? Math.sin(state.frame * 0.9) * 2.2 * camera.scale : 0;
    const recoil = state.cannonCooldown > CANNON_COOLDOWN_FRAMES - 8 ? 1 - (CANNON_COOLDOWN_FRAMES - state.cannonCooldown) / 8 : 0;

    ctx.save();
    ctx.translate(point.x, point.y + bump);
    ctx.rotate(trackAngle + lean);
    this.drawCartShadow(ctx, camera.scale);
    this.drawBoostFlame(ctx, state, camera.scale);
    this.drawCartBody(ctx, state, camera.scale, recoil);
    ctx.restore();

    if (hasShield(state.player)) {
      ctx.save();
      ctx.strokeStyle = "rgba(154, 255, 129, 0.9)";
      ctx.lineWidth = 4 * camera.scale;
      ctx.setLineDash([8 * camera.scale, 7 * camera.scale]);
      ctx.lineDashOffset = -state.frame;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 35 * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawVisualEffects(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
    for (const puff of this.smokePuffs) {
      const age = state.frame - puff.startFrame;
      const alpha = clamp(1 - age / 44, 0, 1);
      const point = this.project(
        state,
        camera,
        puff.progress + puff.driftProgress * age,
        puff.lateral + puff.driftLateral * age
      );

      ctx.save();
      ctx.globalAlpha = alpha * 0.62;
      ctx.fillStyle = "#e9f7ff";
      ctx.beginPath();
      ctx.arc(point.x, point.y, puff.radius * camera.scale * (1 + age / 44), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const burst of this.bursts) {
      const age = state.frame - burst.startFrame;
      const alpha = clamp(1 - age / 34, 0, 1);
      const point = this.project(state, camera, burst.progress, burst.lateral);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 5 * camera.scale;
      ctx.lineCap = "round";
      for (let ray = 0; ray < 10; ray += 1) {
        const angle = (Math.PI * 2 * ray) / 10 + age * 0.04;
        const inner = (10 + age * 0.7) * camera.scale;
        const outer = (24 + age * 1.8) * camera.scale;
        ctx.beginPath();
        ctx.moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner);
        ctx.lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const floatingText of this.floatingTexts) {
      const age = state.frame - floatingText.startFrame;
      const alpha = clamp(1 - age / 52, 0, 1);
      const point = this.project(state, camera, floatingText.progress, floatingText.lateral);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${Math.max(14, 22 * camera.scale)}px ${HUD_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "#10253d";
      ctx.lineWidth = 5 * camera.scale;
      ctx.fillStyle = floatingText.color;
      ctx.strokeText(floatingText.text, point.x, point.y - (26 + age * 0.9) * camera.scale);
      ctx.fillText(floatingText.text, point.x, point.y - (26 + age * 0.9) * camera.scale);
      ctx.restore();
    }
  }

  private drawHud(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    inputVisual: InputVisualState,
    audioVisual: AudioVisualState
  ): void {
    this.drawTopHud(ctx, state, audioVisual, inputVisual);
    this.drawControlZones(ctx, state, inputVisual);
    this.drawThumbButtons(ctx, state, inputVisual);
    this.drawTutorial(ctx, state, inputVisual);
  }

  private drawTopHud(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    audioVisual: AudioVisualState,
    inputVisual: InputVisualState
  ): void {
    const elapsed = state.frame / 60;
    const progress = clamp(state.player.progress / state.match.finishProgress, 0, 1);
    const cooldownProgress = 1 - clamp(state.cannonCooldown / CANNON_COOLDOWN_FRAMES, 0, 1);
    const top = 12;
    const panelX = 10;
    const width = this.viewport.width - panelX * 2;
    const metricWidth = (width - 30) / 3;

    ctx.save();
    const panel = ctx.createLinearGradient(0, top, 0, top + 102);
    panel.addColorStop(0, "rgba(15, 33, 74, 0.9)");
    panel.addColorStop(0.62, "rgba(8, 17, 38, 0.78)");
    panel.addColorStop(1, "rgba(8, 17, 38, 0.62)");
    ctx.fillStyle = panel;
    this.roundRect(ctx, panelX, top, width, 102, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    this.roundRect(ctx, panelX + 10, top + 8, width - 20, 12, 6);
    ctx.fill();

    this.drawHudMetric(ctx, panelX + 15, top + 20, "TIME", `${elapsed.toFixed(1)}s`, "#fff176");
    this.drawHudMetric(
      ctx,
      panelX + 15 + metricWidth,
      top + 20,
      "CANNON",
      state.cannonCooldown > 0 ? `${Math.ceil((state.cannonCooldown / 60) * 10) / 10}s` : "READY",
      "#39e0ff"
    );
    this.drawHudMetric(
      ctx,
      panelX + 15 + metricWidth * 2,
      top + 20,
      "HITS/CLEAR",
      `${state.stats.cannonHits}/${state.stats.obstaclesCleared}`,
      "#9aff81"
    );

    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    this.roundRect(ctx, panelX + 15, top + 77, width - 135, 10, 5);
    ctx.fill();
    const progressGradient = ctx.createLinearGradient(panelX + 15, 0, panelX + width - 120, 0);
    progressGradient.addColorStop(0, "#fff176");
    progressGradient.addColorStop(0.58, "#9aff81");
    progressGradient.addColorStop(1, "#39e0ff");
    ctx.fillStyle = progressGradient;
    this.roundRect(ctx, panelX + 15, top + 77, (width - 135) * progress, 10, 5);
    ctx.fill();

    ctx.fillStyle = "rgba(57, 224, 255, 0.22)";
    this.roundRect(ctx, panelX + 15 + metricWidth, top + 49, 62, 6, 3);
    ctx.fill();
    ctx.fillStyle = "#39e0ff";
    this.roundRect(ctx, panelX + 15 + metricWidth, top + 49, 62 * cooldownProgress, 6, 3);
    ctx.fill();

    this.drawInventoryChip(ctx, this.viewport.width - 112, top + 69, "boost", state.player.boostCharges);
    this.drawInventoryChip(ctx, this.viewport.width - 61, top + 69, "shield", state.player.shieldCharges);
    this.drawMuteButton(ctx, audioVisual, inputVisual);
    ctx.restore();
  }

  private drawMuteButton(ctx: CanvasRenderingContext2D, audioVisual: AudioVisualState, inputVisual: InputVisualState): void {
    const x = this.viewport.width - MUTE_BUTTON_MARGIN - MUTE_BUTTON_SIZE;
    const y = MUTE_BUTTON_MARGIN;
    const centerX = x + MUTE_BUTTON_SIZE / 2;
    const centerY = y + MUTE_BUTTON_SIZE / 2;
    const active = !audioVisual.muted && audioVisual.supported;
    const scale = inputVisual.mutePressed ? 0.92 : 1;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);
    const button = ctx.createRadialGradient(centerX - 8, centerY - 9, 3, centerX, centerY, MUTE_BUTTON_SIZE * 0.62);
    button.addColorStop(0, "rgba(255, 255, 255, 0.88)");
    button.addColorStop(0.34, active ? "rgba(57, 224, 255, 0.82)" : "rgba(255, 138, 160, 0.72)");
    button.addColorStop(1, active ? "rgba(28, 88, 184, 0.88)" : "rgba(92, 40, 72, 0.88)");
    ctx.fillStyle = button;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, MUTE_BUTTON_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#10253d";
    ctx.beginPath();
    ctx.moveTo(centerX - 11, centerY - 5);
    ctx.lineTo(centerX - 5, centerY - 5);
    ctx.lineTo(centerX + 2, centerY - 11);
    ctx.lineTo(centerX + 2, centerY + 11);
    ctx.lineTo(centerX - 5, centerY + 5);
    ctx.lineTo(centerX - 11, centerY + 5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#10253d";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    if (active) {
      ctx.beginPath();
      ctx.arc(centerX + 5, centerY, 7, -0.68, 0.68);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX + 6, centerY, 12, -0.58, 0.58);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(centerX - 10, centerY - 12);
      ctx.lineTo(centerX + 12, centerY + 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHudMetric(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string, color: string): void {
    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    ctx.font = `800 9px ${HUD_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, x, y);
    ctx.fillStyle = color;
    ctx.font = `900 19px ${HUD_FONT}`;
    ctx.fillText(value, x, y + 24);
  }

  private drawInventoryChip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    kind: "boost" | "shield",
    count: number
  ): void {
    ctx.save();
    const chip = ctx.createLinearGradient(x, y, x + 45, y + 26);
    chip.addColorStop(0, count > 0 ? "rgba(255, 255, 255, 0.26)" : "rgba(255, 255, 255, 0.1)");
    chip.addColorStop(1, count > 0 ? "rgba(255, 255, 255, 0.11)" : "rgba(255, 255, 255, 0.05)");
    ctx.fillStyle = chip;
    ctx.strokeStyle = count > 0 ? "rgba(255, 255, 255, 0.3)" : "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, 45, 26, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = kind === "boost" ? "#39e0ff" : "#9aff81";
    if (kind === "boost") {
      this.drawBolt(ctx, x + 13, y + 13, 0.45);
    } else {
      this.drawShieldIcon(ctx, x + 13, y + 13, 0.45);
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 14px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(count), x + 31, y + 13);
    ctx.restore();
  }

  private drawControlZones(ctx: CanvasRenderingContext2D, state: GameState, inputVisual: InputVisualState): void {
    const show = state.frame < 190 || inputVisual.touchingSteer;
    if (!show || state.phase === "finished") {
      return;
    }

    const zoneX = 18;
    const zoneY = this.viewport.height - 184;
    const zoneWidth = Math.min(184, this.viewport.width * 0.52);
    const zoneHeight = 122;
    const knobX = zoneX + zoneWidth / 2 + inputVisual.dragAmount * 52;

    ctx.save();
    ctx.globalAlpha = inputVisual.touchingSteer ? 0.82 : state.frame < 120 ? 0.78 : 0.34;
    const pad = ctx.createLinearGradient(zoneX, zoneY, zoneX + zoneWidth, zoneY + zoneHeight);
    pad.addColorStop(0, "rgba(57, 224, 255, 0.22)");
    pad.addColorStop(1, "rgba(8, 17, 38, 0.42)");
    ctx.fillStyle = pad;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 2;
    this.roundRect(ctx, zoneX, zoneY, zoneWidth, zoneHeight, 24);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.36)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(zoneX + 34, zoneY + zoneHeight / 2);
    ctx.lineTo(zoneX + 62, zoneY + zoneHeight / 2);
    ctx.moveTo(zoneX + 34, zoneY + zoneHeight / 2);
    ctx.lineTo(zoneX + 48, zoneY + zoneHeight / 2 - 13);
    ctx.moveTo(zoneX + 34, zoneY + zoneHeight / 2);
    ctx.lineTo(zoneX + 48, zoneY + zoneHeight / 2 + 13);
    ctx.moveTo(zoneX + zoneWidth - 34, zoneY + zoneHeight / 2);
    ctx.lineTo(zoneX + zoneWidth - 62, zoneY + zoneHeight / 2);
    ctx.moveTo(zoneX + zoneWidth - 34, zoneY + zoneHeight / 2);
    ctx.lineTo(zoneX + zoneWidth - 48, zoneY + zoneHeight / 2 - 13);
    ctx.moveTo(zoneX + zoneWidth - 34, zoneY + zoneHeight / 2);
    ctx.lineTo(zoneX + zoneWidth - 48, zoneY + zoneHeight / 2 + 13);
    ctx.stroke();

    const knob = ctx.createRadialGradient(knobX - 7, zoneY + zoneHeight / 2 - 8, 2, knobX, zoneY + zoneHeight / 2, 26);
    knob.addColorStop(0, "#ffffff");
    knob.addColorStop(0.32, "#39e0ff");
    knob.addColorStop(1, "#166ad6");
    ctx.fillStyle = knob;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(knobX, zoneY + zoneHeight / 2, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `900 12px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STEER", zoneX + zoneWidth / 2, zoneY + 26);
    ctx.restore();
  }

  private drawThumbButtons(ctx: CanvasRenderingContext2D, state: GameState, inputVisual: InputVisualState): void {
    if (state.phase === "finished") {
      return;
    }

    const size = clamp(this.viewport.width * 0.22, 68, TOUCH_BUTTON_SIZE);
    const fireX = this.viewport.width - TOUCH_BOTTOM_MARGIN - size;
    const y = this.viewport.height - TOUCH_BOTTOM_MARGIN - size;
    const boostX = fireX - TOUCH_BUTTON_GAP - size;

    this.drawBoostButton(ctx, boostX, y + 10, size * 0.9, state.player.boostCharges > 0, inputVisual.boostPressed);
    this.drawFireButton(ctx, fireX, y, size, state.cannonCooldown <= 0, state.cannonCooldown, inputVisual.firePressed);
  }

  private drawFireButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    ready: boolean,
    cooldown: number,
    pressed: boolean
  ): void {
    const centerX = x + size / 2;
    const centerY = y + size / 2;

    ctx.save();
    if (pressed) {
      ctx.translate(centerX, centerY);
      ctx.scale(0.94, 0.94);
      ctx.translate(-centerX, -centerY);
    }
    const button = ctx.createRadialGradient(centerX - 14, centerY - 16, 5, centerX, centerY, size * 0.6);
    button.addColorStop(0, ready ? "#ffffff" : "rgba(255, 255, 255, 0.28)");
    button.addColorStop(0.28, ready ? (pressed ? "#fff176" : "#ff8aa0") : "rgba(255, 255, 255, 0.18)");
    button.addColorStop(1, ready ? "#ff355f" : "rgba(255, 255, 255, 0.1)");
    ctx.fillStyle = button;
    ctx.strokeStyle = ready ? "#ffffff" : "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = ready ? "rgba(255, 241, 118, 0.62)" : "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 + 5, 0, Math.PI * 2);
    ctx.stroke();

    if (!ready) {
      const amount = cooldown / CANNON_COOLDOWN_FRAMES;
      ctx.fillStyle = "rgba(7, 15, 31, 0.46)";
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, size / 2 - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * amount);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = ready ? "#10253d" : "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(centerX - 18, centerY + 10);
    ctx.lineTo(centerX + 12, centerY - 15);
    ctx.stroke();
    ctx.fillStyle = ready ? "#10253d" : "rgba(255, 255, 255, 0.7)";
    ctx.beginPath();
    ctx.arc(centerX + 19, centerY - 20, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `900 12px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FIRE", centerX, centerY + 26);
    ctx.restore();
  }

  private drawBoostButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    enabled: boolean,
    pressed: boolean
  ): void {
    const centerX = x + size / 2;
    const centerY = y + size / 2;

    ctx.save();
    if (pressed) {
      ctx.translate(centerX, centerY);
      ctx.scale(0.94, 0.94);
      ctx.translate(-centerX, -centerY);
    }
    const button = ctx.createRadialGradient(centerX - 12, centerY - 13, 4, centerX, centerY, size * 0.62);
    button.addColorStop(0, enabled ? "#ffffff" : "rgba(255, 255, 255, 0.25)");
    button.addColorStop(0.28, enabled ? (pressed ? "#fff176" : "#4df2ff") : "rgba(255, 255, 255, 0.14)");
    button.addColorStop(1, enabled ? "#1670e4" : "rgba(255, 255, 255, 0.08)");
    ctx.fillStyle = button;
    ctx.strokeStyle = enabled ? "#ffffff" : "rgba(255, 255, 255, 0.24)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = enabled ? "rgba(57, 224, 255, 0.54)" : "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = enabled ? "#10253d" : "rgba(255, 255, 255, 0.62)";
    this.drawBolt(ctx, centerX, centerY - 4, 0.9);
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 11px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BOOST", centerX, centerY + 24);
    ctx.restore();
  }

  private drawTutorial(ctx: CanvasRenderingContext2D, state: GameState, inputVisual: InputVisualState): void {
    if (state.phase === "finished") {
      return;
    }

    const activeInput =
      inputVisual.touchingSteer || inputVisual.steer !== 0 || inputVisual.firePressed || inputVisual.boostPressed;
    if (activeInput || state.frame > 125) {
      this.tutorialDismissed = true;
    }

    if (this.tutorialDismissed) {
      if (state.frame > 215) {
        return;
      }

      const alpha = clamp(1 - Math.max(0, state.frame - 155) / 60, 0, 0.72);
      if (alpha <= 0) {
        return;
      }

      const width = Math.min(this.viewport.width - 64, 260);
      const x = (this.viewport.width - width) / 2;
      const y = 126;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(8, 17, 38, 0.72)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, x, y, width, 34, 17);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 12px ${HUD_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Line up, fire, grab boost & shield", this.viewport.width / 2, y + 17);
      ctx.restore();
      return;
    }

    const alpha = state.frame > 95 ? 1 - (state.frame - 95) / 30 : 1;
    const width = Math.min(this.viewport.width - 54, 308);
    const x = (this.viewport.width - width) / 2;
    const y = 122;

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const panel = ctx.createLinearGradient(x, y, x + width, y + 84);
    panel.addColorStop(0, "rgba(23, 43, 100, 0.84)");
    panel.addColorStop(1, "rgba(8, 17, 38, 0.7)");
    ctx.fillStyle = panel;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    this.roundRect(ctx, x, y, width, 84, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff176";
    ctx.font = `900 18px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("Cannon Cart: AsymSprint", this.viewport.width / 2, y + 26);

    const lines = ["Steer to line up", "Fire to clear", "Grab boost & shield"];
    ctx.font = `800 13px ${HUD_FONT}`;
    lines.forEach((line, index) => {
      const chipY = y + 46 + index * 15;
      ctx.fillStyle = index === 0 ? "#39e0ff" : index === 1 ? "#ff8aa0" : "#9aff81";
      ctx.beginPath();
      ctx.arc(x + 43, chipY - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(line, x + 52, chipY);
    });
    ctx.restore();
  }

  private drawResultOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
    const result = createResultBlob(state);
    const quip = getResultQuip(result);
    const outcome = result.outcome === "win" ? "win" : "loss";
    const panelWidth = Math.min(346, this.viewport.width - 34);
    const panelHeight = 422;
    const panelX = (this.viewport.width - panelWidth) / 2;
    const panelY = Math.max(94, (this.viewport.height - panelHeight) / 2);

    ctx.save();
    ctx.fillStyle = "rgba(6, 10, 24, 0.74)";
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
    this.drawResultMood(ctx, outcome, panelX, panelY, panelWidth, state.frame, result.checksum);

    const card = ctx.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY + panelHeight);
    card.addColorStop(0, "#ffffff");
    card.addColorStop(0.54, "#f7fbff");
    card.addColorStop(1, "#dff7ff");
    ctx.fillStyle = card;
    this.roundRect(ctx, panelX, panelY, panelWidth, panelHeight, 26);
    ctx.fill();
    ctx.strokeStyle = "#10253d";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = result.outcome === "win" ? "rgba(154, 255, 129, 0.24)" : "rgba(255, 93, 117, 0.2)";
    this.roundRect(ctx, panelX + 18, panelY + 18, panelWidth - 36, 62, 20);
    ctx.fill();

    ctx.fillStyle = result.outcome === "win" ? "#14895d" : "#d74365";
    ctx.font = `900 44px ${HUD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(result.outcome === "win" ? "WIN" : "LOSS", this.viewport.width / 2, panelY + 61);

    ctx.fillStyle = "#10253d";
    ctx.font = `900 14px ${HUD_FONT}`;
    ctx.fillText(quip, this.viewport.width / 2, panelY + 101);

    ctx.fillStyle = "#10253d";
    ctx.font = `800 15px ${HUD_FONT}`;
    ctx.fillText("Tap to run it back / Press R", this.viewport.width / 2, panelY + panelHeight - 28);

    const rows: Array<[string, string, string]> = [
      ["TIME", `${result.timeTicks} ticks`, `${result.timeSeconds.toFixed(2)}s`],
      ["CLEARED", String(result.obstaclesCleared), "obstacles"],
      ["PICKUPS USED", String(result.pickupsUsed), "boost/shield"],
      ["CANNON HITS", String(result.cannonHits), "tags + clears"],
      ["CHECKSUM", result.checksum, "stable result"]
    ];

    rows.forEach((row, index) => {
      this.drawResultRow(ctx, panelX + 24, panelY + 121 + index * 47, panelWidth - 48, row[0], row[1], row[2]);
    });
    ctx.restore();
  }

  private drawResultMood(
    ctx: CanvasRenderingContext2D,
    outcome: "win" | "loss",
    panelX: number,
    panelY: number,
    panelWidth: number,
    frame: number,
    checksum: string
  ): void {
    ctx.save();
    const seed = checksum.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
    const colors = outcome === "win" ? ["#fff176", "#39e0ff", "#9aff81", "#ff8aa0"] : ["#8aa7ff", "#d5deff", "#bf8cff"];
    const count = outcome === "win" ? 34 : 18;

    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = panelX + panelWidth / 2 + side * (70 + (index % 7) * 18);
      const y = panelY - 16 + ((index * 31 + seed) % 180) + Math.sin(frame * 0.04 + index) * 4;
      ctx.globalAlpha = outcome === "win" ? 0.78 : 0.36;
      ctx.fillStyle = colors[index % colors.length];
      ctx.translate(x, y);
      ctx.rotate(index + frame * 0.025);
      if (outcome === "win") {
        this.roundRect(ctx, -5, -3, 10, 6, 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 5 + (index % 3), 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
    }
    ctx.restore();
  }

  private drawResultRow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    label: string,
    value: string,
    caption: string
  ): void {
    ctx.save();
    ctx.fillStyle = indexColor(label);
    this.roundRect(ctx, x, y, width, 38, 14);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.font = `800 9px ${HUD_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, x + 13, y + 14);
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 18px ${HUD_FONT}`;
    ctx.fillText(value, x + 13, y + 31);
    ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
    ctx.font = `800 11px ${HUD_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(caption, x + width - 13, y + 25);
    ctx.restore();
  }

  private findLockTarget(state: GameState): LockTarget | null {
    if (state.phase !== "running") {
      return null;
    }

    let best: LockTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const obstacle of state.obstacles) {
      if (obstacle.destroyed || !obstacle.clearable) {
        continue;
      }

      const dProgress = obstacle.progress - state.player.progress;
      const dLateral = Math.abs(obstacle.lateral - state.player.lateral);
      if (dProgress < 54 || dProgress > 385 || dLateral > 44 + obstacle.radius * 0.22) {
        continue;
      }

      if (dProgress < bestDistance) {
        bestDistance = dProgress;
        best = {
          progress: obstacle.progress,
          lateral: obstacle.lateral,
          radius: obstacle.radius,
          kind: "obstacle"
        };
      }
    }

    const rivalProgress = state.rival.progress - state.player.progress;
    const rivalLateral = Math.abs(state.rival.lateral - state.player.lateral);
    if (rivalProgress > 62 && rivalProgress < 420 && rivalLateral < 44 && rivalProgress < bestDistance) {
      best = {
        progress: state.rival.progress,
        lateral: state.rival.lateral,
        radius: RIVAL_RADIUS,
        kind: "rival"
      };
    }

    return best;
  }

  private visibleProgressSamples(state: GameState, step: number): number[] {
    const start = Math.max(-160, state.player.progress - 420);
    const end = state.player.progress + CAMERA_LOOKAHEAD + 920;
    const samples: number[] = [];

    for (let progress = start; progress <= end; progress += step) {
      samples.push(progress);
    }

    return samples;
  }

  private fillRibbon(ctx: CanvasRenderingContext2D, left: Point[], right: Point[]): void {
    ctx.beginPath();
    left.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    right.slice().reverse().forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fill();
  }

  private strokeTrackEdge(ctx: CanvasRenderingContext2D, points: Point[], color: string, width: number): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    ctx.restore();
  }

  private drawCone(ctx: CanvasRenderingContext2D, point: Point, scale: number, faded: boolean, wobble: number): void {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(wobble);
    ctx.translate(-point.x, -point.y);
    ctx.globalAlpha = faded ? 0.34 : 1;
    this.drawSquashShadow(ctx, point.x, point.y + 18 * scale, 25 * scale, 8 * scale);
    const cone = ctx.createLinearGradient(point.x - 16 * scale, point.y - 26 * scale, point.x + 16 * scale, point.y + 22 * scale);
    cone.addColorStop(0, "#ffcf6a");
    cone.addColorStop(0.45, "#ff8a2a");
    cone.addColorStop(1, "#df4c42");
    ctx.fillStyle = cone;
    ctx.strokeStyle = "#612338";
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - 27 * scale);
    ctx.quadraticCurveTo(point.x - 20 * scale, point.y + 12 * scale, point.x - 15 * scale, point.y + 21 * scale);
    ctx.lineTo(point.x + 15 * scale, point.y + 21 * scale);
    ctx.quadraticCurveTo(point.x + 20 * scale, point.y + 12 * scale, point.x, point.y - 27 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff176";
    this.roundRect(ctx, point.x - 15 * scale, point.y + 3 * scale, 30 * scale, 6 * scale, 3 * scale);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
    ctx.beginPath();
    ctx.ellipse(point.x - 5 * scale, point.y - 10 * scale, 4 * scale, 9 * scale, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBarrel(ctx: CanvasRenderingContext2D, point: Point, scale: number, faded: boolean): void {
    ctx.save();
    ctx.globalAlpha = faded ? 0.34 : 1;
    this.drawSquashShadow(ctx, point.x, point.y + 20 * scale, 30 * scale, 8 * scale);
    const gradient = ctx.createLinearGradient(point.x - 20 * scale, point.y, point.x + 20 * scale, point.y);
    gradient.addColorStop(0, "#902d49");
    gradient.addColorStop(0.5, "#ff536e");
    gradient.addColorStop(1, "#8d2440");
    ctx.fillStyle = gradient;
    ctx.strokeStyle = "#4a172b";
    ctx.lineWidth = 3 * scale;
    this.roundRect(ctx, point.x - 20 * scale, point.y - 25 * scale, 40 * scale, 50 * scale, 12 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff176";
    this.roundRect(ctx, point.x - 18 * scale, point.y - 7 * scale, 36 * scale, 7 * scale, 4 * scale);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
    this.roundRect(ctx, point.x - 11 * scale, point.y - 18 * scale, 7 * scale, 25 * scale, 4 * scale);
    ctx.fill();
    ctx.fillStyle = "#6b2035";
    ctx.beginPath();
    ctx.ellipse(point.x, point.y - 24 * scale, 18 * scale, 6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawOil(ctx: CanvasRenderingContext2D, point: Point, scale: number, frame: number, id: number): void {
    ctx.save();
    this.drawSquashShadow(ctx, point.x, point.y + 10 * scale, 36 * scale, 8 * scale);
    ctx.fillStyle = "rgba(7, 10, 22, 0.88)";
    ctx.strokeStyle = "#694cff";
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, 32 * scale, 18 * scale, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const shimmer = Math.sin(frame * 0.16 + id) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(57, 224, 255, ${0.55 + shimmer * 0.28})`;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.ellipse(point.x - 4 * scale, point.y - 3 * scale, 18 * scale, 7 * scale, -0.25, 0, Math.PI * 1.65);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 138, 160, 0.32)";
    ctx.beginPath();
    ctx.ellipse(point.x + 10 * scale, point.y + 3 * scale, 8 * scale, 4 * scale, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawGate(ctx: CanvasRenderingContext2D, point: Point, scale: number, faded: boolean): void {
    ctx.save();
    ctx.globalAlpha = faded ? 0.34 : 1;
    this.drawSquashShadow(ctx, point.x, point.y + 18 * scale, 48 * scale, 8 * scale);
    ctx.translate(point.x, point.y);
    ctx.rotate(-0.05);
    const body = ctx.createLinearGradient(-40 * scale, -16 * scale, 40 * scale, 16 * scale);
    body.addColorStop(0, "#f8fbff");
    body.addColorStop(0.5, "#fff176");
    body.addColorStop(1, "#f8fbff");
    ctx.fillStyle = body;
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 3 * scale;
    this.roundRect(ctx, -40 * scale, -16 * scale, 80 * scale, 32 * scale, 10 * scale);
    ctx.fill();
    ctx.stroke();
    for (let index = -3; index <= 3; index += 1) {
      ctx.strokeStyle = index % 2 === 0 ? "#ff536e" : "#ffb35c";
      ctx.lineWidth = 8 * scale;
      ctx.beginPath();
      ctx.moveTo((index * 13 - 7) * scale, -14 * scale);
      ctx.lineTo((index * 13 + 13) * scale, 14 * scale);
      ctx.stroke();
    }
    ctx.fillStyle = "#10253d";
    ctx.beginPath();
    ctx.arc(-34 * scale, 0, 7 * scale, 0, Math.PI * 2);
    ctx.arc(34 * scale, 0, 7 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRivalCar(
    ctx: CanvasRenderingContext2D,
    point: Point,
    angle: number,
    size: number,
    tagged: boolean,
    frame: number
  ): void {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.globalAlpha = tagged ? 0.65 + Math.sin(frame * 0.5) * 0.16 : 1;
    this.drawCartShadow(ctx, size / PLAYER_RADIUS);
    const rivalBody = ctx.createLinearGradient(-size, -size * 1.2, size, size * 1.2);
    rivalBody.addColorStop(0, "#d8b8ff");
    rivalBody.addColorStop(0.38, "#8e6bff");
    rivalBody.addColorStop(1, "#4f38b5");
    ctx.fillStyle = rivalBody;
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 3;
    this.roundRect(ctx, -size * 0.78, -size * 1.18, size * 1.56, size * 2.2, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#13243d";
    this.roundRect(ctx, -size * 0.98, -size * 0.72, size * 0.32, size * 0.52, 4);
    ctx.fill();
    this.roundRect(ctx, size * 0.66, -size * 0.72, size * 0.32, size * 0.52, 4);
    ctx.fill();
    this.roundRect(ctx, -size * 0.98, size * 0.38, size * 0.32, size * 0.52, 4);
    ctx.fill();
    this.roundRect(ctx, size * 0.66, size * 0.38, size * 0.32, size * 0.52, 4);
    ctx.fill();
    ctx.fillStyle = "#f4d9ff";
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.24);
    ctx.lineTo(size * 0.5, -size * 0.28);
    ctx.lineTo(-size * 0.5, -size * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-size * 0.42, size * 0.62);
    ctx.lineTo(size * 0.42, size * 0.62);
    ctx.stroke();
    if (tagged) {
      ctx.strokeStyle = "#fff176";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCartBody(ctx: CanvasRenderingContext2D, state: GameState, scale: number, recoil: number): void {
    const wheelSpin = state.player.progress * 0.065;
    const bodyLift = isBoosting(state.player) ? -3 * scale : 0;

    ctx.save();
    ctx.translate(0, bodyLift);
    this.drawWheel(ctx, -20 * scale, -19 * scale, 10 * scale, wheelSpin);
    this.drawWheel(ctx, 20 * scale, -19 * scale, 10 * scale, wheelSpin);
    this.drawWheel(ctx, -21 * scale, 20 * scale, 11 * scale, wheelSpin);
    this.drawWheel(ctx, 21 * scale, 20 * scale, 11 * scale, wheelSpin);

    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 5 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-21 * scale, 17 * scale);
    ctx.lineTo(21 * scale, 17 * scale);
    ctx.moveTo(-19 * scale, -17 * scale);
    ctx.lineTo(19 * scale, -17 * scale);
    ctx.stroke();

    const body = ctx.createLinearGradient(-25 * scale, -34 * scale, 25 * scale, 34 * scale);
    body.addColorStop(0, "#ffd76f");
    body.addColorStop(0.3, "#ff6d85");
    body.addColorStop(0.72, "#dc315f");
    body.addColorStop(1, "#8c2548");
    ctx.fillStyle = body;
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 3.5 * scale;
    this.roundRect(ctx, -25 * scale, -34 * scale, 50 * scale, 68 * scale, 15 * scale);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#10253d";
    this.roundRect(ctx, -17 * scale, 13 * scale, 34 * scale, 10 * scale, 5 * scale);
    ctx.fill();
    ctx.fillStyle = "#fff176";
    this.roundRect(ctx, -10 * scale, 16 * scale, 20 * scale, 4 * scale, 2 * scale);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
    this.roundRect(ctx, -14 * scale, -27 * scale, 28 * scale, 13 * scale, 7 * scale);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    this.roundRect(ctx, 8 * scale, -5 * scale, 8 * scale, 25 * scale, 4 * scale);
    ctx.fill();

    ctx.save();
    ctx.translate(0, (-20 - recoil * 8) * scale);
    ctx.fillStyle = "#10253d";
    ctx.beginPath();
    ctx.arc(0, 8 * scale, 14 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#29f6df";
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    ctx.strokeStyle = "#13243d";
    ctx.lineWidth = 10 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 7 * scale);
    ctx.lineTo(0, -37 * scale);
    ctx.stroke();
    ctx.strokeStyle = "#f7fbff";
    ctx.lineWidth = 5 * scale;
    ctx.beginPath();
    ctx.moveTo(0, 5 * scale);
    ctx.lineTo(0, -34 * scale);
    ctx.stroke();
    ctx.fillStyle = "#39e0ff";
    ctx.beginPath();
    ctx.arc(0, 8 * scale, 6.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    if (recoil > 0) {
      ctx.fillStyle = `rgba(255, 241, 118, ${recoil})`;
      ctx.beginPath();
      ctx.moveTo(0, -48 * scale);
      ctx.lineTo(-11 * scale * recoil, -28 * scale);
      ctx.lineTo(11 * scale * recoil, -28 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${recoil})`;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(0, -52 * scale);
      ctx.lineTo(0, -64 * scale);
      ctx.moveTo(-12 * scale, -45 * scale);
      ctx.lineTo(-22 * scale, -53 * scale);
      ctx.moveTo(12 * scale, -45 * scale);
      ctx.lineTo(22 * scale, -53 * scale);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  private drawBoostFlame(ctx: CanvasRenderingContext2D, state: GameState, scale: number): void {
    if (!isBoosting(state.player)) {
      return;
    }

    const pulse = 0.65 + Math.sin(state.frame * 0.52) * 0.22;
    ctx.save();
    ctx.fillStyle = `rgba(57, 224, 255, ${0.68 + pulse * 0.2})`;
    ctx.beginPath();
    ctx.moveTo(-13 * scale, 30 * scale);
    ctx.quadraticCurveTo(0, (63 + pulse * 8) * scale, 13 * scale, 30 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff176";
    ctx.beginPath();
    ctx.moveTo(-7 * scale, 30 * scale);
    ctx.quadraticCurveTo(0, (50 + pulse * 7) * scale, 7 * scale, 30 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawCartShadow(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.26)";
    ctx.beginPath();
    ctx.ellipse(0, 20 * scale, 32 * scale, 14 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, spin: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.fillStyle = "#11182a";
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f7fbff";
    ctx.lineWidth = Math.max(2, radius * 0.24);
    ctx.beginPath();
    ctx.moveTo(-radius * 0.62, 0);
    ctx.lineTo(radius * 0.62, 0);
    ctx.moveTo(0, -radius * 0.62);
    ctx.lineTo(0, radius * 0.62);
    ctx.stroke();
    ctx.restore();
  }

  private drawSquashShadow(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.beginPath();
    ctx.moveTo(x + 5 * scale, y - 22 * scale);
    ctx.lineTo(x - 10 * scale, y + 1 * scale);
    ctx.lineTo(x + 1 * scale, y + 1 * scale);
    ctx.lineTo(x - 5 * scale, y + 22 * scale);
    ctx.lineTo(x + 13 * scale, y - 5 * scale);
    ctx.lineTo(x + 2 * scale, y - 5 * scale);
    ctx.closePath();
    ctx.fill();
  }

  private drawShieldIcon(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y - 20 * scale);
    ctx.quadraticCurveTo(x + 18 * scale, y - 15 * scale, x + 16 * scale, y + 1 * scale);
    ctx.quadraticCurveTo(x + 13 * scale, y + 14 * scale, x, y + 22 * scale);
    ctx.quadraticCurveTo(x - 13 * scale, y + 14 * scale, x - 16 * scale, y + 1 * scale);
    ctx.quadraticCurveTo(x - 18 * scale, y - 15 * scale, x, y - 20 * scale);
    ctx.closePath();
    ctx.fill();
  }

  private drawHex(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    ctx.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 6;
      const pointX = x + Math.cos(angle) * radius;
      const pointY = y + Math.sin(angle) * radius;
      if (index === 0) {
        ctx.moveTo(pointX, pointY);
      } else {
        ctx.lineTo(pointX, pointY);
      }
    }
    ctx.closePath();
  }

  private isVisible(point: Point, margin: number): boolean {
    return (
      point.x > -margin &&
      point.x < this.viewport.width + margin &&
      point.y > -margin &&
      point.y < this.viewport.height + margin
    );
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }
}

function colorForObstacle(kind: ObstacleKind): string {
  if (kind === "cone") {
    return "#ffb35c";
  }

  if (kind === "barrel") {
    return "#ff536e";
  }

  if (kind === "gate") {
    return "#fff176";
  }

  return "#39e0ff";
}

function indexColor(label: string): string {
  if (label === "TIME") {
    return "#2364a6";
  }

  if (label === "CLEARED") {
    return "#14895d";
  }

  if (label === "PICKUPS USED") {
    return "#7052c8";
  }

  if (label === "CANNON HITS") {
    return "#d74365";
  }

  return "#10253d";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}
