import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { SECRET_TYPE_LABELS } from "../secretTypes";

export function SecretsList() {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.listSecrets({ limit: 100 });
      setItems(res.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDelete(id, name) {
    const ok = await confirm({
      title: "Delete secret",
      message: `Delete secret “${name}”? This cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteSecret(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h1 className="panel__title">Secrets vault</h1>
        <Link to="/dashboard/secrets/new" className="btn btn--primary">
          + Add secret
        </Link>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}
      {!loading && !items.length ? (
        <pre className="empty-state mono">
{`┌─────────────────────────────────────┐
│  No secrets yet.                    │
│  Add AWS keys, Git tokens, Docker…  │
└─────────────────────────────────────┘`}
        </pre>
      ) : null}
      <ul className="secret-list">
        {items.map((row) => (
          <li key={row._id} className="secret-list__row">
            <div>
              <Link to={`/dashboard/secrets/${row._id}`} className="secret-list__name">
                {row.name}
              </Link>
              <div className="muted mono secret-list__meta">
                {SECRET_TYPE_LABELS[row.type] || row.type} · {new Date(row.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="secret-list__actions">
              <Link className="btn btn--small btn--ghost" to={`/dashboard/secrets/${row._id}`}>
                Open
              </Link>
              <button type="button" className="btn btn--small btn--danger" onClick={() => onDelete(row._id, row.name)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
