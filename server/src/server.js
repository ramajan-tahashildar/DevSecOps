import "dotenv/config";
import { createApp } from "./app.js";
import { closeDb, connectDb } from "./db/client.js";
import { ensureIndexes } from "./db/indexes.js";

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is required (set it in .env)");
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required (set it in .env)");
  process.exit(1);
}
if (!process.env.CREDENTIALS_ENCRYPTION_KEY || String(process.env.CREDENTIALS_ENCRYPTION_KEY).trim() === "") {
  console.error("CREDENTIALS_ENCRYPTION_KEY is required (set it in .env)");
  process.exit(1);
}

const app = createApp();
const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, async () => {
  try {
    const db = await connectDb();
    await ensureIndexes(db);
    console.log(`Server listening on http://localhost:${port}`);
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }
});

async function shutdown(signal) {
  console.log(`\n${signal} received, closing…`);
  server.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
