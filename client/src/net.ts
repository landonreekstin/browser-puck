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

  /**
   * Dev network simulation (ROADMAP M4): `?lag=100&jitter=30&loss=0.1`. lag = extra RTT in
   * ms (half each way), jitter = ± ms per message (order kept, as on TCP), loss = fraction
   * of snapshots dropped (TCP doesn't lose messages, so this stands in for stalls).
   */
  readonly sim = (() => {
    const q = new URLSearchParams(location.search);
    return { lag: Number(q.get("lag") ?? 0), jitter: Number(q.get("jitter") ?? 0), loss: Number(q.get("loss") ?? 0) };
  })();
  /** Delayed messages per direction, in send order (FIFO, like TCP). */
  private queues: Record<"in" | "out", { at: number; fn: () => void }[]> = { in: [], out: [] };

  start(): void {
    this.connect();
    setInterval(() => this.sendPing(), config.net.pingIntervalMs);
  }

  send(msg: ClientMessage): void {
    const socket = this.socket;
    this.delayed("out", () => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(encode(msg));
    });
  }

  private delayed(dir: "in" | "out", fn: () => void): void {
    const { lag, jitter } = this.sim;
    if (lag <= 0 && jitter <= 0) return fn();
    const queue = this.queues[dir];
    const delay = Math.max(0, lag / 2 + ((Math.random() * 2 - 1) * jitter) / 2);
    // Never overtake an earlier message (one timer drains the queue in order; separate
    // timers can swap, because browsers round timeouts to whole milliseconds).
    const at = Math.max(performance.now() + delay, queue.at(-1)?.at ?? 0);
    queue.push({ at, fn });
    if (queue.length === 1) this.drain(dir);
  }

  private drain(dir: "in" | "out"): void {
    const queue = this.queues[dir];
    const head = queue[0];
    if (!head) return;
    setTimeout(() => {
      while (queue[0] && queue[0].at <= performance.now() + 1) queue.shift()!.fn();
      this.drain(dir);
    }, Math.max(0, head.at - performance.now()));
  }

  describe(): string {
    const { lag, jitter, loss } = this.sim;
    const simulated = lag || jitter || loss ? ` (sim lag ${lag}±${jitter} loss ${loss})` : "";
    return `${this.status}${this.rttMs !== undefined ? ` ${this.rttMs.toFixed(1)} ms` : ""}${simulated}`;
  }

  private connect(): void {
    // Same origin as the page: the game server serves both (prod) or Vite proxies it (dev).
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}${config.net.wsPath}`);
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
      if (msg.t === "snapshot" && this.sim.loss > 0 && Math.random() < this.sim.loss) return;
      this.delayed("in", () => {
        if (msg.t === "pong") {
          this.rttMs = performance.now() - msg.clientTime;
          document.body.dataset.rtt = this.rttMs.toFixed(1);
        } else {
          this.onMessage(msg);
        }
      });
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
