import { describe, expect, it } from "vitest";
import { cloneConfig, defaultConfig, type Config } from "../config";
import { createRng } from "../rng";
import { length, type Vec } from "../vec";
import { collideCapsule } from "./collide";
import { goalieBox } from "./geometry";
import { launchFromDrag, launchVelocity } from "./launch";
import { predictPath } from "./preview";
import { step, type Inputs } from "./step";
import { cloneWorld, createWorld, type World } from "./world";

const EPS = 1e-9;

/** A world with the puck loose at `pos` moving at `vel`. */
function loosePuck(cfg: Config, pos: Vec, vel: Vec): World {
  const world = createWorld(cfg);
  world.puck = { pos, vel, heldBy: null, passThroughGoalie: null, heldTicks: 0, deadTicks: 0 };
  return world;
}

function run(world: World, cfg: Config, ticks: number, inputs: Inputs = {}): void {
  for (let i = 0; i < ticks; i++) step(world, cfg, inputs);
}

describe("collideCapsule", () => {
  it("never increases speed, even with restitution set above 1", () => {
    const rand = createRng(1);
    for (let i = 0; i < 20000; i++) {
      const a = { x: rand() * 200, y: rand() * 200 };
      const b = rand() < 0.2 ? a : { x: rand() * 200, y: rand() * 200 };
      const body = {
        pos: { x: rand() * 200, y: rand() * 200 },
        vel: { x: (rand() - 0.5) * 4000, y: (rand() - 0.5) * 4000 },
      };
      const before = length(body.vel);
      collideCapsule(body, 16, a, b, rand() * 20, rand() * 1.5);
      expect(length(body.vel)).toBeLessThanOrEqual(before + EPS);
    }
  });
});

describe("blockers never add energy (rule 4)", () => {
  it("puck speed never rises across a whole sim of thrashing bars and goalies", () => {
    const cfg = defaultConfig;
    const rand = createRng(42);
    const { width: w, height: h } = cfg.rink;
    for (let runIdx = 0; runIdx < 150; runIdx++) {
      const speed = rand() * cfg.launch.maxSpeed;
      const dir = rand() * Math.PI * 2;
      const world = loosePuck(
        cfg,
        { x: 150 + rand() * (w - 300), y: 50 + rand() * (h - 100) },
        { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
      );
      for (let t = 0; t < 240; t++) {
        const inputs: Inputs = {};
        for (const p of [...world.blockers, ...world.goalies]) {
          inputs[p.id] = {
            target: { x: rand() * w, y: rand() * h },
            targetAngle: (rand() - 0.5) * 20,
          };
        }
        const before = length(world.puck.vel);
        const events = step(world, cfg, inputs);
        // The only sanctioned energy source is a goalie launch (incl. the shot timer).
        if (!events.launched) expect(length(world.puck.vel)).toBeLessThanOrEqual(before + EPS);
      }
    }
  });

  it("a bar driven through a resting puck pushes it but gives it no velocity", () => {
    const cfg = defaultConfig;
    const world = loosePuck(cfg, { x: 400, y: 300 }, { x: 0, y: 0 });
    const bar = world.blockers[0]!;
    bar.pos = { x: 300, y: 300 };
    bar.target = { ...bar.pos };
    for (let t = 0; t < 60; t++) {
      step(world, cfg, { [bar.id]: { target: { x: 600, y: 300 } } });
      expect(world.puck.vel).toEqual({ x: 0, y: 0 });
    }
    expect(world.puck.pos.x).toBeGreaterThan(400);
  });

  it("a bar spinning through a resting puck gives it no velocity", () => {
    const cfg = defaultConfig;
    const world = loosePuck(cfg, { x: 400, y: 340 }, { x: 0, y: 0 });
    const bar = world.blockers[0]!;
    bar.pos = { x: 400, y: 300 };
    bar.target = { ...bar.pos };
    bar.angle = 0;
    for (let t = 0; t < 60; t++) {
      step(world, cfg, { [bar.id]: { targetAngle: bar.angle + 1 } });
      expect(world.puck.vel).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("tunneling", () => {
  const barX = 500;

  /** Fires the puck at a vertical bar; returns how many shots ended up behind it. */
  function shotsThroughBar(cfg: Config, speed: number): number {
    let through = 0;
    for (let offset = -50; offset <= 50; offset += 5) {
      for (const deg of [-40, -20, 0, 20, 40]) {
        const a = (deg * Math.PI) / 180;
        const world = loosePuck(cfg, { x: barX - 120, y: 300 + offset - Math.tan(a) * 120 }, {
          x: Math.cos(a) * speed,
          y: Math.sin(a) * speed,
        });
        world.blockers.splice(1);
        const bar = world.blockers[0]!;
        bar.pos = { x: barX, y: 300 };
        bar.target = { ...bar.pos };
        bar.angle = bar.targetAngle = Math.PI / 2;
        world.goalies[1]!.pos = world.goalies[1]!.target = { x: 1150, y: 200 };
        // Until it reflects: a puck still moving right past the bar went through it.
        for (let t = 0; t < 30 && world.puck.vel.x > 0; t++) {
          step(world, cfg, {});
          if (world.puck.pos.x > barX) {
            through++;
            break;
          }
        }
      }
    }
    return through;
  }

  it("a max-speed (and 4× max-speed) puck never passes through a bar", () => {
    expect(shotsThroughBar(defaultConfig, defaultConfig.launch.maxSpeed)).toBe(0);
    expect(shotsThroughBar(defaultConfig, defaultConfig.launch.maxSpeed * 4)).toBe(0);
  });

  it("the test can detect tunneling (substeps disabled)", () => {
    const cfg = cloneConfig(defaultConfig);
    cfg.sim.substepTravel = 1000;
    expect(shotsThroughBar(cfg, cfg.launch.maxSpeed * 2)).toBeGreaterThan(0);
  });

  it("a max-speed puck only ever leaves the rink through a goal mouth", () => {
    const cfg = defaultConfig;
    const { width: w, height: h } = cfg.rink;
    const r = cfg.puck.radius;
    const rand = createRng(7);
    for (let i = 0; i < 300; i++) {
      const dir = rand() * Math.PI * 2;
      const world = loosePuck(
        cfg,
        { x: 150 + rand() * (w - 300), y: 50 + rand() * (h - 100) },
        { x: Math.cos(dir) * cfg.launch.maxSpeed, y: Math.sin(dir) * cfg.launch.maxSpeed },
      );
      for (let t = 0; t < 300 && world.puck.heldBy === null; t++) {
        step(world, cfg, {});
        const { x, y } = world.puck.pos;
        if (world.puck.heldBy !== null) break;
        expect(y).toBeGreaterThanOrEqual(r - 1e-6);
        expect(y).toBeLessThanOrEqual(h - r + 1e-6);
        if (x < 0 || x > w) expect(Math.abs(y - h / 2)).toBeLessThan(cfg.goal.width / 2);
      }
    }
  });
});

describe("goals", () => {
  it("a straight shot into an open goal scores and hands the puck to the conceding goalie", () => {
    const cfg = defaultConfig;
    const world = createWorld(cfg);
    const [g0, g1] = world.goalies;
    g1!.pos = { x: 1150, y: 200 };
    g1!.target = { ...g1!.pos };

    let goal = step(world, cfg, { [g0!.id]: { launch: { angle: 0, power: 1 } } }).goal;
    for (let t = 0; t < 300 && !goal; t++) goal = step(world, cfg, {}).goal;

    expect(goal?.scoringTeam).toBe(0);
    expect(world.score).toEqual([1, 0]);
    expect(world.puck.heldBy).toBe(1);
  });
});

describe("confinement", () => {
  it("goalies stay in their box and bars stay in their half, outside the box", () => {
    const cfg = defaultConfig;
    const rand = createRng(3);
    const world = createWorld(cfg);
    for (let t = 0; t < 2000; t++) {
      const inputs: Inputs = {};
      for (const p of [...world.blockers, ...world.goalies]) {
        inputs[p.id] = { target: { x: rand() * 2000 - 400, y: rand() * 1200 - 300 } };
      }
      step(world, cfg, inputs);
      for (const g of world.goalies) {
        const box = goalieBox(cfg, g.team);
        expect(g.pos.x - cfg.goalie.radius).toBeGreaterThanOrEqual(box.minX - EPS);
        expect(g.pos.x + cfg.goalie.radius).toBeLessThanOrEqual(box.maxX + EPS);
        expect(g.pos.y - cfg.goalie.radius).toBeGreaterThanOrEqual(box.minY - EPS);
        expect(g.pos.y + cfg.goalie.radius).toBeLessThanOrEqual(box.maxY + EPS);
      }
      for (const b of world.blockers) {
        const half = cfg.rink.width / 2;
        if (b.team === 0) expect(b.pos.x).toBeLessThanOrEqual(half + EPS);
        else expect(b.pos.x).toBeGreaterThanOrEqual(half - EPS);
        const box = goalieBox(cfg, b.team);
        const m = cfg.bar.thickness / 2;
        const inBox =
          b.pos.x > box.minX - m + 1e-6 &&
          b.pos.x < box.maxX + m - 1e-6 &&
          b.pos.y > box.minY - m + 1e-6 &&
          b.pos.y < box.maxY + m - 1e-6;
        expect(inBox).toBe(false);
      }
    }
  });
});

describe("puck motion", () => {
  it("drag eventually stops a loose puck", () => {
    const cfg = cloneConfig(defaultConfig);
    cfg.rules.deadPuckSeconds = 0;
    const world = loosePuck(cfg, { x: 600, y: 100 }, { x: 0, y: 900 });
    run(world, cfg, 60 * 30);
    expect(world.puck.vel).toEqual({ x: 0, y: 0 });
  });

  it("a held puck moves with its goalie and can't be launched by the other goalie", () => {
    const cfg = defaultConfig;
    const world = createWorld(cfg);
    const [g0, g1] = world.goalies;
    run(world, cfg, 30, {
      [g0!.id]: { target: { x: 0, y: 0 } },
      [g1!.id]: { launch: { angle: 0, power: 1 } },
    });
    expect(world.puck.heldBy).toBe(0);
    expect(world.puck.pos).toEqual(g0!.pos);
    expect(world.puck.vel).toEqual({ x: 0, y: 0 });
  });

  it("is deterministic", () => {
    const cfg = defaultConfig;
    const a = createWorld(cfg);
    const b = cloneWorld(a);
    const script = (w: World, t: number): Inputs => ({
      [w.goalies[0]!.id]: t === 5 ? { launch: { angle: 0.3, power: 0.9 } } : {},
      [w.blockers[0]!.id]: { target: { x: 400, y: 100 + t }, targetAngle: t * 0.05 },
    });
    for (let t = 0; t < 400; t++) {
      step(a, cfg, script(a, t));
      step(b, cfg, script(b, t));
    }
    expect(a).toEqual(b);
  });
});

describe("launch", () => {
  it("maps a slingshot drag to the opposite direction with clamped power", () => {
    const cfg = defaultConfig;
    expect(launchFromDrag({ x: -5, y: 0 }, cfg)).toBeNull();
    const l = launchFromDrag({ x: -cfg.launch.maxDrag * 3, y: 0 }, cfg)!;
    expect(l.angle).toBeCloseTo(0);
    expect(l.power).toBe(1);
    const half = launchFromDrag({ x: 0, y: cfg.launch.maxDrag / 2 }, cfg)!;
    expect(half.angle).toBeCloseTo(-Math.PI / 2);
    expect(half.power).toBeCloseTo(0.5);
  });

  it("clamps power and rejects non-finite launches", () => {
    const cfg = defaultConfig;
    expect(length(launchVelocity({ angle: 1, power: 50 }, cfg))).toBeCloseTo(cfg.launch.maxSpeed);
    expect(launchVelocity({ angle: NaN, power: 1 }, cfg)).toEqual({ x: 0, y: 0 });
  });

  it("predicts a path through the configured number of bounces without touching the world", () => {
    const cfg = cloneConfig(defaultConfig);
    const world = createWorld(cfg);
    const before = cloneWorld(world);
    const down = { angle: Math.PI / 2, power: 1 };

    cfg.aimPreview.bounces = 0;
    const path = predictPath(world, cfg, 0, down);
    expect(path[0]).toEqual(world.puck.pos);
    expect(path.at(-1)!.y).toBeCloseTo(cfg.rink.height - cfg.puck.radius);

    cfg.aimPreview.bounces = 1;
    expect(predictPath(world, cfg, 0, down).length).toBeGreaterThan(path.length);

    cfg.aimPreview.bounces = -1;
    expect(predictPath(world, cfg, 0, down)).toEqual([]);
    expect(predictPath(world, cfg, 1, down)).toEqual([]);
    expect(world).toEqual(before);
  });
});

describe("possession rules (M3)", () => {
  const box0 = goalieBox(defaultConfig, 0);
  const inBox0 = { x: (box0.minX + box0.maxX) / 2 + 20, y: box0.minY + 30 };

  it("a slow puck in a goalie box is caught by that goalie", () => {
    const world = loosePuck(defaultConfig, inBox0, { x: -100, y: 0 });
    const events = step(world, defaultConfig, {});
    expect(events.possession).toEqual({ team: 0, reason: "catch" });
    expect(world.puck.heldBy).toBe(0);
  });

  it("a fast puck in a goalie box is not caught", () => {
    const world = loosePuck(defaultConfig, inBox0, { x: 0, y: 900 });
    expect(step(world, defaultConfig, {}).possession).toBeNull();
    expect(world.puck.heldBy).toBeNull();
  });

  it("a dead puck goes to the goalie of its half", () => {
    const cfg = defaultConfig;
    const world = loosePuck(cfg, { x: 900, y: 80 }, { x: 0, y: 0 });
    const limit = cfg.rules.deadPuckSeconds * cfg.sim.tickRate;
    let possession = null;
    let ticks = 0;
    while (!possession && ticks < limit + 5) {
      possession = step(world, cfg, {}).possession;
      ticks++;
    }
    expect(possession).toEqual({ team: 1, reason: "dead" });
    expect(ticks).toBe(limit);
  });

  it("the shot timer auto-launches weakly at the other goal", () => {
    const cfg = defaultConfig;
    const world = createWorld(cfg, 2, 1);
    let launched = null;
    let ticks = 0;
    while (!launched && ticks < 1000) {
      launched = step(world, cfg, {}).launched;
      ticks++;
    }
    expect(launched).toEqual({ team: 1, auto: true });
    expect(ticks).toBe(cfg.rules.shotTimerSeconds * cfg.sim.tickRate);
    expect(world.puck.vel.x).toBeLessThan(0); // team 1 shoots left
    expect(length(world.puck.vel)).toBeCloseTo(cfg.launch.maxSpeed * cfg.rules.autoLaunchPower);
  });

  it("reports a manual shot as a launch", () => {
    const world = createWorld(defaultConfig);
    const events = step(world, defaultConfig, { [world.goalies[0]!.id]: { launch: { angle: 0, power: 1 } } });
    expect(events.launched).toEqual({ team: 0, auto: false });
  });

  it("first to goalsToWin wins, and the puck then stays frozen", () => {
    const cfg = cloneConfig(defaultConfig);
    cfg.match.goalsToWin = 1;
    const world = createWorld(cfg);
    const g1 = world.goalies[1]!;
    g1.pos = g1.target = { x: 1150, y: 200 };
    let goal = step(world, cfg, { [world.goalies[0]!.id]: { launch: { angle: 0, power: 1 } } }).goal;
    for (let t = 0; t < 300 && !goal; t++) goal = step(world, cfg, {}).goal;
    expect(world.winner).toBe(0);
    const frozen = cloneWorld(world).puck;
    run(world, cfg, 600, { [world.goalies[1]!.id]: { launch: { angle: Math.PI, power: 1 } } });
    expect(world.puck).toEqual(frozen); // no shot timer, no launches
  });

  it("rules switch off at 0", () => {
    const cfg = cloneConfig(defaultConfig);
    cfg.rules.catchSpeed = 0;
    cfg.rules.shotTimerSeconds = 0;
    const world = loosePuck(cfg, inBox0, { x: -100, y: 0 });
    run(world, cfg, 10);
    expect(world.puck.heldBy).toBeNull();
    const held = createWorld(cfg);
    run(held, cfg, 1000);
    expect(held.puck.heldBy).toBe(0);
  });
});
