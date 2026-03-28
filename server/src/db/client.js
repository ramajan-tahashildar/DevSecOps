import { MongoClient } from "mongodb";

let client;
let db;

/**
 * @returns {Promise<import('mongodb').Db>}
 */
export async function connectDb() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const name = process.env.MONGODB_DB_NAME || "devsecops";

  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(name);
  return db;
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
