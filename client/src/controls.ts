import {
  launchFromDrag,
  sub,
  type Config,
  type Launch,
  type PieceInput,
  type Team,
  type Vec,
} from "@puck/shared";
import type { View } from "./view";

export interface ControlledPiece {
  id: string;
  kind: "goalie" | "blocker";
  team: Team;
}

/**
 * Mouse/keyboard → input for one piece (DESIGN.md "Roles"):
 *   mouse       move target            drag    goalie slingshot (release to shoot, Esc cancels)
 *   wheel, Q/E  rotate a bar
 */
export class Controls {
  /** Pointer in screen (CSS px) coords. */
  pointer: Vec = { x: 0, y: 0 };
  /** World point where the current goalie drag started, if dragging. */
  dragStart: Vec | null = null;
  /** Which piece the pointer currently drives; null = none (spectating). */
  piece: ControlledPiece | null = null;

  private keys = new Set<string>();
  private wheelSteps = 0;
  private pendingLaunch: Launch | null = null;
  private targetAngle: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private view: View,
    private getCfg: () => Config,
  ) {
    window.addEventListener("pointermove", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerdown", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this.piece?.kind === "goalie") {
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
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (key === "escape") this.dragStart = null;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** Switch the driven piece (drops any drag in progress). */
  setPiece(piece: ControlledPiece | null): void {
    if (piece?.id === this.piece?.id) return;
    this.piece = piece;
    this.dragStart = null;
    this.pendingLaunch = null;
    this.targetAngle = null;
  }

  /** Launch the current drag would fire, or null if too short / not dragging. */
  currentLaunch(): Launch | null {
    if (!this.dragStart) return null;
    return launchFromDrag(sub(this.view.toWorld(this.pointer), this.dragStart), this.getCfg());
  }

  /**
   * This tick's input for the driven piece (null if none). `barAngle` is the bar's current
   * angle (predicted, online), used to keep the rotate target from running away.
   */
  collect(dt: number, barAngle: number | null): PieceInput | null {
    const piece = this.piece;
    if (!piece) return null;
    const pointerWorld = this.view.toWorld(this.pointer);

    if (piece.kind === "goalie") {
      // While aiming, the goalie stands still.
      const input: PieceInput = this.dragStart ? {} : { target: pointerWorld };
      if (this.pendingLaunch) input.launch = this.pendingLaunch;
      this.pendingLaunch = null;
      return input;
    }

    if (barAngle === null) return { target: pointerWorld };
    let target = this.targetAngle ?? barAngle;
    const rotate = (this.keys.has("e") ? 1 : 0) - (this.keys.has("q") ? 1 : 0);
    target += rotate * this.getCfg().bar.rotateSpeed * dt + this.wheelSteps * (Math.PI / 12);
    this.wheelSteps = 0;
    // Don't let the target run more than a quarter turn ahead of the bar.
    target = barAngle + Math.max(-Math.PI / 2, Math.min(Math.PI / 2, target - barAngle));
    this.targetAngle = target;
    return { target: pointerWorld, targetAngle: target };
  }
}
