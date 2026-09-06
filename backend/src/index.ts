import { createApp } from "./app";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ event: "server_started", port: PORT }));
});

/** Disposability (CLAUDE.md's 12-Factor Adaptation): shut down cleanly on SIGTERM rather than being killed mid-request. */
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
