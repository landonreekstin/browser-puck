import {
  defaultConfig as config,
  decodeServerMessage,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@puck/shared";

export type NetStatus = "connecting" | "connected" | "disconnected";

/** Server connection: reconnects on drop, measures RTT, hands messages to `onMessage`. */
export class Net {
  status: NetStatus = "connecting";
  rttMs: number | undefined;
  /** Called with every server message (except pongs). */
  onMessage: (msg: ServerMessage) => void = () => {};
  /** Called on every (re)connect — the place to (re)join a room. */
  onOpen: () => void = () => {};

  private socket: WebSocket | undefined;
  private nextPingId = 0;

  start(): void {
    this.connect();
    setInterval(() => this.sendPing(), config.net.pingIntervalMs);
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encode(msg));
  }

  describe(): string {
    return `${this.status}${this.rttMs !== undefined ? ` ${this.rttMs.toFixed(1)} ms` : ""}`;
  }

  private connect(): void {
    // Dev: the server runs on its own port. M6 moves it to same-origin.
    const ws = new WebSocket(`ws://${location.hostname}:${config.net.port}`);
    this.socket = ws;
    this.setStatus("connecting");

    ws.addEventListener("open", () => {
      this.setStatus("connected");
      this.sendPing();
      this.onOpen();
    });
    ws.addEventListener("message", (ev) => {
      const msg = decodeServerMessage(String(ev.data));
      if (!msg) return;
      if (msg.t === "pong") {
        this.rttMs = performance.now() - msg.clientTime;
        document.body.dataset.rtt = this.rttMs.toFixed(1);
      } else {
        this.onMessage(msg);
      }
    });
    ws.addEventListener("close", () => {
      this.setStatus("disconnected");
      this.rttMs = undefined;
      document.body.dataset.rtt = "";
      setTimeout(() => this.connect(), 1000);
    });
  }

  private setStatus(status: NetStatus): void {
    this.status = status;
    // Exposed for scripted verification (scripts/verify-ping.ts).
    document.body.dataset.status = status;
  }

  private sendPing(): void {
    this.send({ t: "ping", id: this.nextPingId++, clientTime: performance.now() });
  }
}
