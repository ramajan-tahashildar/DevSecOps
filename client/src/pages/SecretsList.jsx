import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { ListPagination } from "../components/ListPagination";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastContext";
import { SECRET_TYPE_LABELS } from "../secretTypes";
import {
  DEFAULT_LIST_PAGE_SIZE,
  clampPageToTotalPages,
  parsePaginationFromResponse,
  shouldRenderPagination,
} from "../utils/pagination";

export function SecretsList() {
  const confirm = useConfirm();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  /** @type {import("../utils/pagination").ApiPagination | null} */
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.listSecrets({ page, limit: DEFAULT_LIST_PAGE_SIZE });
      setItems(res.data || []);
      const pag = parsePaginationFromResponse(res);
      setPagination(pag);
      const clamped = clampPageToTotalPages(page, pag);
      if (pag && clamped !== page) {
        setPage(clamped);
      }
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const showPager = shouldRenderPagination(pagination);

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
      toast.success("Secret deleted.");
      await load();
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    }
  }

  return (
    <div className={`panel${showPager ? " panel--list-pager-fill" : ""}`}>
      <div className="panel__head">
        <h1 className="panel__title">Secrets vault</h1>
        <Link to="/dashboard/secrets/new" className="btn btn--primary">
          + Add secret
        </Link>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className={`list-pager-stack${showPager ? " list-pager-stack--fill" : ""}`}>
        <div className="list-pager-stack__scroll">
          {loading ? <p className="muted">Loading…</p> : null}
          {!loading && !items.length ? (
            <pre className="empty-state mono">
{`┌─────────────────────────────────────┐
│  No secrets yet.                    │
│  Add AWS keys, Git tokens, Docker…  │
└─────────────────────────────────────┘`}
            </pre>
          ) : null}
          {!loading && items.length ? (
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
          ) : null}
        </div>
        <ListPagination pagination={pagination} onPageChange={setPage} ariaLabel="Secrets list pages" />
      </div>
    </div>
  );
}
