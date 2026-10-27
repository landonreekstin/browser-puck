import { allSlots, startProblem, type Config, type RoomState, type SlotId } from "@puck/shared";
import { teamColor } from "./render";

export interface LobbyActions {
  create(name: string): void;
  join(code: string, name: string): void;
  pickSlot(slot: SlotId | null): void;
  start(): void;
  stop(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** The DOM lobby: name + create/join, then team slots, invite link and start (DESIGN.md "Rooms and slots"). */
export class Lobby {
  private readonly root = el("div", { id: "lobby" });
  private readonly endButton = el("button", { id: "end-match", textContent: "End match", hidden: true });
  private error = "";

  constructor(
    private readonly cfg: Config,
    private readonly actions: LobbyActions,
    private name: string,
    private readonly initialCode: string,
  ) {
    this.endButton.addEventListener("click", () => actions.stop());
    document.body.append(this.root, this.endButton);
    this.renderEntry();
  }

  showError(message: string): void {
    this.error = message;
    const box = this.root.querySelector(".error");
    if (box) box.textContent = message;
  }

  /** The entry screen: pick a name, create or join. */
  renderEntry(): void {
    this.root.hidden = false;
    this.root.classList.remove("docked");
    const name = el("input", { id: "name", value: this.name, maxLength: this.cfg.room.nameMaxLength, placeholder: "your name" });
    const code = el("input", { id: "code", value: this.initialCode, maxLength: 4, placeholder: "CODE" });
    const create = el("button", { id: "create", textContent: "Create room" });
    const join = el("button", { id: "join", textContent: "Join" });
    const currentName = (): string => (this.name = name.value.trim() || "player");
    create.addEventListener("click", () => this.actions.create(currentName()));
    join.addEventListener("click", () => this.actions.join(code.value.trim().toUpperCase(), currentName()));
    code.addEventListener("keydown", (e) => {
      if (e.key === "Enter") join.click();
    });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (code.value.trim() ? join : create).click();
    });
    this.root.replaceChildren(
      el("h1", { textContent: "browser-puck" }),
      el("label", {}, "Name ", name),
      el("div", { className: "row" }, create),
      el("div", { className: "row" }, code, join),
      el("div", { className: "error", textContent: this.error }),
      el("p", { className: "dim" }, el("a", { href: "?sandbox", textContent: "offline sandbox" })),
    );
  }

  /** The room screen. While playing it only shows for spectators (to drop in). */
  renderRoom(room: RoomState, myId: string): void {
    const me = room.players.find((p) => p.id === myId);
    const isHost = room.hostId === myId;
    this.endButton.hidden = !(isHost && room.phase === "playing");
    this.root.hidden = room.phase === "playing" && me?.slot != null;
    // Spectators during a match: a small panel in the corner, so they can watch.
    this.root.classList.toggle("docked", room.phase === "playing");
    if (this.root.hidden) return;

    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    const copy = el("button", { id: "copy-link", textContent: "Copy link" });
    copy.addEventListener("click", () => {
      void navigator.clipboard
        ?.writeText(link)
        .then(() => {
          copy.textContent = "Copied!";
          setTimeout(() => (copy.textContent = "Copy link"), 1500);
        })
        .catch(() => {});
    });
    const share: HTMLElement[] = [];
    if (typeof navigator.share === "function") {
      const button = el("button", { textContent: "Share" });
      button.addEventListener("click", () => void navigator.share({ title: "browser-puck", url: link }).catch(() => {}));
      share.push(button);
    }
    const nameOf = (p: { id: string; name: string; connected: boolean }): string =>
      `${p.id === room.hostId ? "★ " : ""}${p.name}${p.connected ? "" : " (away)"}`;

    const teams = ([0, 1] as const).map((team) => {
      const rows = allSlots(this.cfg)
        .filter((s) => s.team === team)
        .map((slot) => {
          const holder = room.players.find((p) => p.slot === slot.id);
          const label = slot.kind === "goalie" ? "Goalie" : `Blocker ${slot.index + 1}`;
          let action: HTMLElement;
          if (holder?.id === myId) {
            action = el("button", { textContent: "Leave" });
            action.addEventListener("click", () => this.actions.pickSlot(null));
          } else if (!holder) {
            action = el("button", { textContent: "Take" });
            action.addEventListener("click", () => this.actions.pickSlot(slot.id));
          } else {
            action = el("span");
          }
          const who = holder ? nameOf(holder) : "—";
          const row = el("div", { className: `slot${holder?.id === myId ? " mine" : ""}` }, el("span", { textContent: label }), el("span", { className: "who", textContent: who }), action);
          row.dataset.slot = slot.id;
          return row;
        });
      const col = el("div", { className: "team" }, el("h2", { textContent: `Team ${team + 1}` }), ...rows);
      col.style.borderColor = teamColor[team];
      return col;
    });

    const spectators = room.players.filter((p) => p.slot === null).map(nameOf);
    const footer: HTMLElement[] = [];
    if (room.phase === "lobby") {
      const problem = startProblem(this.cfg, room.players.map((p) => p.slot));
      if (isHost) {
        const start = el("button", { id: "start", textContent: "Start match", disabled: problem !== null });
        start.addEventListener("click", () => this.actions.start());
        footer.push(start, el("span", { className: "dim", textContent: problem ?? "" }));
      } else {
        footer.push(el("span", { className: "dim", textContent: problem ?? "waiting for the host to start" }));
      }
    } else {
      footer.push(el("span", { className: "dim", textContent: "match in progress — take a free slot to drop in" }));
    }

    this.root.replaceChildren(
      el("h1", { textContent: `Room ${room.code}` }),
      el("div", { className: "row" }, el("input", { value: link, readOnly: true, className: "link" }), copy, ...share),
      el("p", { className: "dim", textContent: "Pick a slot. Each team needs a goalie and at least one blocker (★ = host)." }),
      el("div", { className: "teams" }, ...teams),
      el("p", { className: "dim", textContent: `Spectating: ${spectators.join(", ") || "—"}` }),
      el("div", { className: "row" }, ...footer),
      el("div", { className: "error", textContent: this.error }),
    );
  }
}
