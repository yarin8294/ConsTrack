import "dotenv/config";
import { WebSocketServer } from "ws";
import { connectDb } from "./db.js";
import { createApp } from "./app.js";
import { registerWs } from "./realtime.js";

const PORT = Number(process.env.PORT || 4000);

async function main() {
  await connectDb();

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });

  server.timeout = 300000;
  server.keepAliveTimeout = 300000;

  const wss = new WebSocketServer({ server, path: "/ws" });
  registerWs(wss);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
