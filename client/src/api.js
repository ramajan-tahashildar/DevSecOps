const base = () => (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const TOKEN_KEY = "devsecops_auth_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function api(path, options = {}) {
  const url = `${base()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { ...options.headers };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const body = await parseBody(res);

  if (!res.ok) {
    const msg =
      body?.error ||
      body?.message ||
      (Array.isArray(body?.errors) ? body.errors.join("; ") : null) ||
      res.statusText;
    const err = new Error(msg || "Request failed");
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const health = () => api("/health");
export const pingDb = () => api("/api/ping-db");

export const signup = (payload) =>
  api("/api/auth/signup", { method: "POST", body: JSON.stringify(payload) });

export const login = (payload) =>
  api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });

export const me = () => api("/api/auth/me");

export const listSecrets = (params = {}) => {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  const suffix = q.toString() ? `?${q}` : "";
  return api(`/api/secrets${suffix}`);
};
export const getSecret = (id) => api(`/api/secrets/${id}`);
export const createSecret = (payload) =>
  api("/api/secrets", { method: "POST", body: JSON.stringify(payload) });
export const updateSecret = (id, payload) =>
  api(`/api/secrets/${id}`, { method: "PUT", body: JSON.stringify(payload) });
export const deleteSecret = (id) => api(`/api/secrets/${id}`, { method: "DELETE" });

export const listScanners = (params = {}) => {
  const q = new URLSearchParams();
  if (params.type && !params.pathType) q.set("type", params.type);
  if (params.page != null) q.set("page", String(params.page));
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  const path =
    params.pathType && params.type
      ? `/api/scanners/type/${encodeURIComponent(params.type)}`
      : "/api/scanners";
  return api(`${path}${qs ? `?${qs}` : ""}`);
};
export const getScanner = (id) => api(`/api/scanners/${id}`);
export const createScanner = (payload) =>
  api("/api/scanners", { method: "POST", body: JSON.stringify(payload) });
export const updateScanner = (id, payload) =>
  api(`/api/scanners/${id}`, { method: "PUT", body: JSON.stringify(payload) });
export const deleteScanner = (id) => api(`/api/scanners/${id}`, { method: "DELETE" });

export const listScannerReports = (scannerId, params = {}) => {
  const q = new URLSearchParams();
  if (params.full) q.set("full", "true");
  if (params.page != null) q.set("page", String(params.page));
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  const suffix = q.toString() ? `?${q}` : "";
  return api(`/api/scanners/${scannerId}/reports${suffix}`);
};

/** SAST reports for a repo (paginated). */
export const listReportsByRepo = (params = {}) => {
  const q = new URLSearchParams();
  if (!params.repoUrl) throw new Error("repoUrl is required");
  q.set("repoUrl", params.repoUrl);
  if (params.full) q.set("full", "true");
  if (params.page != null) q.set("page", String(params.page));
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  return api(`/api/reports/by-repo?${q}`);
};

export const runScannerScan = (scannerId) =>
  api(`/api/scanners/${scannerId}/run`, { method: "POST", body: JSON.stringify({}) });

export const getScannerScanState = (scannerId) =>
  api(`/api/scanners/${scannerId}/scan-state`);

/** Remote branches for a SAST scanner (same as POST /git/branches but uses scanner repo + secret). */
export const listScannerBranches = (scannerId, params = {}) => {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.pageSize != null) q.set("pageSize", String(params.pageSize));
  const suffix = q.toString() ? `?${q}` : "";
  return api(`/api/scanners/${scannerId}/branches${suffix}`);
};

/** List remote branches for GitHub / GitLab HTTPS URLs. */
export const listGitBranches = (payload = {}) => {
  const body = { repoUrl: payload.repoUrl };
  if (payload.secretId) body.secretId = payload.secretId;
  const q = new URLSearchParams();
  if (payload.page != null) q.set("page", String(payload.page));
  if (payload.limit != null) q.set("limit", String(payload.limit));
  if (payload.pageSize != null) q.set("pageSize", String(payload.pageSize));
  const suffix = q.toString() ? `?${q}` : "";
  return api(`/api/git/branches${suffix}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};
