import crypto from "crypto";

function getKey() {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!secret || String(secret).trim() === "") {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  }
  return crypto.createHash("sha256").update(String(secret), "utf8").digest();
}

/**
 * @param {string} text
 * @returns {string} hex IV + ":" + hex ciphertext
 */
export function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * @param {string} payload
 * @returns {string}
 */
export function decrypt(payload) {
  const key = getKey();
  const [ivHex, encHex] = String(payload).split(":");
  if (!ivHex || !encHex) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * @param {Record<string, string>} plain
 * @returns {Record<string, string>}
 */
export function encryptCredentialMap(plain) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(plain)) {
    out[k] = encrypt(String(v));
  }
  return out;
}

/**
 * @param {Record<string, string>} stored
 * @returns {Record<string, string>}
 */
export function decryptCredentialMap(stored) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(stored)) {
    out[k] = decrypt(String(v));
  }
  return out;
}
