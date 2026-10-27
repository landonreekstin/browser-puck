import {
  launchFromDrag,
  sub,
  type Config,
  type Inputs,
  type Launch,
  type Vec,
  type World,
} from "@puck/shared";
import type { View } from "./view";

/**
 * Sandbox controls: one human drives whichever piece is selected (DESIGN.md "Roles").
 *   1–6 / Tab   select piece            mouse      move target
 *   wheel, Q/E  rotate a bar            drag       goalie slingshot (release to shoot)
 *   R           give puck to the selected piece's goalie
 *   Esc         cancel a drag
 */
export class Controls {
  selected = 0;
  /** Pointer in screen (CSS px) coords. */
  pointer: Vec = { x: 0, y: 0 };
  /** World point where the current goalie drag started, if dragging. */
  dragStart: Vec | null = null;
  givePuckRequested = false;

  private keys = new Set<string>();
  private wheelSteps = 0;
  private pendingLaunch: Launch | null = null;
  private targetAngle: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private view: View,
    private getWorld: () => World,
    private getCfg: () => Config,
  ) {
    window.addEventListener("pointermove", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerdown", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this.selectedPiece().kind === "goalie") {
        this.dragStart = this.view.toWorld(this.pointer);
      }
    });
    window.addEventListener("pointerup", () => {
      if (!this.dragStart) return;
      this.pendingLaunch = this.currentLaunch();
      this.dragStart = null;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.wheelSteps += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  pieceCount(): number {
    const w = this.getWorld();
    return w.goalies.length + w.blockers.length;
  }

  /** Selection order: team 0 goalie, team 0 bars, team 1 goalie, team 1 bars. */
  pieces(): { id: string; kind: "goalie" | "blocker"; team: 0 | 1 }[] {
    const w = this.getWorld();
    return ([0, 1] as const).flatMap((team) => [
      ...w.goalies.filter((g) => g.team === team).map((g) => ({ id: g.id, kind: "goalie" as const, team })),
      ...w.blockers.filter((b) => b.team === team).map((b) => ({ id: b.id, kind: "blocker" as const, team })),
    ]);
  }

  selectedPiece(): { id: string; kind: "goalie" | "blocker"; team: 0 | 1 } {
    const all = this.pieces();
    return all[Math.min(this.selected, all.length - 1)]!;
  }

  /** Launch the current drag would fire, or null if too short / not dragging. */
  currentLaunch(): Launch | null {
    if (!this.dragStart) return null;
    return launchFromDrag(sub(this.view.toWorld(this.pointer), this.dragStart), this.getCfg());
  }

  /** This tick's inputs for the selected piece. */
  collect(dt: number): Inputs {
    const cfg = this.getCfg();
    const world = this.getWorld();
    const piece = this.selectedPiece();
    const pointerWorld = this.view.toWorld(this.pointer);

    if (piece.kind === "goalie") {
      // While aiming, the goalie stands still.
      const input: Inputs[string] = this.dragStart ? {} : { target: pointerWorld };
      if (this.pendingLaunch) input.launch = this.pendingLaunch;
      this.pendingLaunch = null;
      return { [piece.id]: input };
    }

    const bar = world.blockers.find((b) => b.id === piece.id)!;
    let target = this.targetAngle ?? bar.angle;
    const rotate = (this.keys.has("e") ? 1 : 0) - (this.keys.has("q") ? 1 : 0);
    target += rotate * cfg.bar.rotateSpeed * dt + this.wheelSteps * (Math.PI / 12);
    this.wheelSteps = 0;
    // Don't let the target run more than a quarter turn ahead of the bar.
    target = bar.angle + Math.max(-Math.PI / 2, Math.min(Math.PI / 2, target - bar.angle));
    this.targetAngle = target;
    return { [piece.id]: { target: pointerWorld, targetAngle: target } };
  }

  private select(index: number): void {
    this.selected = (index + this.pieceCount()) % this.pieceCount();
    this.dragStart = null;
    this.targetAngle = null;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    this.keys.add(key);
    const digit = Number(key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= this.pieceCount()) this.select(digit - 1);
    else if (key === "tab") {
      e.preventDefault();
      this.select(this.selected + (e.shiftKey ? -1 : 1));
    } else if (key === "r") this.givePuckRequested = true;
    else if (key === "escape") this.dragStart = null;
  }
}
