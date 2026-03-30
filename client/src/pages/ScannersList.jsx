import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { ListPagination } from "../components/ListPagination";
import { useConfirm } from "../components/ConfirmDialog";
import { SCANNER_TYPE_LABELS, SCANNER_TYPES } from "../scannerTypes";
import {
  DEFAULT_LIST_PAGE_SIZE,
  clampPageToTotalPages,
  parsePaginationFromResponse,
  shouldRenderPagination,
} from "../utils/pagination";

export function ScannersList() {
  const confirm = useConfirm();
  const [filterType, setFilterType] = useState(null);
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
      const params = {
        page,
        limit: DEFAULT_LIST_PAGE_SIZE,
        ...(filterType ? { type: filterType } : {}),
      };
      const res = await api.listScanners(params);
      setItems(res.data || []);
      const pag = parsePaginationFromResponse(res);
      setPagination(pag);
      const clamped = clampPageToTotalPages(page, pag);
      if (pag && clamped !== page) {
        setPage(clamped);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterType, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDelete(id, name) {
    const ok = await confirm({
      title: "Delete scanner",
      message: `Delete scanner “${name}”? This cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteScanner(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const emptyMessage = filterType
    ? `No ${SCANNER_TYPE_LABELS[filterType] || filterType} scanners yet.`
    : null;

  const showPager = shouldRenderPagination(pagination);

  return (
    <div className="scanners-page">
      <aside className="scanners-page__types" aria-label="Filter by scan type">
        <h2 className="scanners-page__types-title">Scan type</h2>
        <ul className="scanner-type-list">
          <li>
            <button
              type="button"
              className={`scanner-type-list__item${filterType === null ? " scanner-type-list__item--active" : ""}`}
              onClick={() => {
                setFilterType(null);
                setPage(1);
              }}
            >
              All types
            </button>
          </li>
          {SCANNER_TYPES.map((t) => (
            <li key={t}>
              <button
                type="button"
                className={`scanner-type-list__item${filterType === t ? " scanner-type-list__item--active" : ""}`}
                onClick={() => {
                  setFilterType(t);
                  setPage(1);
                }}
              >
                {SCANNER_TYPE_LABELS[t] || t}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className={`scanners-page__main panel${showPager ? " panel--list-pager-fill" : ""}`}>
        <div className="panel__head">
          <h1 className="panel__title">
            Scanners
            {filterType ? (
              <span className="panel__title-sub muted"> · {SCANNER_TYPE_LABELS[filterType] || filterType}</span>
            ) : null}
          </h1>
          <Link to="/dashboard/scanners/new" className="btn btn--primary">
            + Add scanner
          </Link>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className={`list-pager-stack${showPager ? " list-pager-stack--fill" : ""}`}>
          <div className="list-pager-stack__scroll">
            {loading ? <p className="muted">Loading…</p> : null}
            {!loading && !items.length ? (
              filterType ? (
                <p className="muted empty-state">{emptyMessage}</p>
              ) : (
                <pre className="empty-state mono">
{`┌─────────────────────────────────────┐
│  No scanners yet.                   │
│  Add Docker, SAST, or cloud scans.  │
└─────────────────────────────────────┘`}
                </pre>
              )
            ) : null}
            {!loading && items.length ? (
              <ul className="secret-list">
                {items.map((row) => (
                  <li key={row._id} className="secret-list__row">
                    <div>
                      <Link to={`/dashboard/scanners/${row._id}`} className="secret-list__name">
                        {row.name}
                      </Link>
                      <div className="muted mono secret-list__meta">
                        {SCANNER_TYPE_LABELS[row.type] || row.type} · {new Date(row.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="secret-list__actions">
                      <Link className="btn btn--small btn--ghost" to={`/dashboard/scanners/${row._id}`}>
                        Open
                      </Link>
                      <Link className="btn btn--small btn--ghost" to={`/dashboard/scanners/${row._id}/edit`}>
                        Edit
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
          <ListPagination pagination={pagination} onPageChange={setPage} ariaLabel="Scanner list pages" />
        </div>
      </div>
    </div>
  );
}
