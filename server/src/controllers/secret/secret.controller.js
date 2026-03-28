import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";
import {
  decryptCredentialMap,
  encryptCredentialMap,
} from "../../utils/encrypt.js";
import { validateSecretByType } from "../../utils/validateSecret.js";
import { parsePaginationQuery, paginationMeta } from "../../utils/pagination.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * @param {import('mongodb').Document} doc
 * @param {{ includeCredentials?: boolean }} [opts]
 */
function toSecretResponse(doc, opts = {}) {
  const base = {
    _id: doc._id.toString(),
    userId: doc.userId.toString(),
    name: doc.name,
    type: doc.type,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (opts.includeCredentials && doc.credentials && typeof doc.credentials === "object") {
    base.credentials = decryptCredentialMap(/** @type {Record<string, string>} */ (doc.credentials));
  }
  return base;
}

/**
 * @param {import('mongodb').Document} doc
 */
function toSecretListItem(doc) {
  return {
    _id: doc._id.toString(),
    name: doc.name,
    type: doc.type,
    createdAt: doc.createdAt,
  };
}

export async function createSecret(req, res) {
  try {
    const { name, type, credentials } = req.body;

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    if (!isNonEmptyString(type)) {
      return res.status(400).json({ success: false, message: "type is required" });
    }

    const validation = validateSecretByType(type, credentials);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SECRETS);
    const now = new Date();
    const encrypted = encryptCredentialMap(
      /** @type {Record<string, string>} */ (credentials),
    );

    const doc = {
      userId: new ObjectId(req.user.id),
      name: name.trim(),
      type,
      credentials: encrypted,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await col.insertOne(doc);
    const saved = { ...doc, _id: result.insertedId };

    res.status(201).json({
      success: true,
      data: toSecretResponse(saved, { includeCredentials: true }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getSecrets(req, res) {
  try {
    const { page, limit, skip } = parsePaginationQuery(req.query);
    const filter = { userId: new ObjectId(req.user.id), isActive: true };

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SECRETS);
    const [total, secrets] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter, { projection: { name: 1, type: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    res.json({
      success: true,
      data: secrets.map(toSecretListItem),
      pagination: paginationMeta({ total, page, limit }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getSecretById(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid secret id" });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SECRETS);
    const secret = await col.findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.user.id),
    });

    if (!secret) {
      return res.status(404).json({ success: false, message: "Secret not found" });
    }

    res.json({ success: true, data: toSecretResponse(secret, { includeCredentials: true }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateSecret(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid secret id" });
    }

    const { name, type, credentials } = req.body;

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    if (!isNonEmptyString(type)) {
      return res.status(400).json({ success: false, message: "type is required" });
    }

    const validation = validateSecretByType(type, credentials);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SECRETS);
    const now = new Date();
    const encrypted = encryptCredentialMap(
      /** @type {Record<string, string>} */ (credentials),
    );

    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(req.user.id) },
      {
        $set: {
          name: name.trim(),
          type,
          credentials: encrypted,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Secret not found" });
    }

    res.json({
      success: true,
      data: toSecretResponse(updated, { includeCredentials: true }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteSecret(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid secret id" });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SECRETS);
    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(req.user.id) },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Secret not found" });
    }

    res.json({ success: true, message: "Secret deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
