import { connectDb } from "../db/client.js";

export async function pingDb(_req, res, next) {
  try {
    const db = await connectDb();
    const result = await db.command({ ping: 1 });
    res.json({ ok: true, ping: result });
  } catch (err) {
    next(err);
  }
}
