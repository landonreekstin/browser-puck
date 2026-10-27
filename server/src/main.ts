import { WebSocketServer } from "ws";
import { config, decodeClientMessage, encode } from "@puck/shared";

const port = Number(process.env.PORT ?? config.net.port);
const wss = new WebSocketServer({ port });

wss.on("connection", (socket, req) => {
  console.log(`connect ${req.socket.remoteAddress} (${wss.clients.size} connected)`);

  socket.on("message", (data) => {
    const msg = decodeClientMessage(data.toString());
    if (!msg) return;
    switch (msg.t) {
      case "ping":
        socket.send(encode({ t: "pong", id: msg.id, clientTime: msg.clientTime }));
        break;
    }
  });

  socket.on("close", () => {
    console.log(`disconnect (${wss.clients.size} connected)`);
  });
});

wss.on("listening", () => {
  console.log(`listening on ws://0.0.0.0:${port}`);
});
