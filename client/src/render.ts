import {
  barSegment,
  fromAngle,
  goalieBox,
  launchVelocity,
  length,
  lerp,
  type Config,
  type Contact,
  type Launch,
  type Team,
  type Vec,
  type World,
} from "@puck/shared";
import type { View } from "./view";

export const teamColor: Record<Team, string> = { 0: "#4aa3ff", 1: "#ff6b6b" };
const colors = {
  background: "#111418",
  floor: "#1b2129",
  line: "#3a4350",
  wall: "#c9d1d9",
  puck: "#f5f5f5",
  text: "#e6edf3",
  dim: "#8b949e",
  aim: "#ffd866",
  debug: "#7ee787",
};

export interface Frame {
  cfg: Config;
  view: View;
  world: World;
  selectedId: string;
  /** Set while the selected goalie is aiming. */
  aim: { launch: Launch | null; path: Vec[] } | null;
  debug: { contacts: { contact: Contact; age: number }[]; fps: number; substeps: number; net: string } | null;
  goalFlash: number;
}

/** Positions blended between two ticks for smooth rendering at any frame rate. */
export function interpolate(prev: World, cur: World, alpha: number): World {
  return {
    ...cur,
    puck: { ...cur.puck, pos: lerp(prev.puck.pos, cur.puck.pos, alpha) },
    goalies: cur.goalies.map((g, i) => ({ ...g, pos: lerp(prev.goalies[i]?.pos ?? g.pos, g.pos, alpha) })),
    blockers: cur.blockers.map((b, i) => {
      const p = prev.blockers[i] ?? b;
      return { ...b, pos: lerp(p.pos, b.pos, alpha), angle: p.angle + (b.angle - p.angle) * alpha };
    }),
  };
}

export function render(ctx: CanvasRenderingContext2D, width: number, height: number, f: Frame): void {
  const { cfg, view, world } = f;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  const px = 1 / view.scale; // one CSS pixel, in world units

  drawRink(ctx, cfg, px, f.goalFlash);

  for (const b of world.blockers) {
    const seg = barSegment(b.pos, b.angle, cfg.bar.length);
    if (b.id === f.selectedId) {
      strokeCapsule(ctx, seg.a, seg.b, cfg.bar.thickness + 8 * px, "rgba(255,255,255,0.35)");
    }
    strokeCapsule(ctx, seg.a, seg.b, cfg.bar.thickness, teamColor[b.team]);
  }

  for (const g of world.goalies) {
    if (g.id === f.selectedId) {
      circle(ctx, g.pos, cfg.goalie.radius + 4 * px, "rgba(255,255,255,0.35)");
    }
    circle(ctx, g.pos, cfg.goalie.radius, teamColor[g.team]);
    circle(ctx, g.pos, cfg.goalie.radius * 0.55, "rgba(0,0,0,0.25)");
  }

  if (f.aim) drawAim(ctx, cfg, world, f.aim, px);

  circle(ctx, world.puck.pos, cfg.puck.radius, colors.puck);
  if (f.debug) drawDebug(ctx, world, f.debug, px);
  ctx.restore();

  drawHud(ctx, width, height, f);
}

function drawRink(ctx: CanvasRenderingContext2D, cfg: Config, px: number, goalFlash: number): void {
  const { width: w, height: h } = cfg.rink;
  ctx.fillStyle = colors.floor;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2 * px;
  line(ctx, { x: w / 2, y: 0 }, { x: w / 2, y: h });
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h * 0.15, 0, Math.PI * 2);
  ctx.stroke();

  for (const team of [0, 1] as const) {
    const box = goalieBox(cfg, team);
    ctx.fillStyle = team === 0 ? "rgba(74,163,255,0.08)" : "rgba(255,107,107,0.08)";
    ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.strokeStyle = teamColor[team];
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.globalAlpha = 1;

    // Goal mouth: a coloured pocket behind the goal line.
    const x = team === 0 ? -24 : w;
    ctx.fillStyle = teamColor[team];
    ctx.globalAlpha = 0.25 + 0.6 * goalFlash;
    ctx.fillRect(x, (h - cfg.goal.width) / 2, 24, cfg.goal.width);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = colors.wall;
  ctx.lineWidth = 4 * px;
  ctx.lineCap = "round";
  const g0 = (h - cfg.goal.width) / 2;
  const g1 = (h + cfg.goal.width) / 2;
  ctx.beginPath();
  ctx.moveTo(0, g0);
  ctx.lineTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, g0);
  ctx.moveTo(0, g1);
  ctx.lineTo(0, h);
  ctx.lineTo(w, h);
  ctx.lineTo(w, g1);
  ctx.stroke();
}

function drawAim(
  ctx: CanvasRenderingContext2D,
  cfg: Config,
  world: World,
  aim: NonNullable<Frame["aim"]>,
  px: number,
): void {
  const from = world.puck.pos;
  if (aim.path.length > 1) {
    ctx.strokeStyle = colors.aim;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([8 * px, 8 * px]);
    ctx.beginPath();
    ctx.moveTo(aim.path[0]!.x, aim.path[0]!.y);
    for (const p of aim.path) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (!aim.launch) return;

  // Aim arrow, length ∝ power; power meter next to it.
  const power = aim.launch.power;
  const tip = { x: from.x + Math.cos(aim.launch.angle) * (40 + 120 * power), y: from.y + Math.sin(aim.launch.angle) * (40 + 120 * power) };
  ctx.strokeStyle = colors.aim;
  ctx.lineWidth = 4 * px;
  line(ctx, from, tip);

  const meterH = 80;
  const mx = from.x + cfg.goalie.radius + 14;
  const my = Math.min(Math.max(from.y - meterH / 2, 4), cfg.rink.height - meterH - 4);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(mx, my, 10, meterH);
  ctx.fillStyle = `hsl(${120 - 120 * power}, 80%, 55%)`;
  ctx.fillRect(mx, my + meterH * (1 - power), 10, meterH * power);
  ctx.fillStyle = colors.text;
  ctx.font = `${12 * px}px ui-monospace, monospace`;
  ctx.fillText(`${Math.round(length(launchVelocity(aim.launch, cfg)))}`, mx + 14, my + 10);
}

function drawDebug(
  ctx: CanvasRenderingContext2D,
  world: World,
  debug: NonNullable<Frame["debug"]>,
  px: number,
): void {
  const { pos, vel } = world.puck;
  ctx.strokeStyle = colors.debug;
  ctx.lineWidth = 2 * px;
  line(ctx, pos, { x: pos.x + vel.x * 0.1, y: pos.y + vel.y * 0.1 }); // 0.1 s of travel

  for (const { contact, age } of debug.contacts) {
    ctx.globalAlpha = Math.max(0, 1 - age / 0.8);
    ctx.strokeStyle = "#ff79c6";
    line(ctx, contact.point, { x: contact.point.x + contact.normal.x * 30, y: contact.point.y + contact.normal.y * 30 });
    circle(ctx, contact.point, 3 * px, "#ff79c6");
  }
  ctx.globalAlpha = 1;

  // Bar facing normals, to read deflection angles.
  ctx.strokeStyle = "rgba(126,231,135,0.4)";
  for (const b of world.blockers) {
    const n = fromAngle(b.angle + Math.PI / 2, 18);
    line(ctx, { x: b.pos.x - n.x, y: b.pos.y - n.y }, { x: b.pos.x + n.x, y: b.pos.y + n.y });
  }
}

function drawHud(ctx: CanvasRenderingContext2D, width: number, height: number, f: Frame): void {
  const { world } = f;
  ctx.textBaseline = "top";
  ctx.font = "bold 28px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = teamColor[0];
  ctx.fillText(String(world.score[0]), width / 2 - 40, 10);
  ctx.fillStyle = colors.dim;
  ctx.fillText(":", width / 2, 10);
  ctx.fillStyle = teamColor[1];
  ctx.fillText(String(world.score[1]), width / 2 + 40, 10);

  ctx.textAlign = "left";
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillStyle = colors.dim;
  ctx.fillText(
    `selected: ${f.selectedId}   1–6/Tab select · mouse move · drag shoot (goalie) · wheel/Q/E rotate (bar) · R give puck · F3 debug · T tuning`,
    12,
    height - 22,
  );

  if (f.debug) {
    const { vel } = world.puck;
    const lines = [
      `fps ${f.debug.fps.toFixed(0)}   tick ${world.tick}   substeps ${f.debug.substeps}`,
      `puck ${length(vel).toFixed(0)} u/s  (${vel.x.toFixed(0)}, ${vel.y.toFixed(0)})  held: ${world.puck.heldBy ?? "-"}`,
      `server ${f.debug.net}`,
    ];
    ctx.fillStyle = colors.debug;
    lines.forEach((l, i) => ctx.fillText(l, 12, 12 + i * 16));
  }
}

function circle(ctx: CanvasRenderingContext2D, c: Vec, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function strokeCapsule(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, thickness: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  line(ctx, a, b);
}
