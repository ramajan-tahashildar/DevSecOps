import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";
import { runDockerScan } from "../scanner/dockerScan.service.js";
import { runSastScan } from "../scanner/sastScan.service.js";
import { runAwsScan } from "../scanner/awsScan.service.js";
import { parsePaginationQuery, paginationMeta } from "../../utils/pagination.js";

/**
 * @param {import('mongodb').Document} doc
 * @param {{ includeFull?: boolean }} [opts]
 */
function toScanReportResponse(doc, opts = {}) {
  const includeFull = opts.includeFull !== false;
  const base = {
    _id: doc._id.toString(),
    scannerId: doc.scannerId.toString(),
    jobId: doc.jobId.toString(),
    userId: doc.userId.toString(),
    type: doc.type,
    target: doc.target,
    summary: doc.summary,
    vulnerabilities: doc.vulnerabilities,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (includeFull && doc.fullReport !== undefined) {
    base.fullReport = doc.fullReport;
  }
  return base;
}

export async function runScanHandler(req, res) {
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

    const scanType = String(scanner.type ?? "")
      .trim()
      .toLowerCase();

    let report;
    if (scanType === "docker") {
      report = await runDockerScan(scannerId, req.user.id, scanner);
    } else if (scanType === "sast") {
      report = await runSastScan(scannerId, req.user.id, scanner);
    } else if (scanType === "aws") {
      report = await runAwsScan(scannerId, req.user.id, scanner);
    } else {
      return res.status(400).json({
        success: false,
        message: `Run scan is not supported for scanner type "${scanner.type}"`,
      });
    }

    res.json({
      success: true,
      message: "Scan completed",
      data: toScanReportResponse(report),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    const notFound =
      message.includes("Scanner not found") || message.includes("Secret not found");

    const badRequest =
      message.includes("Invalid scanner id") ||
      message.includes("not a docker image scanner") ||
      message.includes("not a SAST scanner") ||
      message.includes("required") ||
      message.includes("wrong type") ||
      message.includes("Image pull failed") ||
      message.includes("Registry denied access") ||
      message.includes("Scan command failed") ||
      message.includes("Trivy produced invalid JSON") ||
      message.includes("No tags available for image") ||
      message.includes("dockerConfig.tag or a tag in imageName") ||
      message.includes("Docker Hub authentication failed") ||
      message.includes("Docker Hub repository not found") ||
      message.includes("Cannot list Docker Hub tags") ||
      message.includes("Unable to resolve latest tag:") ||
      message.includes("Unsupported SAST tool") ||
      message.includes("SonarQube scans are not supported") ||
      message.includes("Git clone failed") ||
      message.includes("Semgrep failed") ||
      message.includes("ESLint failed") ||
      message.includes("invalid JSON") ||
      message.includes("SAST tool produced invalid JSON") ||
      message.includes("not an AWS scanner") ||
      message.includes("cloudConfig.region is required") ||
      message.includes("cloudConfig.services must be a non-empty array") ||
      message.includes("secretId is required for AWS scans") ||
      message.includes("expected aws accessKey/secretKey") ||
      message.includes("Secret must include accessKey and secretKey") ||
      message.includes("Invalid cloud service for aws:");

    const serviceUnavailable =
      message.includes("Trivy is not installed") ||
      message.includes("Docker CLI is not installed") ||
      message.includes("Semgrep is not installed") ||
      message.includes("git is not installed") ||
      message.includes("npx is not available");

    const status = notFound
      ? 404
      : badRequest
        ? 400
        : serviceUnavailable
          ? 503
          : 500;
    res.status(status).json({ success: false, message });
  }
}

/** @deprecated Use runScanHandler */
export const runDockerScanHandler = runScanHandler;

/**
 * @param {import("mongodb").Document | null | undefined} doc
 */
function toScanJobPublic(doc) {
  if (!doc) return null;
  return {
    _id: doc._id.toString(),
    status: doc.status,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    error: doc.error != null ? String(doc.error) : null,
  };
}

/**
 * @param {import("mongodb").Document} doc
 */
function toFailedJobTimelineItem(doc) {
  return {
    kind: "failed_job",
    _id: doc._id.toString(),
    error: doc.error != null ? String(doc.error) : "Scan failed",
    startedAt: doc.startedAt,
    completedAt: doc.completedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * @param {{ kind?: string; createdAt?: Date; completedAt?: Date; updatedAt?: Date }} item
 */
function timelineSortMs(item) {
  if (item.kind === "failed_job") {
    return new Date(item.completedAt || item.updatedAt || item.createdAt || 0).getTime();
  }
  return new Date(item.createdAt || 0).getTime();
}

/** True if the client sent a non-empty limit or pageSize (query may be string | string[]). */
function timelineHasExplicitLimit(query) {
  if (!query || typeof query !== "object") return false;
  for (const k of ["limit", "pageSize"]) {
    const v = query[k];
    if (v === undefined || v === null) continue;
    const raw = Array.isArray(v) ? v.find((x) => x != null && String(x).trim() !== "") : v;
    if (raw != null && String(raw).trim() !== "") return true;
  }
  return false;
}

/**
 * Resolves scanner id from `GET /scanners/:scannerId/scan-state` or `GET /scan-state?scannerId=`.
 */
function scannerIdFromScanStateRequest(req) {
  const fromParams =
    typeof req.params?.scannerId === "string" ? req.params.scannerId.trim() : "";
  if (fromParams) return fromParams;
  const fromQuery =
    typeof req.query?.scannerId === "string" ? req.query.scannerId.trim() : "";
  return fromQuery;
}

/**
 * Persistent scan UI state: running job, latest job (failed/completed/running), last failed, latest report.
 * Survives navigation — data comes from `scan_jobs` and `scan_reports`.
 */
export async function getScannerScanState(req, res) {
  try {
    const scannerId = scannerIdFromScanStateRequest(req);
    if (!scannerId || !ObjectId.isValid(scannerId)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid or missing scanner id (use /api/scanners/:scannerId/scan-state or /api/scan-state?scannerId=...)",
      });
    }

    const db = await connectDb();
    const userOid = new ObjectId(req.user.id);
    const scannerOid = new ObjectId(scannerId);

    const scanner = await db.collection(COLLECTIONS.SCANNERS).findOne({
      _id: scannerOid,
      userId: userOid,
      isActive: true,
    });

    if (!scanner) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    const jobsCol = db.collection(COLLECTIONS.SCAN_JOBS);
    const reportsCol = db.collection(COLLECTIONS.SCAN_REPORTS);

    const jobFilter = { scannerId: scannerOid, userId: userOid };

    const [runningJob] = await jobsCol
      .find({ ...jobFilter, status: "running" })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    const [latestJob] = await jobsCol
      .find(jobFilter)
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    const [lastFailedJob] = await jobsCol
      .find({ ...jobFilter, status: "failed" })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    const [lastCompletedJob] = await jobsCol
      .find({ ...jobFilter, status: "completed" })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    const latestReport = await reportsCol.findOne(jobFilter, {
      sort: { createdAt: -1 },
      projection: { _id: 1, createdAt: 1, type: 1, summary: 1 },
    });

    res.json({
      success: true,
      data: {
        scannerId: scannerOid.toString(),
        /** True while a job has status `running` */
        inProgress: Boolean(runningJob),
        /** Active run (subset of latest when running) */
        runningJob: toScanJobPublic(runningJob),
        /** Newest job for this scanner — use for “last outcome”: failed | completed | running */
        latestJob: toScanJobPublic(latestJob),
        /** Most recent failure (still useful if you later completed a run but want history) */
        lastFailedJob: toScanJobPublic(lastFailedJob),
        /** Most recent successful job */
        lastCompletedJob: toScanJobPublic(lastCompletedJob),
        /** Latest stored report (proves a completed scan produced output) */
        latestReport: latestReport
          ? {
            _id: latestReport._id.toString(),
            type: latestReport.type,
            createdAt: latestReport.createdAt,
            summary: latestReport.summary ?? null,
          }
          : null,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Build URL strings to match stored `target.repoUrl` (with/without .git, trailing slash).
 * @param {string} raw
 * @returns {string[]}
 */
function repoUrlQueryVariants(raw) {
  const s = String(raw).trim().replace(/\/+$/, "");
  if (!s) return [];
  const set = new Set([s, s.toLowerCase()]);
  const noGit = s.replace(/\.git$/i, "");
  set.add(noGit);
  set.add(noGit.toLowerCase());
  set.add(`${noGit}.git`);
  set.add(`${noGit.toLowerCase()}.git`);
  return [...set];
}

/**
 * All SAST scan reports for a repository (same user), newest first.
 * Query: repoUrl (required), full=1 optional (include fullReport).
 */
export async function getReportsByRepoUrl(req, res) {
  try {
    const repoUrl = req.query.repoUrl;
    if (typeof repoUrl !== "string" || repoUrl.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "repoUrl query parameter is required (encode the URL, e.g. ?repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo.git)",
      });
    }

    const variants = repoUrlQueryVariants(repoUrl);
    const db = await connectDb();
    const userOid = new ObjectId(req.user.id);

    const includeFull =
      String(req.query.full || "").toLowerCase() === "true" || req.query.full === "1";

    const { page, limit, skip } = parsePaginationQuery(req.query);
    const reportFilter = {
      userId: userOid,
      type: "sast",
      "target.repoUrl": { $in: variants },
    };
    const reportsCol = db.collection(COLLECTIONS.SCAN_REPORTS);

    const [total, reports] = await Promise.all([
      reportsCol.countDocuments(reportFilter),
      reportsCol
        .find(reportFilter, { projection: includeFull ? undefined : { fullReport: 0 } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    res.json({
      success: true,
      data: {
        repoUrl: repoUrl.trim(),
        reports: reports.map((doc) => toScanReportResponse(doc, { includeFull })),
      },
      pagination: paginationMeta({ total, page, limit }),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getScannerReports(req, res) {
  try {
    const { scannerId } = req.params;
    if (!ObjectId.isValid(scannerId)) {
      return res.status(400).json({ success: false, message: "Invalid scanner id" });
    }

    const db = await connectDb();
    const userOid = new ObjectId(req.user.id);
    const scannerOid = new ObjectId(scannerId);

    const scanner = await db.collection(COLLECTIONS.SCANNERS).findOne({
      _id: scannerOid,
      userId: userOid,
      isActive: true,
    });

    if (!scanner) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    const includeFull =
      String(req.query.full || "").toLowerCase() === "true" || req.query.full === "1";

    const jobsCol = db.collection(COLLECTIONS.SCAN_JOBS);

    const [reports, failedJobs] = await Promise.all([
      db
        .collection(COLLECTIONS.SCAN_REPORTS)
        .find(
          { scannerId: scannerOid, userId: userOid },
          { projection: includeFull ? undefined : { fullReport: 0 } },
        )
        .sort({ createdAt: -1 })
        .toArray(),
      jobsCol
        .find({ scannerId: scannerOid, userId: userOid, status: "failed" })
        .sort({ completedAt: -1, createdAt: -1 })
        .toArray(),
    ]);

    const reportItems = reports.map((doc) => ({
      kind: "report",
      ...toScanReportResponse(doc, { includeFull }),
    }));

    const failedItems = failedJobs.map((doc) => toFailedJobTimelineItem(doc));

    const merged = [...reportItems, ...failedItems].sort(
      (a, b) => timelineSortMs(b) - timelineSortMs(a),
    );

    let { page, limit, skip } = parsePaginationQuery(req.query);
    if (!timelineHasExplicitLimit(req.query)) {
      const timelineDefaultLimit = 6;
      limit = timelineDefaultLimit;
      skip = (page - 1) * limit;
    }

    const total = merged.length;
    const data = merged.slice(skip, skip + limit);

    res.json({
      success: true,
      data,
      pagination: paginationMeta({ total, page, limit }),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function safeFilenameSegment(v) {
  return String(v ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function downloadScannerReport(req, res) {
  try {
    const { scannerId, reportId } = req.params;
    if (!ObjectId.isValid(scannerId)) {
      return res.status(400).json({ success: false, message: "Invalid scanner id" });
    }
    if (!ObjectId.isValid(reportId)) {
      return res.status(400).json({ success: false, message: "Invalid report id" });
    }

    const db = await connectDb();
    const userOid = new ObjectId(req.user.id);
    const scannerOid = new ObjectId(scannerId);
    const reportOid = new ObjectId(reportId);

    const scanner = await db.collection(COLLECTIONS.SCANNERS).findOne({
      _id: scannerOid,
      userId: userOid,
      isActive: true,
    });
    if (!scanner) {
      return res.status(404).json({ success: false, message: "Scanner not found" });
    }

    const doc = await db.collection(COLLECTIONS.SCAN_REPORTS).findOne({
      _id: reportOid,
      scannerId: scannerOid,
      userId: userOid,
    });

    if (!doc) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    const payload = {
      kind: "report",
      ...toScanReportResponse(doc, { includeFull: true }),
    };

    const created = payload.createdAt ? new Date(payload.createdAt) : null;
    const datePart = created && !Number.isNaN(created.getTime())
      ? created.toISOString().slice(0, 10)
      : "unknown-date";
    const typePart = safeFilenameSegment(payload.type || "report") || "report";
    const name = `devsecops-${typePart}-${datePart}-${payload._id}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
