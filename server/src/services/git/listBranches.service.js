import axios from "axios";

const HTTP_HEADERS = { "User-Agent": "DevSecOps-Server/1.0" };

/**
 * @typedef {{ type: 'github', owner: string, repo: string, apiBase: string }} GitHubParsed
 * @typedef {{ type: 'gitlab', projectPath: string, apiBase: string }} GitLabParsed
 */

/**
 * @param {string} repoUrl
 * @returns {GitHubParsed | GitLabParsed | null}
 */
export function parseGitRemoteUrl(repoUrl) {
  let u;
  try {
    u = new URL(String(repoUrl).trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return null;
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/^\//, "").replace(/\.git$/i, "");
  const segments = path.split("/").filter(Boolean);

  if (host === "github.com") {
    if (segments.length < 2) return null;
    return {
      type: "github",
      owner: segments[0],
      repo: segments[1],
      apiBase: "https://api.github.com",
    };
  }

  if (host.endsWith(".github.com") && segments.length >= 2) {
    return {
      type: "github",
      owner: segments[0],
      repo: segments[1],
      apiBase: `https://${host}/api/v3`,
    };
  }

  const isGitLabHost = host === "gitlab.com" || host.includes("gitlab");
  if (!isGitLabHost || segments.length < 2) {
    return null;
  }
  const projectPath = segments.join("/");
  const apiBase = `${u.origin}/api/v4`;
  return { type: "gitlab", projectPath, apiBase };
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} apiBase
 * @param {string | undefined} token
 */
async function listGitHubBranches(owner, repo, apiBase, token) {
  /** @type {string[]} */
  const branches = [];
  let page = 1;

  while (true) {
    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`;
    /** @type {Record<string, string>} */
    const headers = {
      ...HTTP_HEADERS,
      Accept: "application/vnd.github+json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await axios.get(url, {
      params: { per_page: 100, page },
      timeout: 25000,
      headers,
      validateStatus: () => true,
    });

    if (response.status === 404) {
      throw new Error("Repository not found or not accessible (check URL and token for private repos)");
    }
    if (response.status === 403) {
      throw new Error(
        "GitHub API access denied (rate limit or missing token for private repo). Use a git secret with a personal access token.",
      );
    }
    if (response.status !== 200) {
      throw new Error(`GitHub API error: HTTP ${response.status}`);
    }

    const data = response.data;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const row of data) {
      if (row && typeof row.name === "string") branches.push(row.name);
    }
    if (data.length < 100) break;
    page += 1;
    if (page > 50) break;
  }

  return [...new Set(branches)].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} projectPath
 * @param {string} apiBase
 * @param {string | undefined} token
 */
async function listGitLabBranches(projectPath, apiBase, token) {
  /** @type {string[]} */
  const branches = [];
  let page = 1;

  const encodedProject = encodeURIComponent(projectPath);
  /** @type {Record<string, string>} */
  const headers = { ...HTTP_HEADERS };
  if (token) {
    headers["PRIVATE-TOKEN"] = token;
  }

  while (true) {
    const url = `${apiBase}/projects/${encodedProject}/repository/branches`;
    const response = await axios.get(url, {
      params: { per_page: 100, page },
      timeout: 25000,
      headers,
      validateStatus: () => true,
    });

    if (response.status === 404) {
      throw new Error("GitLab project not found or not accessible (check path and token for private projects)");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "GitLab API access denied. Use a git secret with a personal access token (scope: read_repository).",
      );
    }
    if (response.status !== 200) {
      throw new Error(`GitLab API error: HTTP ${response.status}`);
    }

    const data = response.data;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const row of data) {
      if (row && typeof row.name === "string") branches.push(row.name);
    }
    if (data.length < 100) break;
    page += 1;
    if (page > 50) break;
  }

  return [...new Set(branches)].sort((a, b) => a.localeCompare(b));
}

/**
 * List remote branch names for a supported HTTPS git remote (GitHub or GitLab-compatible API).
 *
 * @param {string} repoUrl
 * @param {{ token?: string }} [options]
 */
export async function listGitBranches(repoUrl, options = {}) {
  const trimmed = String(repoUrl || "").trim();
  if (!trimmed) {
    throw new Error("repoUrl is required");
  }

  const parsed = parseGitRemoteUrl(trimmed);
  if (!parsed) {
    throw new Error(
      "Unsupported or invalid git URL. Use an https:// URL for github.com or a GitLab instance (including gitlab.com).",
    );
  }

  const token = options.token?.trim() || undefined;

  if (parsed.type === "github") {
    return listGitHubBranches(parsed.owner, parsed.repo, parsed.apiBase, token);
  }

  return listGitLabBranches(parsed.projectPath, parsed.apiBase, token);
}
