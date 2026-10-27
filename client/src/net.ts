import { defaultConfig as config, decodeServerMessage, encode } from "@puck/shared";

export type NetStatus = "connecting" | "connected" | "disconnected";

/** Server connection with a ping/RTT readout. The M1 sandbox runs fine without it. */
export class Net {
  status: NetStatus = "connecting";
  rttMs: number | undefined;
  private socket: WebSocket | undefined;
  private nextPingId = 0;

  start(): void {
    this.connect();
    setInterval(() => this.sendPing(), config.net.pingIntervalMs);
  }

  private connect(): void {
    // Dev: the server runs on its own port. M6 moves it to same-origin.
    const ws = new WebSocket(`ws://${location.hostname}:${config.net.port}`);
    this.socket = ws;
    this.setStatus("connecting");

    ws.addEventListener("open", () => {
      this.setStatus("connected");
      this.sendPing();
    });
    ws.addEventListener("message", (ev) => {
      const msg = decodeServerMessage(String(ev.data));
      if (msg?.t === "pong") {
        this.rttMs = performance.now() - msg.clientTime;
        document.body.dataset.rtt = this.rttMs.toFixed(1);
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
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encode({ t: "ping", id: this.nextPingId++, clientTime: performance.now() }));
  }
}
