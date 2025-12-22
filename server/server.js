import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

const clients = new Map();

wss.on("connection", ws => {
  const id = crypto.randomUUID();
  clients.set(ws, { id, name: "Guest" });

  ws.on("message", data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (!msg.type) return;

    const client = clients.get(ws);

    switch (msg.type) {
      case "hello":
        client.name = msg.name || "Guest";
        ws.send(JSON.stringify({ type: "hello:ok", id }));
        break;

      case "room:create":
      case "room:join":
      case "room:quick":
        ws.send(JSON.stringify({
          type: "debug",
          received: msg.type,
          name: client.name
        }));
        break;
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
