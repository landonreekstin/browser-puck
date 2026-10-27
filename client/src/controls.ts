import {
  distance,
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
 * Pointer/keyboard → input for one piece (DESIGN.md "Roles", "Touch controls"):
 *   mouse       move target            drag    goalie slingshot (release to shoot, Esc cancels)
 *   wheel, Q/E  rotate a bar
 *   touch       pieces move only while a finger is down. Goalie: a touch starting near it
 *               drags it, elsewhere it's the slingshot. Bar: one finger drags, a second
 *               finger twists; on-screen ⟲ ⟳ buttons rotate while held.
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

  /** Last input device: touch pieces only move while a finger is down. */
  private usingTouch = false;
  private touches = new Map<number, Vec>();
  private primaryTouch: number | null = null;
  private touchMode: "move" | "aim" | null = null;
  /** Two-finger twist: angle of the finger pair last frame, and rotation not yet applied. */
  private twistAngle: number | null = null;
  private twistDelta = 0;
  private rotateButtons: HTMLElement;

  constructor(
    canvas: HTMLCanvasElement,
    private view: View,
    private getCfg: () => Config,
    /** World position of the driven piece (predicted online), for "touch near goalie". */
    private getPiecePos: () => Vec | null,
  ) {
    canvas.addEventListener("pointerdown", (e) => {
      const at = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "touch") return this.touchDown(e.pointerId, at);
      this.usingTouch = false;
      this.updateButtons();
      this.pointer = at;
      if (e.button === 0 && this.piece?.kind === "goalie") this.dragStart = this.view.toWorld(at);
    });
    window.addEventListener("pointermove", (e) => {
      const at = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "touch") this.touchMove(e.pointerId, at);
      else this.pointer = at;
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerType === "touch") return this.touchUp(e.pointerId);
      if (!this.dragStart) return;
      this.pendingLaunch = this.currentLaunch();
      this.dragStart = null;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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

    this.rotateButtons = this.createRotateButtons();
    if (window.matchMedia?.("(pointer: coarse)").matches) this.usingTouch = true;
    this.updateButtons();
  }

  /** Switch the driven piece (drops any drag in progress). */
  setPiece(piece: ControlledPiece | null): void {
    if (piece?.id === this.piece?.id) return;
    this.piece = piece;
    this.dragStart = null;
    this.pendingLaunch = null;
    this.targetAngle = null;
    this.touchMode = null;
    this.updateButtons();
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
    // Mouse: the piece follows the pointer. Touch: only while dragging it.
    const moving = this.usingTouch ? this.touchMode === "move" : !this.dragStart;
    const target = moving ? { target: this.view.toWorld(this.pointer) } : {};

    if (piece.kind === "goalie") {
      const input: PieceInput = { ...target };
      if (this.pendingLaunch) input.launch = this.pendingLaunch;
      this.pendingLaunch = null;
      return input;
    }

    if (barAngle === null) return target;
    let angle = this.targetAngle ?? barAngle;
    const rotate = (this.keys.has("e") ? 1 : 0) - (this.keys.has("q") ? 1 : 0);
    angle += rotate * this.getCfg().bar.rotateSpeed * dt + this.wheelSteps * (Math.PI / 12) + this.twistDelta;
    this.wheelSteps = 0;
    this.twistDelta = 0;
    // Don't let the target run more than a quarter turn ahead of the bar.
    angle = barAngle + Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle - barAngle));
    this.targetAngle = angle;
    return { ...target, targetAngle: angle };
  }

  private touchDown(id: number, at: Vec): void {
    this.usingTouch = true;
    this.updateButtons();
    this.touches.set(id, at);
    if (this.primaryTouch === null) {
      this.primaryTouch = id;
      this.pointer = at;
      const pos = this.getPiecePos();
      const near = pos !== null && distance(this.view.toWorld(at), pos) < this.getCfg().goalie.radius * 2.5;
      if (this.piece?.kind === "goalie" && !near) {
        this.touchMode = "aim";
        this.dragStart = this.view.toWorld(at);
      } else {
        this.touchMode = "move";
      }
    } else if (this.touches.size === 2) {
      this.twistAngle = this.pairAngle();
    }
  }

  private touchMove(id: number, at: Vec): void {
    if (!this.touches.has(id)) return;
    this.touches.set(id, at);
    if (id === this.primaryTouch) this.pointer = at;
    if (this.twistAngle !== null) {
      const now = this.pairAngle();
      if (now !== null) {
        let d = now - this.twistAngle;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        this.twistDelta += d;
        this.twistAngle = now;
      }
    }
  }

  private touchUp(id: number): void {
    if (!this.touches.delete(id)) return;
    this.twistAngle = null;
    if (id !== this.primaryTouch) return;
    if (this.touchMode === "aim" && this.dragStart) this.pendingLaunch = this.currentLaunch();
    this.dragStart = null;
    this.touchMode = null;
    this.primaryTouch = null;
  }

  /** Angle of the line between the first two fingers, or null. */
  private pairAngle(): number | null {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.atan2(b.y - a.y, b.x - a.x) : null;
  }

  private createRotateButtons(): HTMLElement {
    const box = document.createElement("div");
    box.id = "rotate-buttons";
    for (const [key, label] of [["q", "⟲"], ["e", "⟳"]] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.dataset.key = key;
      const release = (): void => void this.keys.delete(key);
      button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.keys.add(key);
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
      box.append(button);
    }
    document.body.append(box);
    return box;
  }

  private updateButtons(): void {
    this.rotateButtons.hidden = !(this.usingTouch && this.piece?.kind === "blocker");
  }
}
