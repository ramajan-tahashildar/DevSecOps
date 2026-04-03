import { execFile, spawn } from "child_process";
import { promisify } from "node:util";
import { mkdir, readFile, unlink } from "fs/promises";
import path from "path";
import axios from "axios";
import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";
import { decryptCredentialMap } from "../../utils/encrypt.js";

const execFileAsync = promisify(execFile);

const REPORTS_DIR = path.join(process.cwd(), "reports");

const DOCKER_HUB_API = "https://hub.docker.com/v2/repositories";
const DOCKER_HUB_LOGIN = "https://hub.docker.com/v2/users/login/";
const HUB_HTTP_HEADERS = { "User-Agent": "DevSecOps-Scanner/1.0" };

/**
 * JWT for Docker Hub Registry API (needed to list tags on private repos).
 * Uses the same username/password as `docker login` for Docker Hub.
 *
 * @param {string} username
 * @param {string} password
 */
async function dockerHubLoginJwt(username, password) {
  try {
    const { data } = await axios.post(
      DOCKER_HUB_LOGIN,
      { username, password },
      {
        headers: { ...HUB_HTTP_HEADERS, "Content-Type": "application/json" },
        timeout: 20000,
      },
    );
    const token = data?.token;
    if (!token || typeof token !== "string") {
      throw new Error("Docker Hub authentication failed: invalid login response");
    }
    return token;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      throw new Error(
        "Docker Hub authentication failed: check docker secret username/password (use Hub access token as password if 2FA is on)",
      );
    }
    if (err instanceof Error && err.message.startsWith("Docker Hub authentication failed")) {
      throw err;
    }
    throw new Error("Docker Hub authentication failed: could not reach login API");
  }
}

/**
 * @param {string} storedImageName
 * @param {string} explicitTag from dockerConfig.tag
 * @returns {{ needed: boolean, base: string | null }}
 */
function hubTagResolutionNeeded(storedImageName, explicitTag) {
  const trimmed = storedImageName.trim();
  if (!trimmed || trimmed.includes("@")) {
    return { needed: false, base: null };
  }
  let configTag = explicitTag?.trim() || "";
  const { base, embeddedTag } = splitDockerHubImageRef(trimmed);
  const hub = isDockerHubNamespaceRepo(base);
  if (!hub) return { needed: false, base: null };
  if (isLatestPlaceholder(configTag)) configTag = "";
  const effectiveEmbedded =
    hub && isLatestPlaceholder(embeddedTag) ? null : embeddedTag;
  if (configTag) return { needed: false, base: null };
  if (effectiveEmbedded) return { needed: false, base: null };
  return { needed: true, base };
}

/**
 * @param {unknown} results
 */
function pickPreferredTagFromHubResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const names = results
    .map((r) => (r && typeof r.name === "string" ? r.name.trim() : ""))
    .filter(Boolean);
  if (names.length === 0) return null;
  const nonLatest = names.find((n) => n !== "latest");
  return nonLatest ?? names[0] ?? null;
}

/**
 * Split `namespace/repo:tag` into base + tag (Docker Hub–style only; no registry host).
 * @param {string} ref
 * @returns {{ base: string, embeddedTag: string | null }}
 */
function splitDockerHubImageRef(ref) {
  const colonIdx = ref.lastIndexOf(":");
  if (colonIdx <= 0 || colonIdx >= ref.length - 1) {
    return { base: ref, embeddedTag: null };
  }
  const maybeTag = ref.slice(colonIdx + 1);
  if (maybeTag.includes("/")) {
    return { base: ref, embeddedTag: null };
  }
  return { base: ref.slice(0, colonIdx), embeddedTag: maybeTag };
}

/**
 * True for Docker Hub shorthand `namespace/repo` (no registry hostname in the reference).
 */
function isDockerHubNamespaceRepo(base) {
  const parts = base.split("/");
  if (parts.length !== 2) return false;
  const [ns, repo] = parts;
  if (!ns || !repo) return false;
  if (ns.includes(".") || ns.includes(":") || ns.toLowerCase() === "localhost") return false;
  if (repo.includes("/") || repo.includes(":")) return false;
  return true;
}

/** Many Hub repos never publish a `latest` tag; treat it as “pick newest tag” instead. */
function isLatestPlaceholder(tag) {
  return typeof tag === "string" && tag.toLowerCase() === "latest";
}

/**
 * Resolve the newest tag for a Docker Hub `username/repo` via Hub API (ordering=last_updated).
 * Prefers the first non-`latest` tag in the page when possible.
 *
 * @param {string} imageName `username/repo` (no tag)
 * @param {{ jwt?: string }} [options] Pass `jwt` from {@link dockerHubLoginJwt} for private repositories.
 */
export async function resolveLatestTag(imageName, options = {}) {
  const trimmed = imageName.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      "Unable to resolve latest tag: imageName must be Docker Hub format namespace/repository (no registry host)",
    );
  }
  const [username, repo] = parts;
  const url = `${DOCKER_HUB_API}/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/tags`;
  const jwt = options.jwt;

  /** @type {Record<string, string>} */
  const headers = { ...HUB_HTTP_HEADERS };
  if (jwt) {
    headers.Authorization = `JWT ${jwt}`;
  }

  try {
    const response = await axios.get(url, {
      params: {
        page_size: 25,
        page: 1,
        ordering: "last_updated",
      },
      timeout: 20000,
      headers,
      validateStatus: () => true,
    });

    if (response.status === 404) {
      throw new Error(
        "Docker Hub repository not found. Check dockerConfig.imageName (namespace/repository).",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Cannot list Docker Hub tags (repository is private or access denied). Set dockerConfig.isPrivate to true with Docker Hub username/password in a docker secret, or set dockerConfig.tag to a specific tag.",
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `Unable to resolve latest tag: Docker Hub API returned HTTP ${response.status}`,
      );
    }

    const data = response.data;
    const tag = pickPreferredTagFromHubResults(data?.results);
    if (!tag) {
      throw new Error("No tags available for image");
    }
    return tag;
  } catch (err) {
    if (err instanceof Error && err.message === "No tags available for image") {
      throw err;
    }
    if (
      err instanceof Error &&
      (err.message.startsWith("Docker Hub repository not found") ||
        err.message.startsWith("Cannot list Docker Hub tags") ||
        err.message.startsWith("Unable to resolve latest tag:"))
    ) {
      throw err;
    }
    if (axios.isAxiosError(err)) {
      if (err.code === "ECONNABORTED") {
        throw new Error("Unable to resolve latest tag: request to Docker Hub timed out");
      }
      if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
        throw new Error("Unable to resolve latest tag: cannot reach Docker Hub (network/DNS)");
      }
    }
    throw new Error("Unable to resolve latest tag: unexpected error");
  }
}

/**
 * @param {string} storedImageName
 * @param {string} [explicitTag] from dockerConfig.tag
 * @param {string} [hubJwt] Docker Hub JWT when listing tags for a private repo
 */
async function resolveFullImageName(storedImageName, explicitTag, hubJwt) {
  const trimmed = storedImageName.trim();
  if (!trimmed) {
    throw new Error("dockerConfig.imageName is required");
  }
  if (trimmed.includes("@")) {
    return trimmed;
  }

  let configTag = explicitTag?.trim() || "";
  const { base, embeddedTag } = splitDockerHubImageRef(trimmed);
  const hub = isDockerHubNamespaceRepo(base);

  if (hub && isLatestPlaceholder(configTag)) {
    configTag = "";
  }
  const effectiveEmbedded =
    hub && isLatestPlaceholder(embeddedTag) ? null : embeddedTag;

  if (configTag) {
    return `${base}:${configTag}`;
  }
  if (effectiveEmbedded) {
    return `${base}:${effectiveEmbedded}`;
  }
  if (hub) {
    const resolvedTag = await resolveLatestTag(base, { jwt: hubJwt });
    console.log(`Using tag: ${resolvedTag}`);
    return `${base}:${resolvedTag}`;
  }

  throw new Error("dockerConfig.tag or a tag in imageName is required for non-Docker Hub images");
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function messageFromExecError(err) {
  const e = /** @type {{ stderr?: Buffer | string; stdout?: Buffer | string }} */ (err);
  const stderr =
    e.stderr != null
      ? Buffer.isBuffer(e.stderr)
        ? e.stderr.toString("utf8")
        : String(e.stderr)
      : "";
  const stdout =
    e.stdout != null
      ? Buffer.isBuffer(e.stdout)
        ? e.stdout.toString("utf8")
        : String(e.stdout)
      : "";
  const combined = [stderr, stdout].filter(Boolean).join("\n").trim();
  let text = combined || (err instanceof Error ? err.message : String(err));
  text = text.replace(/^Command failed:\s*/i, "").trim();
  const line = text.split("\n").find((l) => l.trim())?.trim() || text;
  return line;
}

/**
 * @param {unknown} err
 * @param {string} imageName
 * @param {boolean} usedRegistryLogin
 */
function rethrowImageOrTrivyError(err, imageName, usedRegistryLogin) {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String(/** @type {{ code?: string }} */ (err).code)
      : "";
  const errMsg = err instanceof Error ? err.message : String(err);
  if (code === "ENOENT" || errMsg.includes("ENOENT")) {
    const m = errMsg.toLowerCase();
    if (m.includes("trivy")) {
      throw new Error(
        "Trivy is not installed or not on PATH. Install it and ensure `trivy` is available to the same user/environment that runs this server (see https://aquasecurity.github.io/trivy/latest/getting-started/installation/).",
      );
    }
    if (m.includes("docker")) {
      throw new Error(
        "Docker CLI is not installed or not on PATH. Install Docker and ensure `docker` is available to the process that runs this server.",
      );
    }
  }

  const raw = messageFromExecError(err);
  const lower = raw.toLowerCase();

  const privateHint =
    usedRegistryLogin
      ? ""
      : " If this image is in a private repository, set dockerConfig.isPrivate to true and attach a docker-type secret with registry username/password.";

  if (
    lower.includes("not found") ||
    lower.includes("manifest unknown") ||
    lower.includes("repository does not exist") ||
    lower.includes("failed to resolve reference")
  ) {
    throw new Error(
      `Image pull failed for "${imageName}": ${raw}.${privateHint}`,
    );
  }
  if (
    lower.includes("pull access denied") ||
    lower.includes("denied: requested access") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication required")
  ) {
    throw new Error(
      `Registry denied access to "${imageName}": ${raw}.${privateHint}`,
    );
  }

  throw new Error(raw || `Scan command failed for "${imageName}"`);
}

/**
 * Docker Hub uses a single path segment; registry hosts usually appear as the first path segment.
 * @param {string} imageName
 * @returns {string | undefined} registry host for `docker login`, or undefined for Docker Hub
 */
function dockerRegistryHostFromImage(imageName) {
  const parts = imageName.split("/");
  const first = parts[0];
  if (
    parts.length >= 2 &&
    (first.includes(".") || first.includes(":") || first.toLowerCase() === "localhost")
  ) {
    return first;
  }
  return undefined;
}

/**
 * @param {string} username
 * @param {string} password
 * @param {string | undefined} registryHost
 */
function dockerLogin(username, password, registryHost) {
  const args = registryHost
    ? ["login", registryHost, "-u", username, "--password-stdin"]
    : ["login", "-u", username, "--password-stdin"];

  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error((stderr || stdout || `docker login exited ${code}`).trim()));
    });
    child.stdin.write(password, "utf8");
    child.stdin.end();
  });
}

/**
 * @param {unknown} parsed
 */
function summarizeTrivyReport(parsed) {
  const summary = {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  /** @type {Array<Record<string, unknown>>} */
  const vulnerabilities = [];

  const results = parsed?.Results;
  if (!Array.isArray(results)) {
    return { summary, vulnerabilities };
  }

  for (const result of results) {
    const vulns = result?.Vulnerabilities;
    if (!Array.isArray(vulns)) continue;

    for (const vuln of vulns) {
      summary.total++;
      const sev = String(vuln.Severity || "").toLowerCase();
      if (sev in summary && sev !== "total") {
        summary[sev]++;
      }

      vulnerabilities.push({
        id: vuln.VulnerabilityID,
        severity: vuln.Severity,
        title: vuln.Title,
        packageName: vuln.PkgName,
        installedVersion: vuln.InstalledVersion,
        fixedVersion: vuln.FixedVersion,
      });
    }
  }

  return { summary, vulnerabilities };
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
export async function runDockerScan(scannerId, userId, preloadedScanner = null) {
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

  try {
    let scanner = preloadedScanner;
    if (!scanner) {
      scanner = await scannersCol.findOne({
        _id: scannerOid,
        userId: userOid,
        isActive: true,
      });
    }

    if (!scanner || normalizeScannerType(scanner.type) !== "docker") {
      throw new Error("Scanner not found or not a docker image scanner");
    }

    const imageName = scanner.dockerConfig?.imageName?.trim();
    if (!imageName) {
      throw new Error("dockerConfig.imageName is required");
    }

    const configTag =
      typeof scanner.dockerConfig?.tag === "string" ? scanner.dockerConfig.tag : "";
    const isPrivate = Boolean(scanner.dockerConfig?.isPrivate);

    const { needed: needsHubTags, base: hubBase } = hubTagResolutionNeeded(
      imageName,
      configTag,
    );

    /** @type {string | undefined} */
    let hubJwt;
    /** @type {{ username: string; password: string } | null} */
    let dockerCreds = null;

    if (isPrivate) {
      if (!scanner.secretId) {
        throw new Error("secretId is required for private registry images");
      }

      const secret = await secretsCol.findOne({
        _id: new ObjectId(scanner.secretId),
        userId: userOid,
        isActive: true,
      });

      if (!secret || secret.type !== "docker") {
        throw new Error("Secret not found or wrong type (expected docker username/password)");
      }

      const creds = decryptCredentialMap(
        /** @type {Record<string, string>} */ (secret.credentials || {}),
      );
      const username = creds.username;
      const password = creds.password;
      if (!username || !password) {
        throw new Error("Secret must include username and password for docker registry login");
      }
      dockerCreds = { username, password };

      if (needsHubTags && hubBase) {
        hubJwt = await dockerHubLoginJwt(username, password);
      }
    }

    const fullImageName = await resolveFullImageName(imageName, configTag, hubJwt);

    if (isPrivate && dockerCreds) {
      const registryHost = dockerRegistryHostFromImage(fullImageName);
      await dockerLogin(dockerCreds.username, dockerCreds.password, registryHost);
    }

    await mkdir(REPORTS_DIR, { recursive: true });
    const reportPath = path.join(REPORTS_DIR, `${scannerId}-${Date.now()}.json`);

    try {
      await execFileAsync("docker", ["pull", fullImageName], {
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      rethrowImageOrTrivyError(e, fullImageName, isPrivate);
    }

    try {
      await execFileAsync(
        "trivy",
        ["image", "--format", "json", "-o", reportPath, fullImageName],
        { maxBuffer: 64 * 1024 * 1024 },
      );
    } catch (e) {
      rethrowImageOrTrivyError(e, fullImageName, isPrivate);
    }

    const rawData = await readFile(reportPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      throw new Error("Trivy produced invalid JSON");
    }

    await unlink(reportPath).catch(() => {});

    const { summary, vulnerabilities } = summarizeTrivyReport(parsed);

    const reportNow = new Date();
    const reportDoc = {
      scannerId: scannerOid,
      jobId,
      userId: userOid,
      type: "docker",
      target: { imageName: fullImageName, imageNameInput: imageName },
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
  }
}
