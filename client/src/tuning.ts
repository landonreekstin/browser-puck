import { defaultConfig, type Config } from "@puck/shared";

interface Knob {
  path: string;
  min: number;
  max: number;
  step: number;
  /** Geometry knobs need the world rebuilt. */
  rebuild?: boolean;
}

const knobs: Knob[] = [
  { path: "puck.radius", min: 6, max: 40, step: 1, rebuild: true },
  { path: "puck.drag", min: 0, max: 3, step: 0.05 },
  { path: "puck.stopSpeed", min: 0, max: 50, step: 1 },
  { path: "rink.wallRestitution", min: 0, max: 1, step: 0.01 },
  { path: "bar.length", min: 30, max: 300, step: 5 },
  { path: "bar.thickness", min: 2, max: 40, step: 1 },
  { path: "bar.restitution", min: 0, max: 1, step: 0.01 },
  { path: "bar.moveSpeed", min: 50, max: 2000, step: 10 },
  { path: "bar.rotateSpeed", min: 0.5, max: 20, step: 0.5 },
  { path: "goalie.radius", min: 10, max: 60, step: 1 },
  { path: "goalie.moveSpeed", min: 50, max: 1500, step: 10 },
  { path: "goalie.restitution", min: 0, max: 1, step: 0.01 },
  { path: "launch.maxSpeed", min: 200, max: 4000, step: 50 },
  { path: "launch.maxDrag", min: 50, max: 500, step: 10 },
  { path: "launch.powerExponent", min: 0.3, max: 3, step: 0.1 },
  { path: "aimPreview.bounces", min: -1, max: 5, step: 1 },
  { path: "aimPreview.seconds", min: 0.2, max: 5, step: 0.1 },
  { path: "rules.catchSpeed", min: 0, max: 1000, step: 10 },
  { path: "rules.shotTimerSeconds", min: 0, max: 15, step: 0.5 },
  { path: "rules.autoLaunchPower", min: 0, max: 1, step: 0.05 },
  { path: "rules.deadSpeed", min: 0, max: 200, step: 5 },
  { path: "rules.deadPuckSeconds", min: 0, max: 10, step: 0.5 },
  { path: "match.goalsToWin", min: 0, max: 15, step: 1 },
  { path: "rink.width", min: 600, max: 2000, step: 20, rebuild: true },
  { path: "rink.height", min: 300, max: 1200, step: 20, rebuild: true },
  { path: "goal.width", min: 40, max: 400, step: 10, rebuild: true },
  { path: "goalieBox.depth", min: 60, max: 300, step: 5, rebuild: true },
  { path: "goalieBox.width", min: 80, max: 600, step: 10, rebuild: true },
  { path: "sandbox.blockersPerTeam", min: 1, max: 3, step: 1, rebuild: true },
];

function getPath(cfg: Config, path: string): number {
  const [group, key] = path.split(".") as [string, string];
  return (cfg as unknown as Record<string, Record<string, number>>)[group]![key]!;
}

function setPath(cfg: Config, path: string, value: number): void {
  const [group, key] = path.split(".") as [string, string];
  (cfg as unknown as Record<string, Record<string, number>>)[group]![key] = value;
}

/** Live tuning panel (toggle with T). Edits `cfg` in place; geometry edits call `onRebuild`. */
export function createTuningPanel(cfg: Config, onRebuild: () => void): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "tuning";
  panel.hidden = true;

  const inputs: { knob: Knob; input: HTMLInputElement; value: HTMLSpanElement }[] = [];
  for (const knob of knobs) {
    const row = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = knob.path;
    const value = document.createElement("span");
    value.className = "value";
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: knob.min, max: knob.max, step: knob.step });
    input.value = String(getPath(cfg, knob.path));
    value.textContent = input.value;
    input.addEventListener("input", () => {
      setPath(cfg, knob.path, Number(input.value));
      value.textContent = input.value;
      if (knob.rebuild) onRebuild();
    });
    row.append(name, value, input);
    panel.append(row);
    inputs.push({ knob, input, value });
  }

  const reset = document.createElement("button");
  reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => {
    for (const { knob, input, value } of inputs) {
      const v = getPath(defaultConfig, knob.path);
      setPath(cfg, knob.path, v);
      input.value = value.textContent = String(v);
    }
    onRebuild();
  });

  const copy = document.createElement("button");
  copy.textContent = "Copy changes";
  copy.title = "Copies the knobs that differ from shared/src/config.ts as JSON";
  copy.addEventListener("click", () => {
    const changed: Record<string, number> = {};
    for (const { knob } of inputs) {
      const v = getPath(cfg, knob.path);
      if (v !== getPath(defaultConfig, knob.path)) changed[knob.path] = v;
    }
    const text = JSON.stringify(changed, null, 2);
    console.log(text);
    void navigator.clipboard?.writeText(text).catch(() => {});
  });

  const buttons = document.createElement("div");
  buttons.className = "buttons";
  buttons.append(reset, copy);
  panel.append(buttons);
  return panel;
}
