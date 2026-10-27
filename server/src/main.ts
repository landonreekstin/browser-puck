import { createServer } from "node:http";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { decodeClientMessage, defaultConfig as config, encode, type ServerMessage } from "@puck/shared";
import type { Conn, Room } from "./room";
import { Rooms } from "./rooms";
import { defaultStaticDir, staticHandler } from "./static";

const port = Number(process.env.PORT ?? config.net.port);
const host = process.env.HOST ?? "0.0.0.0";
const staticDir = defaultStaticDir(dirname(fileURLToPath(import.meta.url)));
const rooms = new Rooms(config, () => performance.now());

// One HTTP server: the built client (if present) plus the game WebSocket at net.wsPath.
const http = createServer(
  staticDir ? staticHandler(staticDir) : (_req, res) => res.writeHead(404).end("client not built; use the Vite dev server\n"),
);
const wss = new WebSocketServer({ server: http, path: config.net.wsPath });

wss.on("connection", (socket, req) => {
  const conn: Conn = {
    send: (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(encode(msg));
    },
  };
  let room: Room | undefined;
  let playerId: string | undefined;
  console.log(`connect ${req.socket.remoteAddress} (${wss.clients.size} connected)`);

  const fail = (message: string | null): void => {
    if (message) conn.send({ t: "error", message });
  };

  socket.on("message", (data) => {
    const msg = decodeClientMessage(data.toString());
    if (!msg) return;
    if (msg.t === "ping") {
      conn.send({ t: "pong", id: msg.id, clientTime: msg.clientTime });
      return;
    }
    if (msg.t === "join") {
      if (room && playerId) room.disconnect(playerId, conn);
      room = msg.room === null ? rooms.create() : rooms.get(msg.room);
      if (!room) {
        fail(`room ${msg.room} not found`);
        return;
      }
      playerId = room.join(conn, msg.name, msg.token).id;
      console.log(`room ${room.code}: ${playerId} joined`);
      return;
    }
    if (!room || !playerId) return fail("join a room first");
    switch (msg.t) {
      case "pickSlot":
        return fail(room.pickSlot(playerId, msg.slot));
      case "start":
        return fail(room.start(playerId));
      case "stop":
        return fail(room.stop(playerId));
      case "input":
        return room.input(playerId, msg.inputs);
    }
  });

  socket.on("close", () => {
    if (room && playerId) room.disconnect(playerId, conn);
    console.log(`disconnect (${wss.clients.size} connected)`);
  });
});

// Rooms tick on their own fixed-step clock; this just polls often enough to keep up.
setInterval(() => rooms.update(), 4);

http.listen(port, host, () => {
  console.log(`listening on http://${host}:${port} (ws ${config.net.wsPath}, static ${staticDir ?? "off"})`);
});
