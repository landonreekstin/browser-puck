import { performance } from "node:perf_hooks";
import { WebSocketServer } from "ws";
import { decodeClientMessage, defaultConfig as config, encode, type ServerMessage } from "@puck/shared";
import type { Conn, Room } from "./room";
import { Rooms } from "./rooms";

const port = Number(process.env.PORT ?? config.net.port);
const rooms = new Rooms(config, () => performance.now());
const wss = new WebSocketServer({ port });

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

wss.on("listening", () => {
  console.log(`listening on ws://0.0.0.0:${port}`);
});
