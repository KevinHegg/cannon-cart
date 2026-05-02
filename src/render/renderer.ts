import {
  BARREL_LENGTH,
  BARREL_THICKNESS,
  CART_HEIGHT,
  CART_SCREEN_X_RATIO,
  CART_SCREEN_Y_RATIO,
  CART_WIDTH,
  PROJECTILE_RADIUS,
  TERRAIN_SEGMENT_WIDTH,
  WHEEL_RADIUS
} from "../game/constants";
import { GameState, getCartGroundY } from "../sim/state";
import { getTerrainHeight } from "../sim/terrain";

interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

export class Renderer {
  private readonly context: CanvasRenderingContext2D;
  private viewport: Viewport = { width: 1, height: 1, dpr: 1 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D is not available.");
    }

    this.context = context;
    this.resize();
  }

  getCartScreenPosition(): ScreenPoint {
    return {
      x: this.viewport.width * CART_SCREEN_X_RATIO,
      y: this.viewport.height * CART_SCREEN_Y_RATIO
    };
  }

  draw(state: GameState): void {
    this.resize();

    const ctx = this.context;
    const cartGroundY = getCartGroundY(state);
    const cartScreen = this.getCartScreenPosition();
    const cameraLeftX = state.worldX - cartScreen.x;

    this.drawSky(ctx);
    this.drawHills(ctx, state, cameraLeftX);
    this.drawTerrain(ctx, state, cameraLeftX, cartGroundY, cartScreen.y);
    this.drawTargets(ctx, state, cameraLeftX, cartGroundY, cartScreen.y);
    this.drawProjectiles(ctx, state, cameraLeftX, cartGroundY, cartScreen.y);
    this.drawAimGuide(ctx, state, cartScreen);
    this.drawCart(ctx, state, cartScreen);
    this.drawHud(ctx, state);
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

  private worldToScreen(
    worldX: number,
    worldY: number,
    cameraLeftX: number,
    cartGroundY: number,
    cartScreenY: number
  ): ScreenPoint {
    return {
      x: worldX - cameraLeftX,
      y: cartScreenY - (worldY - cartGroundY)
    };
  }

  private drawSky(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.viewport.height);
    gradient.addColorStop(0, "#78cdf3");
    gradient.addColorStop(0.58, "#bce9ff");
    gradient.addColorStop(1, "#f8f0cf");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
  }

  private drawHills(ctx: CanvasRenderingContext2D, state: GameState, cameraLeftX: number): void {
    this.drawHillLayer(ctx, state.seed, cameraLeftX * 0.18, 0.61, "#6dbf8f", 0.32);
    this.drawHillLayer(ctx, state.seed, cameraLeftX * 0.34 + 220, 0.68, "#3f9d7a", 0.5);
  }

  private drawHillLayer(
    ctx: CanvasRenderingContext2D,
    seed: string,
    offsetX: number,
    baselineRatio: number,
    color: string,
    alpha: number
  ): void {
    const baseline = this.viewport.height * baselineRatio;
    const step = 80;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, this.viewport.height);

    for (let screenX = -step; screenX <= this.viewport.width + step; screenX += step) {
      const worldX = offsetX + screenX;
      const hill = getTerrainHeight(`${seed}:hills`, worldX) * 0.8;
      ctx.lineTo(screenX, baseline - hill);
    }

    ctx.lineTo(this.viewport.width + step, this.viewport.height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawTerrain(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    cameraLeftX: number,
    cartGroundY: number,
    cartScreenY: number
  ): void {
    const step = TERRAIN_SEGMENT_WIDTH / 4;

    ctx.fillStyle = "#2b6c43";
    ctx.beginPath();
    ctx.moveTo(0, this.viewport.height);

    for (let screenX = -step; screenX <= this.viewport.width + step; screenX += step) {
      const worldX = cameraLeftX + screenX;
      const groundY = getTerrainHeight(state.seed, worldX);
      const screen = this.worldToScreen(worldX, groundY, cameraLeftX, cartGroundY, cartScreenY);
      ctx.lineTo(screen.x, screen.y);
    }

    ctx.lineTo(this.viewport.width + step, this.viewport.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#194d30";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private drawTargets(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    cameraLeftX: number,
    cartGroundY: number,
    cartScreenY: number
  ): void {
    for (const target of state.targets) {
      if (target.hit) {
        continue;
      }

      const screen = this.worldToScreen(target.x, target.y, cameraLeftX, cartGroundY, cartScreenY);

      if (screen.x < -80 || screen.x > this.viewport.width + 80) {
        continue;
      }

      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.fillStyle = "#f8f4e8";
      ctx.strokeStyle = "#653832";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, target.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "#d5473d";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, target.radius * 0.58, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#d5473d";
      ctx.beginPath();
      ctx.arc(0, 0, target.radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    cameraLeftX: number,
    cartGroundY: number,
    cartScreenY: number
  ): void {
    ctx.fillStyle = "#1b1f24";

    for (const projectile of state.projectiles) {
      const screen = this.worldToScreen(
        projectile.x,
        projectile.y,
        cameraLeftX,
        cartGroundY,
        cartScreenY
      );

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawAimGuide(ctx: CanvasRenderingContext2D, state: GameState, cartScreen: ScreenPoint): void {
    ctx.save();
    ctx.strokeStyle = "rgba(27, 31, 36, 0.28)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(cartScreen.x, cartScreen.y - 23);

    for (let dot = 1; dot <= 8; dot += 1) {
      const travel = dot * 21;
      ctx.lineTo(
        cartScreen.x + state.aim.x * travel,
        cartScreen.y - 23 - state.aim.y * travel + dot * dot * 1.8
      );
    }

    ctx.stroke();
    ctx.restore();
  }

  private drawCart(ctx: CanvasRenderingContext2D, state: GameState, cartScreen: ScreenPoint): void {
    const bodyY = cartScreen.y - CART_HEIGHT;
    const barrelPivot = {
      x: cartScreen.x + 6,
      y: bodyY + 7
    };

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2d3034";
    ctx.lineWidth = BARREL_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(barrelPivot.x, barrelPivot.y);
    ctx.lineTo(
      barrelPivot.x + state.aim.x * BARREL_LENGTH,
      barrelPivot.y - state.aim.y * BARREL_LENGTH
    );
    ctx.stroke();

    ctx.fillStyle = "#c64532";
    ctx.strokeStyle = "#722a25";
    ctx.lineWidth = 3;
    this.roundRect(ctx, cartScreen.x - CART_WIDTH / 2, bodyY, CART_WIDTH, CART_HEIGHT, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#352f2b";
    ctx.beginPath();
    ctx.arc(cartScreen.x - 15, cartScreen.y + 1, WHEEL_RADIUS, 0, Math.PI * 2);
    ctx.arc(cartScreen.x + 16, cartScreen.y + 1, WHEEL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#f3d36a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cartScreen.x - 15, cartScreen.y + 1, WHEEL_RADIUS * 0.45, 0, Math.PI * 2);
    ctx.arc(cartScreen.x + 16, cartScreen.y + 1, WHEEL_RADIUS * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
    ctx.save();
    ctx.fillStyle = "rgba(16, 24, 32, 0.72)";
    ctx.fillRect(0, 0, this.viewport.width, 46);

    const scoreText = `Score ${state.score}`;
    const seedText =
      state.seed.length > 18 ? `Seed ${state.seed.slice(0, 15)}...` : `Seed ${state.seed}`;

    ctx.fillStyle = "#fffaf0";
    ctx.font = "700 18px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(scoreText, 16, 23);

    if (this.viewport.width >= 420) {
      ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(seedText, this.viewport.width - 16, 23);
    }

    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
