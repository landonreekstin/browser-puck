import { config, decodeServerMessage, encode } from "@puck/shared";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;

type Status = "connecting" | "connected" | "disconnected";
let status: Status = "connecting";
let rttMs: number | undefined;
let socket: WebSocket | undefined;
let nextPingId = 0;

function connect(): void {
  // Dev: the server runs on its own port. M6 moves it to same-origin.
  const ws = new WebSocket(`ws://${location.hostname}:${config.net.port}`);
  socket = ws;
  status = "connecting";

  ws.addEventListener("open", () => {
    status = "connected";
    sendPing();
  });
  ws.addEventListener("message", (ev) => {
    const msg = decodeServerMessage(String(ev.data));
    if (msg?.t === "pong") rttMs = performance.now() - msg.clientTime;
  });
  ws.addEventListener("close", () => {
    status = "disconnected";
    rttMs = undefined;
    setTimeout(connect, 1000);
  });
}

function sendPing(): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(encode({ t: "ping", id: nextPingId++, clientTime: performance.now() }));
}

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.font = "16px ui-monospace, monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = status === "connected" ? "#7ee787" : "#f0883e";
  ctx.fillText(`server: ${status}`, 12, 12);
  ctx.fillStyle = "#e6edf3";
  ctx.fillText(`RTT: ${rttMs === undefined ? "—" : `${rttMs.toFixed(1)} ms`}`, 12, 34);

  // Exposed for scripted verification (scripts/verify-ping.ts).
  document.body.dataset.status = status;
  document.body.dataset.rtt = rttMs === undefined ? "" : rttMs.toFixed(1);

  requestAnimationFrame(render);
}

connect();
setInterval(sendPing, config.net.pingIntervalMs);
requestAnimationFrame(render);
