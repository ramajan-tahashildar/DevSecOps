import { COLLECTIONS } from "../constants/collections.js";

/**
 * @param {import('mongodb').Db} db
 */
async function ensureUserIndexes(db) {
  const col = db.collection(COLLECTIONS.USERS);
  await col.createIndex({ email: 1 }, { unique: true });
  await col.createIndex({ phone: 1 }, { unique: true, sparse: true });
}

/**
 * @param {import('mongodb').Db} db
 */
async function ensureSecretIndexes(db) {
  const col = db.collection(COLLECTIONS.SECRETS);
  await col.createIndex({ userId: 1, isActive: 1, createdAt: -1 });
}

/**
 * @param {import('mongodb').Db} db
 */
async function ensureScanIndexes(db) {
  const jobs = db.collection(COLLECTIONS.SCAN_JOBS);
  await jobs.createIndex({ userId: 1, scannerId: 1, createdAt: -1 });
  await jobs.createIndex({ userId: 1, scannerId: 1, status: 1, completedAt: -1 });
  const reports = db.collection(COLLECTIONS.SCAN_REPORTS);
  await reports.createIndex({ userId: 1, scannerId: 1, createdAt: -1 });
}

/**
 * @param {import('mongodb').Db} db
 */
export async function ensureIndexes(db) {
  await ensureUserIndexes(db);
  await ensureSecretIndexes(db);
  await ensureScanIndexes(db);
}
