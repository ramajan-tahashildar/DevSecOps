import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../../constants/collections.js";
import { connectDb } from "../../../db/client.js";
import {
  parsePaginationQuery,
  paginationMeta,
} from "../../../utils/pagination.js";

const SCANNER_TYPES = new Set(["docker", "sast", "aws", "azure", "gcp"]);
const DOCKER_REGISTRIES = new Set(["dockerhub", "ecr", "gcr", "acr", "private"]);
const SAST_TOOLS = new Set(["semgrep", "sonarqube", "eslint"]);
const CLOUD_PROVIDERS = new Set(["aws", "azure", "gcp"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function pickSource(body) {
  const s = body?.source;
  if (!s || typeof s !== "object") return {};
  const out = {};
  if (typeof s.repoUrl === "string") out.repoUrl = s.repoUrl.trim() || undefined;
  if (typeof s.branch === "string" && s.branch.trim()) out.branch = s.branch.trim();
  else if (s.branch === undefined && out.repoUrl) out.branch = "main";
  return out;
}

function pickDockerConfig(body) {
  const d = body?.dockerConfig;
  if (!d || typeof d !== "object") return {};
  const out = {};
  if (typeof d.imageName === "string") out.imageName = d.imageName.trim() || undefined;
  if (typeof d.registry === "string") {
    if (!DOCKER_REGISTRIES.has(d.registry)) {
      return { error: `dockerConfig.registry must be one of: ${[...DOCKER_REGISTRIES].join(", ")}` };
    }
    out.registry = d.registry;
  }
  if (typeof d.isPrivate === "boolean") out.isPrivate = d.isPrivate;
  if (typeof d.tag === "string") {
    const t = d.tag.trim();
    out.tag = t || undefined;
  }
  return { value: out };
}

function pickSastConfig(body) {
  const s = body?.sastConfig;
  if (!s || typeof s !== "object") return {};
  const out = {};
  if (typeof s.tool === "string") {
    if (!SAST_TOOLS.has(s.tool)) {
      return { error: `sastConfig.tool must be one of: ${[...SAST_TOOLS].join(", ")}` };
    }
    out.tool = s.tool;
  }
  return { value: out };
}

function pickCloudConfig(body) {
  const c = body?.cloudConfig;
  if (!c || typeof c !== "object") return {};
  const out = {};
  if (typeof c.provider === "string") {
    if (!CLOUD_PROVIDERS.has(c.provider)) {
      return { error: `cloudConfig.provider must be one of: ${[...CLOUD_PROVIDERS].join(", ")}` };
    }
    out.provider = c.provider;
  }
  if (typeof c.region === "string") out.region = c.region.trim() || undefined;
  if (Array.isArray(c.services)) {
    out.services = c.services.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  }
  return { value: out };
}

function normalizeTags(body) {
  if (!Array.isArray(body?.tags)) return [];
  return body.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim());
}

/** True if client sent any repo/branch fields (docker & cloud scans must not use source). */
function sourceHasRepoFields(s) {
  if (!s || typeof s !== "object") return false;
  if (isNonEmptyString(s.repoUrl)) return true;
  if (isNonEmptyString(s.branch)) return true;
  return false;
}

/** Query `type` (and some proxies) may arrive as a string[]; path route sets `req.params.type`. */
function scannerTypeFilterFromRequest(req) {
  const fromParam = req.params?.type;
  if (fromParam !== undefined && String(fromParam).trim() !== "") {
    return String(fromParam).trim();
  }
  const q = req.query?.type;
  if (q === undefined || q === null) return undefined;
  if (Array.isArray(q)) {
    const first = q.find((x) => x !== undefined && String(x).trim() !== "");
    return first !== undefined ? String(first).trim() : undefined;
  }
  const s = String(q).trim();
  return s === "" ? undefined : s;
}

/**
 * @param {import('mongodb').Document} doc
 */
function toScannerResponse(doc) {
  const base = {
    _id: doc._id.toString(),
    userId: doc.userId.toString(),
    name: doc.name,
    type: doc.type,
    source: doc.source || {},
    dockerConfig: doc.dockerConfig || {},
    sastConfig: doc.sastConfig || {},
    cloudConfig: doc.cloudConfig || {},
    tags: doc.tags || [],
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (doc.secretId) base.secretId = doc.secretId.toString();
  return base;
}

/**
 * @param {import('mongodb').Document} doc
 */
function toScannerListItem(doc) {
  return {
    _id: doc._id.toString(),
    name: doc.name,
    type: doc.type,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
  };
}

async function assertSecretOwnedByUser(db, secretId, userId) {
  const col = db.collection(COLLECTIONS.SECRETS);
  const secret = await col.findOne({
    _id: new ObjectId(secretId),
    userId: new ObjectId(userId),
    isActive: true,
  });
  return Boolean(secret);
}

function buildScannerPayload(body, { partial } = { partial: false }) {
  const payload = {};

  if (!partial || body.name !== undefined) {
    if (!isNonEmptyString(body.name)) {
      return { error: "name is required" };
    }
    payload.name = body.name.trim();
  }

  if (!partial || body.type !== undefined) {
    if (!isNonEmptyString(body.type) || !SCANNER_TYPES.has(body.type)) {
      return {
        error: `type is required and must be one of: ${[...SCANNER_TYPES].join(", ")}`,
      };
    }
    payload.type = body.type;
  }

  if (!partial || body.source !== undefined) {
    if (!partial) {
      const src = pickSource(body);
      if (payload.type === "sast") {
        if (!isNonEmptyString(src.repoUrl)) {
          return { error: "SAST scanners require source.repoUrl" };
        }
        payload.source = src;
      } else {
        if (sourceHasRepoFields(src)) {
          return {
            error:
              "source is only for SAST (repo-based) scans; omit source for docker and cloud scan types",
          };
        }
        payload.source = {};
      }
    } else {
      payload.source = pickSource(body);
    }
  }

  if (!partial || body.dockerConfig !== undefined) {
    const dc = pickDockerConfig(body);
    if (dc.error) return { error: dc.error };
    payload.dockerConfig = dc.value;
  }

  if (!partial || body.sastConfig !== undefined) {
    const sc = pickSastConfig(body);
    if (sc.error) return { error: sc.error };
    payload.sastConfig = sc.value;
  }

  if (!partial || body.cloudConfig !== undefined) {
    const cc = pickCloudConfig(body);
    if (cc.error) return { error: cc.error };
    payload.cloudConfig = cc.value;
  }

  if (!partial || body.tags !== undefined) {
    payload.tags = normalizeTags(body);
  }

  if (!partial || body.secretId !== undefined) {
    if (body.secretId === null || body.secretId === "") {
      payload.secretId = null;
    } else if (body.secretId !== undefined) {
      if (!ObjectId.isValid(body.secretId)) {
        return { error: "Invalid secretId" };
      }
      payload.secretId = new ObjectId(body.secretId);
    }
  }

  if (!partial || body.isActive !== undefined) {
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
      return { error: "isActive must be a boolean" };
    }
    if (body.isActive !== undefined) payload.isActive = body.isActive;
  }

  const docker = payload.dockerConfig || {};
  if (
    payload.type === "docker" &&
    docker.isPrivate === true &&
    !payload.secretId &&
    !partial
  ) {
    return { error: "secretId is required when docker registry is private" };
  }

  return { value: payload };
}

export async function createScanner(req, res) {
  try {
    const built = buildScannerPayload(req.body, { partial: false });
    if (built.error) {
      return res.status(400).json({ success: false, message: built.error });
    }

    const { secretId, ...rest } = built.value;
    const db = await connectDb();
    if (secretId && !(await assertSecretOwnedByUser(db, secretId, req.user.id))) {
      return res.status(400).json({ success: false, message: "Secret not found or not owned by user" });
    }
    const col = db.collection(COLLECTIONS.SCANNERS);
    const now = new Date();
    const doc = {
      userId: new ObjectId(req.user.id),
      ...rest,
      ...(secretId ? { secretId } : {}),
      isActive: built.value.isActive !== undefined ? built.value.isActive : true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await col.insertOne(doc);
    const saved = { ...doc, _id: result.insertedId };

    res.status(201).json({ success: true, data: toScannerResponse(saved) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getScanners(req, res) {
  try {
    const filter = {
      userId: new ObjectId(req.user.id),
      isActive: true,
    };

    const rawType = scannerTypeFilterFromRequest(req);
    if (rawType !== undefined) {
      const type = rawType;
      if (!SCANNER_TYPES.has(type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid type query; must be one of: ${[...SCANNER_TYPES].join(", ")}`,
        });
      }
      filter.type = type;
    }

    const { page, limit, skip } = parsePaginationQuery(req.query);

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SCANNERS);
    const [total, scanners] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter, { projection: { name: 1, type: 1, isActive: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    res.json({
      success: true,
      data: scanners.map(toScannerListItem),
      pagination: paginationMeta({ total, page, limit }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getScannerById(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid scanner id" });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SCANNERS);
    const scanner = await col.findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.user.id),
      isActive: true,
    });

    if (!scanner) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    res.json({ success: true, data: toScannerResponse(scanner) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateScanner(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid scanner id" });
    }

    const built = buildScannerPayload(req.body, { partial: true });
    if (built.error) {
      return res.status(400).json({ success: false, message: built.error });
    }

    const updates = built.value;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SCANNERS);
    const existing = await col.findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(req.user.id),
      isActive: true,
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    if (updates.secretId !== undefined) {
      if (updates.secretId && !(await assertSecretOwnedByUser(db, updates.secretId, req.user.id))) {
        return res.status(400).json({ success: false, message: "Secret not found or not owned by user" });
      }
    }

    const mergedType = updates.type ?? existing.type;

    let mergedSource;
    if (mergedType === "sast") {
      mergedSource =
        updates.source !== undefined
          ? { ...(existing.source || {}), ...updates.source }
          : existing.source || {};
      if (!isNonEmptyString(mergedSource.repoUrl)) {
        return res.status(400).json({
          success: false,
          message: "SAST scanners require source.repoUrl",
        });
      }
    } else {
      if (updates.source !== undefined && sourceHasRepoFields(updates.source)) {
        return res.status(400).json({
          success: false,
          message:
            "source is only for SAST (repo-based) scans; omit source for docker and cloud scan types",
        });
      }
      mergedSource = {};
    }

    const mergedDocker = { ...(existing.dockerConfig || {}), ...(updates.dockerConfig || {}) };
    const mergedSecretId =
      updates.secretId !== undefined ? updates.secretId : existing.secretId;

    if (
      mergedType === "docker" &&
      mergedDocker.isPrivate === true &&
      !mergedSecretId
    ) {
      return res.status(400).json({
        success: false,
        message: "secretId is required when docker registry is private",
      });
    }

    const now = new Date();
    const $set = { updatedAt: now };
    if (updates.name !== undefined) $set.name = updates.name;
    if (updates.type !== undefined) $set.type = updates.type;
    if (updates.tags !== undefined) $set.tags = updates.tags;
    if (updates.isActive !== undefined) $set.isActive = updates.isActive;
    $set.source = mergedSource;
    if (updates.dockerConfig !== undefined) {
      $set.dockerConfig = { ...(existing.dockerConfig || {}), ...updates.dockerConfig };
    }
    if (updates.sastConfig !== undefined) {
      $set.sastConfig = { ...(existing.sastConfig || {}), ...updates.sastConfig };
    }
    if (updates.cloudConfig !== undefined) {
      $set.cloudConfig = { ...(existing.cloudConfig || {}), ...updates.cloudConfig };
    }
    if (updates.secretId !== undefined) {
      $set.secretId = updates.secretId;
    }

    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(req.user.id), isActive: true },
      { $set },
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    res.json({ success: true, data: toScannerResponse(updated) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteScanner(req, res) {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid scanner id" });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.SCANNERS);
    const updated = await col.findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(req.user.id) },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    res.json({ success: true, message: "Scanner deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
