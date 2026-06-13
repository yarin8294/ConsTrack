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

  // Large construction scans (20M+ points) run a sequential standardize →
  // preprocess → change-detect pipeline that can take many minutes. 30 min keeps
  // the socket alive across the whole request; per-step backstop is in python.ts.
  server.timeout = 1800000;
  server.keepAliveTimeout = 1800000;

  const wss = new WebSocketServer({ server, path: "/ws" });
  registerWs(wss);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
