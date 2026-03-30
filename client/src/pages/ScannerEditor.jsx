import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { useToast } from "../components/ToastContext";
import {
  CLOUD_REGIONS,
  CLOUD_SERVICES,
  DOCKER_REGISTRIES,
  SAST_TOOLS,
  SCANNER_TYPE_LABELS,
  SCANNER_TYPES,
} from "../scannerTypes";

function emptyForm(type) {
  return {
    name: "",
    type,
    secretId: "",
    sastPrivateRepo: false,
    repoUrl: "",
    branch: "main",
    sastTool: "semgrep",
    imageName: "",
    dockerRegistry: "dockerhub",
    isPrivate: false,
    region: "",
    selectedServices: [],
  };
}

function formFromScanner(d) {
  const type = d.type || "docker";
  const src = d.source || {};
  const dc = d.dockerConfig || {};
  const sc = d.sastConfig || {};
  const cc = d.cloudConfig || {};
  const allowedCloud = new Set((CLOUD_SERVICES[type] || []).map((o) => o.value));
  const selectedServices = Array.isArray(cc.services)
    ? cc.services.filter((s) => typeof s === "string" && allowedCloud.has(s))
    : [];
  return {
    name: d.name || "",
    type,
    secretId: d.secretId || "",
    sastPrivateRepo: type === "sast" ? Boolean(d.secretId) : false,
    repoUrl: src.repoUrl || "",
    branch: src.branch || "main",
    sastTool: sc.tool || "semgrep",
    imageName: dc.imageName || "",
    dockerRegistry: dc.registry || "dockerhub",
    isPrivate: Boolean(dc.isPrivate),
    region: cc.region || "",
    selectedServices,
  };
}

function buildPayload(form) {
  const base = {
    name: form.name.trim(),
    type: form.type,
  };

  if (form.type === "sast") {
    return {
      ...base,
      source: {
        repoUrl: form.repoUrl.trim(),
        branch: form.branch.trim() || "main",
      },
      dockerConfig: {},
      sastConfig: { tool: form.sastTool },
      cloudConfig: {},
      secretId: form.secretId || null,
    };
  }

  if (form.type === "docker") {
    const dockerConfig = {
      registry: form.dockerRegistry,
      isPrivate: form.isPrivate,
    };
    if (form.imageName.trim()) dockerConfig.imageName = form.imageName.trim();
    return {
      ...base,
      source: {},
      dockerConfig,
      sastConfig: {},
      cloudConfig: {},
      secretId: form.secretId || null,
    };
  }

  const services = Array.isArray(form.selectedServices) ? [...form.selectedServices] : [];
  const cloudConfig = {
    provider: form.type,
    services,
  };
  if (form.region.trim()) cloudConfig.region = form.region.trim();

  return {
    ...base,
    source: {},
    dockerConfig: {},
    sastConfig: {},
    cloudConfig,
    secretId: form.secretId || null,
  };
}

export function ScannerEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = !id;

  const [form, setForm] = useState(() => emptyForm("docker"));
  const type = form.type;
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [sastBranches, setSastBranches] = useState([]);
  const [sastBranchesLoading, setSastBranchesLoading] = useState(false);
  const [sastBranchesError, setSastBranchesError] = useState("");

  const toast = useToast();
  const gitSecrets = useMemo(() => secrets.filter((s) => s.type === "git"), [secrets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listSecrets({ limit: 100 });
        if (!cancelled) setSecrets(res.data || []);
      } catch {
        if (!cancelled) setSecrets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.getScanner(id);
        const d = res.data;
        if (cancelled) return;
        setForm(formFromScanner(d));
      } catch (err) {
        if (!cancelled) toast.error(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isCreate]);

  useEffect(() => {
    if (form.type !== "sast") return;
    setSastBranches([]);
    setSastBranchesError("");
  }, [form.type, form.repoUrl, form.secretId]);

  useEffect(() => {
    if (!isCreate) return;
    setForm((prev) => {
      const next = emptyForm(type);
      next.name = prev.name;
      next.secretId = prev.secretId;
      next.sastPrivateRepo = type === "sast" ? prev.sastPrivateRepo : false;
      return next;
    });
  }, [type, isCreate]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function onFetchSastBranches() {
    if (!form.repoUrl.trim()) {
      setSastBranchesError("Enter a repository URL first.");
      return;
    }
    if (form.sastPrivateRepo && !form.secretId) {
      setSastBranchesError("Select a git vault secret for private repositories.");
      return;
    }
    setSastBranchesError("");
    setSastBranchesLoading(true);
    try {
      const payload = { repoUrl: form.repoUrl.trim() };
      if (form.secretId) payload.secretId = form.secretId;
      const res = await api.listGitBranches({ ...payload, limit: 100 });
      const list = Array.isArray(res.data?.branches) ? res.data.branches : [];
      setSastBranches(list);
      if (list.length && !list.includes(form.branch)) {
        set("branch", list[0]);
      }
    } catch (err) {
      setSastBranchesError(err.message || "Could not load branches");
      setSastBranches([]);
    } finally {
      setSastBranchesLoading(false);
    }
  }

  const sastBranchOptions = useMemo(() => {
    if (!sastBranches.length) return [];
    const u = new Set(sastBranches);
    if (form.branch) u.add(form.branch);
    return [...u].sort((a, b) => a.localeCompare(b));
  }, [sastBranches, form.branch]);

  const isCloud = form.type === "aws" || form.type === "azure" || form.type === "gcp";
  const cloudServiceOptions = useMemo(() => CLOUD_SERVICES[form.type] || [], [form.type]);
  const cloudRegionOptions = useMemo(() => {
    const list = CLOUD_REGIONS[form.type] || [];
    if (!form.region) return list;
    if (list.some((o) => o.value === form.region)) return list;
    return [{ value: form.region, label: `${form.region} — (custom)` }, ...list];
  }, [form.type, form.region]);

  const clientError = useMemo(() => {
    if (!form.name.trim()) {
      return "Name is required.";
    }
    if (form.type === "sast" && !form.repoUrl.trim()) {
      return "Repository URL is required for SAST scanners.";
    }
    if (form.type === "sast" && form.sastPrivateRepo && !form.secretId) {
      return "Select a git vault secret for private repositories before listing branches.";
    }
    if (form.type === "docker" && form.isPrivate && !form.secretId) {
      return "Select a vault secret for private registry authentication.";
    }
    if (isCloud) {
      if (!form.region.trim()) {
        return "Select a region.";
      }
      if (!Array.isArray(form.selectedServices) || form.selectedServices.length === 0) {
        return "Select at least one service.";
      }
      if (!form.secretId) {
        return "Select a vault secret.";
      }
    }
    return "";
  }, [
    form.name,
    form.type,
    isCloud,
    form.repoUrl,
    form.isPrivate,
    form.secretId,
    form.sastPrivateRepo,
    form.selectedServices,
    form.region,
  ]);

  async function onSubmit(e) {
    e.preventDefault();
    if (clientError) {
      toast.warning(clientError);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (isCreate) {
        await api.createScanner(payload);
        toast.success("Scanner created.");
      } else {
        await api.updateScanner(id, payload);
        toast.success("Scanner saved.");
      }
      navigate(isCreate ? "/dashboard/scanners" : `/dashboard/scanners/${id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!isCreate && loading) {
    return <p className="muted">Loading scanner…</p>;
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h1 className="panel__title">{isCreate ? "New scanner" : "Edit scanner"}</h1>
        <Link to={isCreate ? "/dashboard/scanners" : `/dashboard/scanners/${id}`} className="btn btn--ghost">
          ← Back
        </Link>
      </div>
      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. prod-image-semgrep"
          />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={form.type} onChange={(e) => set("type", e.target.value)} disabled={!isCreate}>
            {SCANNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SCANNER_TYPE_LABELS[t] || t}
              </option>
            ))}
          </select>
        </label>
        {!isCreate ? (
          <p className="muted small">Type cannot be changed after create; add a new scanner to switch type.</p>
        ) : null}

        {form.type === "sast" ? (
          <>
            <label className="field">
              <span>Repository URL</span>
              <input
                value={form.repoUrl}
                onChange={(e) => set("repoUrl", e.target.value)}
                required
                placeholder="https://github.com/org/repo"
              />
            </label>
            <div className="field">
              <span>Private repository</span>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={form.sastPrivateRepo}
                  onChange={(e) => {
                    const v = e.target.checked;
                    set("sastPrivateRepo", v);
                    if (!v) set("secretId", "");
                  }}
                />
                <span className="muted">Requires a git token in the vault to list branches and scan</span>
              </label>
            </div>
            {form.sastPrivateRepo ? (
              <label className="field">
                <span>Vault secret (git — required)</span>
                <select value={form.secretId} onChange={(e) => set("secretId", e.target.value)} required={form.sastPrivateRepo}>
                  <option value="">— Select git token —</option>
                  {gitSecrets.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span>Vault secret (git — optional)</span>
                <select value={form.secretId} onChange={(e) => set("secretId", e.target.value)}>
                  <option value="">— None —</option>
                  {gitSecrets.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="muted small">Use a PAT if the host rate-limits or hides branch listing without auth.</span>
              </label>
            )}
            <div className="field">
              <span>Branches</span>
              <div className="form__actions sast-branch-fetch">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={
                    sastBranchesLoading ||
                    !form.repoUrl.trim() ||
                    (form.sastPrivateRepo && !form.secretId)
                  }
                  onClick={onFetchSastBranches}
                >
                  {sastBranchesLoading ? "Loading branches…" : "Fetch branches"}
                </button>
              </div>
              {sastBranchesError ? <p className="form-error">{sastBranchesError}</p> : null}
            </div>
            <label className="field">
              <span>Branch</span>
              {sastBranchOptions.length > 0 ? (
                <select value={form.branch} onChange={(e) => set("branch", e.target.value)}>
                  {sastBranchOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={form.branch} onChange={(e) => set("branch", e.target.value)} placeholder="main" />
              )}
              <span className="muted small">Fetch branches after setting the URL{form.sastPrivateRepo ? " and secret" : ""}, or type a branch name.</span>
            </label>
            <label className="field">
              <span>SAST tool</span>
              <select value={form.sastTool} onChange={(e) => set("sastTool", e.target.value)}>
                {SAST_TOOLS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {form.type === "docker" ? (
          <>
            <label className="field">
              <span>Image name</span>
              <input
                value={form.imageName}
                onChange={(e) => set("imageName", e.target.value)}
                placeholder="org/app:tag"
              />
            </label>
            <label className="field">
              <span>Registry</span>
              <select value={form.dockerRegistry} onChange={(e) => set("dockerRegistry", e.target.value)}>
                {DOCKER_REGISTRIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Private registry</span>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={form.isPrivate}
                  onChange={(e) => {
                    const v = e.target.checked;
                    set("isPrivate", v);
                    if (!v) set("secretId", "");
                  }}
                />
                <span className="muted">Requires vault secret</span>
              </label>
            </div>
          </>
        ) : null}

        {isCloud ? (
          <>
            <label className="field">
              <span>Region</span>
              <select value={form.region} onChange={(e) => set("region", e.target.value)}>
                <option value="">— Select region —</option>
                {cloudRegionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Services</span>
              <p className="muted small cloud-services-hint">
                Select one or more services for {SCANNER_TYPE_LABELS[form.type] || form.type}.
              </p>
              <div className="cloud-services-grid" role="group" aria-label="Cloud services">
                {cloudServiceOptions.map((opt) => (
                  <label key={opt.value} className="cloud-services-grid__item">
                    <input
                      type="checkbox"
                      checked={form.selectedServices.includes(opt.value)}
                      onChange={() => {
                        const id = opt.value;
                        setForm((f) => {
                          const has = f.selectedServices.includes(id);
                          const next = has
                            ? f.selectedServices.filter((s) => s !== id)
                            : [...f.selectedServices, id];
                          next.sort((a, b) => a.localeCompare(b));
                          return { ...f, selectedServices: next };
                        });
                      }}
                    />
                    <span className="cloud-services-grid__text">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {form.type === "sast"
          ? null
          : form.type !== "docker" || form.isPrivate ? (
              <label className="field">
                <span>
                  {form.type === "docker" && form.isPrivate
                    ? "Vault secret (required for private registry)"
                    : isCloud
                      ? "Vault secret (required)"
                      : "Vault secret (optional)"}
                </span>
                <select
                  value={form.secretId}
                  onChange={(e) => set("secretId", e.target.value)}
                >
                  <option value="">{isCloud ? "— Select vault secret —" : "— None —"}</option>
                  {secrets.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : isCreate ? "Create" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
