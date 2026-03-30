import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { useToast } from "../components/ToastContext";
import { SECRET_FIELD_MAP, SECRET_TYPE_LABELS } from "../secretTypes";

const TYPES = Object.keys(SECRET_FIELD_MAP);

function emptyCredentials(type) {
  const fields = SECRET_FIELD_MAP[type] || [];
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}

export function SecretEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = !id;

  const [name, setName] = useState("");
  const [type, setType] = useState("aws");
  const [credentials, setCredentials] = useState(() => emptyCredentials("aws"));
  const toast = useToast();
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.getSecret(id);
        const d = res.data;
        if (cancelled) return;
        setName(d.name);
        setType(d.type);
        setCredentials({ ...emptyCredentials(d.type), ...d.credentials });
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
    if (!isCreate) return;
    setCredentials((prev) => {
      const next = emptyCredentials(type);
      for (const k of Object.keys(next)) {
        if (prev[k] !== undefined) next[k] = prev[k];
      }
      return next;
    });
  }, [type, isCreate]);

  const fields = useMemo(() => SECRET_FIELD_MAP[type] || [], [type]);

  function setCred(key, value) {
    setCredentials((c) => ({ ...c, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: name.trim(), type, credentials };
      if (isCreate) {
        await api.createSecret(payload);
        toast.success("Secret created.");
      } else {
        await api.updateSecret(id, payload);
        toast.success("Secret saved.");
      }
      navigate("/dashboard/secrets");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!isCreate && loading) {
    return <p className="muted">Loading secret…</p>;
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h1 className="panel__title">{isCreate ? "New secret" : "Edit secret"}</h1>
        <Link to="/dashboard/secrets" className="btn btn--ghost">
          ← Back
        </Link>
      </div>
      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. prod-aws-scanner" />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!isCreate}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {SECRET_TYPE_LABELS[t] || t}
              </option>
            ))}
          </select>
        </label>
        {!isCreate ? (
          <p className="muted small">Type cannot be changed after create; rotate by adding a new secret.</p>
        ) : null}
        {fields.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            {f.type === "textarea" ? (
              <textarea
                rows={6}
                className="mono"
                value={credentials[f.key] || ""}
                onChange={(e) => setCred(f.key, e.target.value)}
                required
              />
            ) : (
              <input
                type={f.type === "password" ? "password" : "text"}
                value={credentials[f.key] || ""}
                onChange={(e) => setCred(f.key, e.target.value)}
                required
                autoComplete="off"
              />
            )}
          </label>
        ))}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : isCreate ? "Create" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
