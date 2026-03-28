import { execFile } from "child_process";
import { promisify } from "node:util";
import fs from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";
import { decryptCredentialMap } from "../../utils/encrypt.js";

const execFileAsync = promisify(execFile);

const SUPPORTED_TOOLS = new Set(["semgrep", "eslint"]);

/** Override if `semgrep` is not on PATH (absolute path or binary name). */
function semgrepExecutable() {
  const p = process.env.SEMGREP_PATH?.trim();
  return p && p.length > 0 ? p : "semgrep";
}

/**
 * @param {unknown} err
 * @param {"git" | "semgrep" | "eslint" | "npx"} tool
 */
function throwIfToolMissing(err, tool) {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String(/** @type {{ code?: string }} */ (err).code)
      : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code !== "ENOENT" && !msg.includes("ENOENT")) return;

  const messages = {
    git: "git is not installed or not on PATH",
    semgrep:
      "Semgrep is not installed or not on PATH. Install: https://semgrep.dev/docs/getting-started/ — or set SEMGREP_PATH in .env to the full path of the semgrep binary (same PATH your terminal uses if you run `which semgrep`).",
    eslint: "eslint failed to run (install Node and ensure eslint is available via npx in the repo or globally)",
    npx: "npx is not available (Node.js/npm is required for ESLint scans)",
  };
  throw new Error(messages[tool] || `Required tool not found (${tool})`);
}

/**
 * @param {string} repoUrl
 * @param {string | undefined} token
 */
function withGitCredentials(repoUrl, token) {
  const t = token?.trim();
  if (!t) return repoUrl.trim();

  let u;
  try {
    u = new URL(repoUrl.trim());
  } catch {
    return repoUrl.trim();
  }
  if (u.protocol !== "https:") {
    return repoUrl.trim();
  }
  u.username = "git";
  u.password = t;
  return u.toString();
}

/**
 * Shallow clone a single branch.
 *
 * @param {string} repoUrl
 * @param {string} branch
 * @param {string | undefined} token
 * @param {string} destDir absolute path to clone into (…/repo)
 */
async function cloneRepo(repoUrl, branch, token, destDir) {
  const url = withGitCredentials(repoUrl, token);
  await fs.mkdir(path.dirname(destDir), { recursive: true });

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--branch", branch, url, destDir],
      {
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
  } catch (err) {
    throwIfToolMissing(err, "git");
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(/** @type {{ stderr?: Buffer }} */ (err).stderr || "")
        : "";
    const hint = token
      ? ""
      : " For a private repository, attach a git-type secret (token) to the scanner.";
    throw new Error(
      `Git clone failed (check repo URL, branch name, and access). ${stderr.trim().slice(0, 500)}${hint}`,
    );
  }
}

/**
 * @param {string} repoDir
 * @param {string} reportPath
 */
async function runSemgrep(repoDir, reportPath) {
  const semgrepBin = semgrepExecutable();
  try {
    await execFileAsync(
      semgrepBin,
      ["scan", "--config", "auto", "--json", "-o", reportPath],
      {
        cwd: repoDir,
        maxBuffer: 128 * 1024 * 1024,
        env: process.env,
      },
    );
  } catch (err) {
    throwIfToolMissing(err, "semgrep");
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? /** @type {{ code?: number }} */ (err).code
        : undefined;
    if (code === 1) {
      try {
        await fs.access(reportPath);
        return;
      } catch {
        /* fall through */
      }
    }
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(/** @type {{ stderr?: Buffer }} */ (err).stderr || "")
        : "";
    throw new Error(
      `Semgrep failed: ${stderr.trim().slice(0, 500) || (err instanceof Error ? err.message : String(err))}`,
    );
  }
}

/**
 * @param {string} repoDir
 * @param {string} reportPath
 */
async function runEslint(repoDir, reportPath) {
  try {
    await execFileAsync(
      "npx",
      ["--yes", "eslint", ".", "-f", "json", "-o", reportPath],
      {
        cwd: repoDir,
        maxBuffer: 64 * 1024 * 1024,
        env: process.env,
      },
    );
  } catch (err) {
    throwIfToolMissing(err, "npx");
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? /** @type {{ code?: number }} */ (err).code
        : undefined;
    if (code === 1) {
      try {
        await fs.access(reportPath);
        return;
      } catch {
        /* fall through */
      }
    }
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(/** @type {{ stderr?: Buffer }} */ (err).stderr || "")
        : "";
    throw new Error(
      `ESLint failed (is this a JavaScript project with eslint configured?): ${stderr.trim().slice(0, 500) || (err instanceof Error ? err.message : String(err))}`,
    );
  }
}

/**
 * @param {unknown} parsed
 */
function parseSemgrepReport(parsed) {
  const summary = { total: 0, error: 0, warning: 0, info: 0 };
  /** @type {Array<Record<string, unknown>>} */
  const vulnerabilities = [];

  const results = parsed?.results;
  if (!Array.isArray(results)) {
    return { summary, vulnerabilities };
  }

  for (const r of results) {
    summary.total++;
    const extra = r?.extra && typeof r.extra === "object" ? r.extra : {};
    const sev = String(extra.severity ?? "INFO").toUpperCase();
    if (sev === "ERROR") summary.error++;
    else if (sev === "WARNING") summary.warning++;
    else summary.info++;

    const start = r?.start && typeof r.start === "object" ? r.start : {};
    vulnerabilities.push({
      id: typeof r.check_id === "string" ? r.check_id : undefined,
      severity: sev,
      filePath: typeof r.path === "string" ? r.path : "",
      line: typeof start.line === "number" ? start.line : undefined,
      message: typeof extra.message === "string" ? extra.message : "",
    });
  }

  return { summary, vulnerabilities };
}

/**
 * @param {unknown} parsed
 */
function parseEslintReport(parsed) {
  const summary = { total: 0, error: 0, warning: 0, info: 0 };
  /** @type {Array<Record<string, unknown>>} */
  const vulnerabilities = [];

  if (!Array.isArray(parsed)) {
    return { summary, vulnerabilities };
  }

  for (const file of parsed) {
    const filePath = typeof file.filePath === "string" ? file.filePath : "";
    const messages = file.messages;
    if (!Array.isArray(messages)) continue;

    for (const m of messages) {
      summary.total++;
      const sevNum = typeof m.severity === "number" ? m.severity : 0;
      let sev = "INFO";
      if (sevNum === 2) {
        sev = "ERROR";
        summary.error++;
      } else if (sevNum === 1) {
        sev = "WARNING";
        summary.warning++;
      } else {
        summary.info++;
      }

      vulnerabilities.push({
        id: typeof m.ruleId === "string" ? m.ruleId : undefined,
        ruleId: typeof m.ruleId === "string" ? m.ruleId : undefined,
        severity: sev,
        filePath,
        line: typeof m.line === "number" ? m.line : undefined,
        message: typeof m.message === "string" ? m.message : "",
      });
    }
  }

  return { summary, vulnerabilities };
}

/**
 * @param {string} tool
 * @param {unknown} parsed
 */
function parseReport(tool, parsed) {
  if (tool === "eslint") {
    return parseEslintReport(parsed);
  }
  return parseSemgrepReport(parsed);
}

function normalizeScannerType(t) {
  return String(t ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} scannerId
 * @param {string} userId
 * @param {import("mongodb").Document | null} [preloadedScanner] from run handler (avoids a second fetch / type mismatch)
 */
export async function runSastScan(scannerId, userId, preloadedScanner = null) {
  if (!ObjectId.isValid(scannerId)) {
    throw new Error("Invalid scanner id");
  }
  if (!ObjectId.isValid(userId)) {
    throw new Error("Invalid user id");
  }

  const db = await connectDb();
  const jobsCol = db.collection(COLLECTIONS.SCAN_JOBS);
  const scannersCol = db.collection(COLLECTIONS.SCANNERS);
  const secretsCol = db.collection(COLLECTIONS.SECRETS);
  const reportsCol = db.collection(COLLECTIONS.SCAN_REPORTS);

  const scannerOid = new ObjectId(scannerId);
  const userOid = new ObjectId(userId);

  const now = new Date();
  const jobDoc = {
    scannerId: scannerOid,
    userId: userOid,
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const { insertedId: jobId } = await jobsCol.insertOne(jobDoc);

  const workRoot = path.join(
    tmpdir(),
    `sast-scan-${scannerId}-${Date.now()}`,
  );
  const repoDir = path.join(workRoot, "repo");
  const reportPath = path.join(workRoot, "report.json");

  try {
    let scanner = preloadedScanner;
    if (!scanner) {
      scanner = await scannersCol.findOne({
        _id: scannerOid,
        userId: userOid,
        isActive: true,
      });
    }

    if (!scanner || normalizeScannerType(scanner.type) !== "sast") {
      throw new Error("Scanner not found or not a SAST scanner");
    }

    const repoUrl =
      typeof scanner.source?.repoUrl === "string"
        ? scanner.source.repoUrl.trim()
        : "";
    const branchRaw =
      typeof scanner.source?.branch === "string"
        ? scanner.source.branch.trim()
        : "";
    const branch = branchRaw || "main";

    if (!repoUrl) {
      throw new Error("SAST scanner requires source.repoUrl");
    }

    const toolRaw = scanner.sastConfig?.tool;
    const tool =
      typeof toolRaw === "string" ? toolRaw.toLowerCase().trim() : "";

    if (tool === "sonarqube") {
      throw new Error("SonarQube scans are not supported yet");
    }
    if (!SUPPORTED_TOOLS.has(tool)) {
      throw new Error(
        `Unsupported SAST tool "${toolRaw}". Use semgrep or eslint.`,
      );
    }

    /** @type {string | undefined} */
    let gitToken;
    if (scanner.secretId) {
      const secret = await secretsCol.findOne({
        _id: new ObjectId(scanner.secretId),
        userId: userOid,
        isActive: true,
        type: "git",
      });
      if (!secret) {
        throw new Error("Secret not found or not a git-type secret");
      }
      const creds = decryptCredentialMap(
        /** @type {Record<string, string>} */ (secret.credentials || {}),
      );
      gitToken = creds.token?.trim() || undefined;
    }

    await cloneRepo(repoUrl, branch, gitToken, repoDir);

    if (tool === "semgrep") {
      await runSemgrep(repoDir, reportPath);
    } else {
      await runEslint(repoDir, reportPath);
    }

    const raw = await fs.readFile(reportPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("SAST tool produced invalid JSON");
    }

    const { summary, vulnerabilities } = parseReport(tool, parsed);

    const reportNow = new Date();
    const reportDoc = {
      scannerId: scannerOid,
      jobId,
      userId: userOid,
      type: "sast",
      target: {
        repoUrl,
        branch,
        tool,
      },
      summary,
      vulnerabilities,
      fullReport: parsed,
      createdAt: reportNow,
      updatedAt: reportNow,
    };

    const { insertedId: reportId } = await reportsCol.insertOne(reportDoc);

    await jobsCol.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "completed",
          completedAt: reportNow,
          updatedAt: reportNow,
        },
      },
    );

    return { ...reportDoc, _id: reportId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await jobsCol.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "failed",
          error: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    throw error;
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
