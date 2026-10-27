import { distance, type Config, type GameEvent, type Team, type Vec, type World } from "@puck/shared";
import { teamColor } from "./render";

interface Ring { at: Vec; color: string; age: number; life: number; size: number }
interface Particle { pos: Vec; vel: Vec; color: string; age: number; life: number }

const teamOfPiece = (id: string | undefined): Team | null =>
  id?.startsWith("t0") ? 0 : id?.startsWith("t1") ? 1 : null;

/**
 * Purely cosmetic effects (ROADMAP M5): puck trail, impact rings, piece flashes, goal
 * particles and banner, a little screen shake. Driven by GameEvents and the rendered world.
 */
export class Effects {
  private trail: Vec[] = [];
  private rings: Ring[] = [];
  private particles: Particle[] = [];
  private flashes = new Map<string, number>();
  private banner: { text: string; color: string; age: number } | null = null;
  private shakeTime = 0;
  /** Math.random is fine here: effects are cosmetic and never feed back into the sim. */
  private rand = Math.random;

  constructor(private readonly cfg: Config) {}

  event(e: GameEvent, world: World): void {
    const cfg = this.cfg;
    switch (e.type) {
      case "hit": {
        const team = teamOfPiece(e.pieceId);
        const color = team === null ? "#ffffff" : teamColor[team];
        const strength = Math.min(1, e.impact / cfg.launch.maxSpeed);
        this.rings.push({ at: e.point, color, age: 0, life: 0.35, size: 14 + 40 * strength });
        if (e.pieceId) this.flashes.set(e.pieceId, Math.max(this.flashes.get(e.pieceId) ?? 0, 0.4 + 0.6 * strength));
        break;
      }
      case "launch": {
        this.rings.push({ at: { ...world.puck.pos }, color: teamColor[e.team], age: 0, life: 0.4, size: 50 });
        break;
      }
      case "possession": {
        const g = world.goalies.find((x) => x.team === e.team);
        if (g) this.rings.push({ at: { ...g.pos }, color: teamColor[e.team], age: 0, life: 0.5, size: cfg.goalie.radius * 2 });
        break;
      }
      case "goal": {
        // Burst out of the goal that was scored on.
        const x = e.team === 0 ? cfg.rink.width : 0;
        const dir = e.team === 0 ? -1 : 1;
        for (let i = 0; i < 80; i++) {
          const a = (this.rand() - 0.5) * Math.PI * 0.9;
          const speed = 150 + this.rand() * 650;
          this.particles.push({
            pos: { x, y: cfg.rink.height / 2 + (this.rand() - 0.5) * cfg.goal.width },
            vel: { x: Math.cos(a) * speed * dir, y: Math.sin(a) * speed },
            color: i % 3 === 0 ? "#ffffff" : teamColor[e.team],
            age: 0,
            life: 0.7 + this.rand() * 0.8,
          });
        }
        this.banner = { text: "GOAL!", color: teamColor[e.team], age: 0 };
        this.shakeTime = 0.35;
        this.trail = [];
        break;
      }
    }
  }

  /** Advances effects and records the rendered puck for the trail. */
  update(dt: number, world: World): void {
    const puck = world.puck.pos;
    const last = this.trail.at(-1);
    if (world.puck.heldBy !== null || (last && distance(last, puck) > 200)) this.trail = [];
    else this.trail.push({ ...puck });
    if (this.trail.length > 14) this.trail.shift();

    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const p of this.particles) {
      p.age += dt;
      p.pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt };
      p.vel = { x: p.vel.x * (1 - 2 * dt), y: p.vel.y * (1 - 2 * dt) };
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const [id, f] of this.flashes) {
      const next = f - dt * 4;
      if (next <= 0) this.flashes.delete(id);
      else this.flashes.set(id, next);
    }
    if (this.banner && (this.banner.age += dt) > 1.4) this.banner = null;
    this.shakeTime = Math.max(0, this.shakeTime - dt);
  }

  /** 0–1 highlight for a piece that was just hit. */
  flash(id: string): number {
    return this.flashes.get(id) ?? 0;
  }

  /** Screen-space offset for the shake (CSS px). */
  shake(): Vec {
    if (this.shakeTime <= 0) return { x: 0, y: 0 };
    const k = this.shakeTime * 18;
    return { x: (this.rand() - 0.5) * k, y: (this.rand() - 0.5) * k };
  }

  /** Under the puck: the trail. World coordinates. */
  drawUnder(ctx: CanvasRenderingContext2D): void {
    const r = this.cfg.puck.radius;
    this.trail.forEach((p, i) => {
      const t = (i + 1) / this.trail.length;
      ctx.globalAlpha = 0.25 * t;
      ctx.fillStyle = "#f5f5f5";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /** Over everything in the rink: rings and particles. World coordinates. */
  drawOver(ctx: CanvasRenderingContext2D, px: number): void {
    for (const ring of this.rings) {
      const t = ring.age / ring.life;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = (3 - 2 * t) * px * 1.5;
      ctx.beginPath();
      ctx.arc(ring.at.x, ring.at.y, ring.size * (0.3 + 0.7 * t), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.pos.x - 3 * px, p.pos.y - 3 * px, 6 * px, 6 * px);
    }
    ctx.globalAlpha = 1;
  }

  /** Screen space: the GOAL! banner. */
  drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.banner) return;
    const t = this.banner.age;
    const scale = t < 0.2 ? 0.6 + 2 * t : 1;
    ctx.save();
    ctx.globalAlpha = t > 1 ? Math.max(0, 1 - (t - 1) / 0.4) : 1;
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 96px ui-monospace, monospace";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(this.banner.text, 0, 0);
    ctx.fillStyle = this.banner.color;
    ctx.fillText(this.banner.text, 0, 0);
    ctx.restore();
  }
}
