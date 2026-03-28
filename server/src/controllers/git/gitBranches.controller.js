import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";
import { decryptCredentialMap } from "../../utils/encrypt.js";
import { listGitBranches } from "../../services/git/listBranches.service.js";
import { parsePaginationQuery, paginationMeta } from "../../utils/pagination.js";

/**
 * @param {import('mongodb').Db} db
 * @param {string} userId
 * @param {string | undefined} secretId
 * @returns {Promise<string | undefined>}
 */
async function resolveGitToken(db, userId, secretId) {
  if (!secretId || !ObjectId.isValid(secretId)) {
    return undefined;
  }

  const secret = await db.collection(COLLECTIONS.SECRETS).findOne({
    _id: new ObjectId(secretId),
    userId: new ObjectId(userId),
    isActive: true,
    type: "git",
  });

  if (!secret) {
    throw new Error("Secret not found or not a git-type secret");
  }

  const creds = decryptCredentialMap(
    /** @type {Record<string, string>} */ (secret.credentials || {}),
  );
  const token = creds.token?.trim();
  return token || undefined;
}

export async function postListGitBranches(req, res) {
  try {
    const { repoUrl, secretId } = req.body ?? {};

    if (typeof repoUrl !== "string" || repoUrl.trim() === "") {
      return res.status(400).json({ success: false, message: "repoUrl is required" });
    }

    const db = await connectDb();
    let token;
    if (secretId !== undefined && secretId !== null && secretId !== "") {
      if (!ObjectId.isValid(String(secretId))) {
        return res.status(400).json({ success: false, message: "Invalid secretId" });
      }
      try {
        token = await resolveGitToken(db, req.user.id, String(secretId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(404).json({ success: false, message: msg });
      }
    }

    const allBranches = await listGitBranches(repoUrl.trim(), { token });
    const { page, limit, skip } = parsePaginationQuery(req.query);
    const total = allBranches.length;
    const branches = allBranches.slice(skip, skip + limit);

    res.json({
      success: true,
      data: { branches },
      pagination: paginationMeta({ total, page, limit }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const client =
      message.includes("Unsupported") ||
      message.includes("required") ||
      message.includes("not found") ||
      message.includes("access denied") ||
      message.includes("API error");
    res.status(client ? 400 : 500).json({ success: false, message });
  }
}

export async function getBranchesForSastScanner(req, res) {
  try {
    const { scannerId } = req.params;
    if (!ObjectId.isValid(scannerId)) {
      return res.status(400).json({ success: false, message: "Invalid scanner id" });
    }

    const db = await connectDb();
    const scanner = await db.collection(COLLECTIONS.SCANNERS).findOne({
      _id: new ObjectId(scannerId),
      userId: new ObjectId(req.user.id),
      isActive: true,
    });

    if (!scanner) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }
    if (scanner.type !== "sast") {
      return res.status(400).json({
        success: false,
        message: "Branch listing is only available for SAST scanners",
      });
    }

    const repoUrl = scanner.source?.repoUrl;
    if (typeof repoUrl !== "string" || repoUrl.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "SAST scanner is missing source.repoUrl",
      });
    }

    let token;
    if (scanner.secretId) {
      try {
        token = await resolveGitToken(db, req.user.id, scanner.secretId.toString());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(400).json({ success: false, message: msg });
      }
    }

    const allBranches = await listGitBranches(repoUrl.trim(), { token });
    const { page, limit, skip } = parsePaginationQuery(req.query);
    const total = allBranches.length;
    const branches = allBranches.slice(skip, skip + limit);

    res.json({
      success: true,
      data: { branches, repoUrl: repoUrl.trim() },
      pagination: paginationMeta({ total, page, limit }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const client =
      message.includes("Unsupported") ||
      message.includes("not found") ||
      message.includes("accessible") ||
      message.includes("access denied") ||
      message.includes("API error");
    res.status(client ? 400 : 500).json({ success: false, message });
  }
}
