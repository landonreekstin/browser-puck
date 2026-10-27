import type { Config, Vec } from "@puck/shared";

/** Maps world units to canvas CSS pixels: the rink is fitted and centred with a margin. */
export class View {
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  fit(cfg: Config, width: number, height: number): void {
    const margin = 48;
    this.scale = Math.min(
      (width - 2 * margin) / cfg.rink.width,
      (height - 2 * margin) / cfg.rink.height,
    );
    this.offsetX = (width - cfg.rink.width * this.scale) / 2;
    this.offsetY = (height - cfg.rink.height * this.scale) / 2;
  }

  toScreen(p: Vec): Vec {
    return { x: this.offsetX + p.x * this.scale, y: this.offsetY + p.y * this.scale };
  }

  toWorld(p: Vec): Vec {
    return { x: (p.x - this.offsetX) / this.scale, y: (p.y - this.offsetY) / this.scale };
  }
}
