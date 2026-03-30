import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../api";
import { ListPagination } from "../components/ListPagination";
import { SCANNER_TYPE_LABELS } from "../scannerTypes";
import { parsePaginationFromResponse, shouldRenderPagination } from "../utils/pagination";

const pendingScanKey = (scannerId) => `devsecops_scan_pending:${scannerId}`;

/** Rows per page for scanner timeline (reports + failed jobs). Must match server default when limit is omitted. */
const TIMELINE_PAGE_SIZE = 6;

/** Newest activity time for merged timeline rows (reports + persisted failed jobs). */
function timelineEntryTimeMs(entry) {
  if (!entry || typeof entry !== "object") return 0;
  if (entry.kind === "failed_job") {
    return new Date(entry.completedAt || entry.updatedAt || entry.createdAt || 0).getTime();
  }
  return new Date(entry.createdAt || 0).getTime();
}

/**
 * Session flag set when user clicks Generate; cleared when job/reports catch up or stale.
 * @param newestEntry Newest timeline item globally (page 1, limit 1), not the current page slice.
 */
function deriveClientPendingScan(scannerId, canRunScan, runningJob, newestEntry) {
  if (!scannerId || !canRunScan) return false;
  const raw = sessionStorage.getItem(pendingScanKey(scannerId));
  if (!raw) return false;
  const pendingAt = Number(raw);
  if (Number.isNaN(pendingAt)) {
    sessionStorage.removeItem(pendingScanKey(scannerId));
    return false;
  }
  if (runningJob) return true;
  const newestMs = timelineEntryTimeMs(newestEntry);
  if (newestMs && newestMs >= pendingAt - 15_000) {
    sessionStorage.removeItem(pendingScanKey(scannerId));
    return false;
  }
  if (Date.now() - pendingAt > 20 * 60 * 1000) {
    sessionStorage.removeItem(pendingScanKey(scannerId));
    return false;
  }
  return true;
}

function formatSummary(s) {
  if (!s || typeof s !== "object") return "—";
  const parts = ["total", "critical", "high", "medium", "low"]
    .map((k) => (typeof s[k] === "number" ? `${k[0].toUpperCase()}${k.slice(1)}: ${s[k]}` : null))
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function targetLabel(target) {
  if (!target || typeof target !== "object") return "—";
  if (target.imageName) return target.imageName;
  if (target.repoUrl) return target.repoUrl;
  if (target.provider && Array.isArray(target.services)) {
    const svcs = target.services.join(", ");
    return target.region ? `${target.provider} · ${target.region} · ${svcs}` : `${target.provider} · ${svcs}`;
  }
  try {
    return JSON.stringify(target);
  } catch {
    return "—";
  }
}

export function ScannerReports() {
  const { id } = useParams();
  const [scanner, setScanner] = useState(null);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [reportsError, setReportsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState(null);
  /** @type {null | { phase: 'processing', startedAt: number } | { phase: 'failed', message: string, startedAt: number }} */
  const [runRow, setRunRow] = useState(null);
  /** In-flight scan job on server (persists if user navigates away during POST /run). */
  const [serverRunningJob, setServerRunningJob] = useState(null);
  /** True while user started a scan (sessionStorage) until server job / new report / timeout. */
  const [clientPendingScan, setClientPendingScan] = useState(false);
  /** @type {{ page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPrevPage: boolean } | null} */
  const [pagination, setPagination] = useState(null);
  /** Newest timeline row (fetched as page 1 / limit 1) for pending-scan detection on any results page. */
  const [newestHint, setNewestHint] = useState(null);
  const reportsPageRef = useRef(1);

  const fetchTimeline = useCallback(
    async (page) => {
      const [fullRes, hintRes] = await Promise.all([
        api.listScannerReports(id, { full: true, page, limit: TIMELINE_PAGE_SIZE }),
        api.listScannerReports(id, { full: false, page: 1, limit: 1 }),
      ]);

      let pag = fullRes.pagination;
      let data = fullRes.data || [];
      let effectivePage = page;

      if (pag && pag.totalPages > 0 && page > pag.totalPages) {
        effectivePage = pag.totalPages;
        const retry = await api.listScannerReports(id, {
          full: true,
          page: effectivePage,
          limit: TIMELINE_PAGE_SIZE,
        });
        data = retry.data || [];
        pag = retry.pagination ?? pag;
      }

      reportsPageRef.current = effectivePage;

      setReports(data);
      setPagination(pag ? parsePaginationFromResponse(pag) ?? null : null);
      setNewestHint(hintRes.data?.[0] ?? null);
      setReportsError("");
      return { hint: hintRes.data?.[0] ?? null, pagination: pag };
    },
    [id],
  );

  const refreshReports = useCallback(async () => {
    try {
      await fetchTimeline(reportsPageRef.current);
    } catch (err) {
      setReportsError(err.message);
    }
  }, [fetchTimeline]);

  const fetchScanState = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.getScannerScanState(id);
      const next = res.data?.runningJob ?? null;
      setServerRunningJob((prev) => {
        if (prev && !next) {
          queueMicrotask(() => refreshReports());
        }
        return next;
      });
    } catch {
      // Do not clear serverRunningJob — transient errors should not hide an active scan.
    }
  }, [id, refreshReports]);

  const load = useCallback(async () => {
    setError("");
    setReportsError("");
    setRunRow(null);
    setServerRunningJob(null);
    setLoading(true);
    setScanner(null);
    setReports([]);
    setPagination(null);
    reportsPageRef.current = 1;
    let scannerData = null;
    let hintForPending = null;
    let runningSnapshot = null;
    try {
      const sRes = await api.getScanner(id);
      scannerData = sRes.data;
      setScanner(scannerData);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    try {
      const { hint } = await fetchTimeline(1);
      hintForPending = hint;
    } catch (err) {
      setReportsError(err.message);
    }
    try {
      const st = await api.getScannerScanState(id);
      runningSnapshot = st.data?.runningJob ?? null;
      setServerRunningJob((prev) => {
        if (prev && !runningSnapshot) {
          queueMicrotask(() => refreshReports());
        }
        return runningSnapshot;
      });
    } catch {
      /* keep null; deriveClientPendingScan still uses sessionStorage */
    }
    const canRun =
      scannerData?.type === "docker" ||
      scannerData?.type === "sast" ||
      scannerData?.type === "aws";
    setClientPendingScan(deriveClientPendingScan(id, canRun, runningSnapshot, hintForPending));
    setLoading(false);
  }, [id, refreshReports, fetchTimeline]);

  useEffect(() => {
    load();
  }, [load]);

  async function onGenerateReport() {
    setBanner(null);
    sessionStorage.setItem(pendingScanKey(id), String(Date.now()));
    setClientPendingScan(true);
    setRunRow({ phase: "processing", startedAt: Date.now() });
    setRunning(true);
    try {
      const res = await api.runScannerScan(id);
      sessionStorage.removeItem(pendingScanKey(id));
      setClientPendingScan(false);
      setRunRow(null);
      setBanner({
        type: "success",
        text: res.message || "Scan completed",
      });
      reportsPageRef.current = 1;
      await fetchTimeline(1);
    } catch (err) {
      sessionStorage.removeItem(pendingScanKey(id));
      setClientPendingScan(false);
      if (err.status != null) {
        reportsPageRef.current = 1;
        await fetchTimeline(1);
        setRunRow(null);
      } else {
        setRunRow({
          phase: "failed",
          message: err.message || "Scan failed",
          startedAt: Date.now(),
        });
      }
    } finally {
      setRunning(false);
      await fetchScanState();
    }
  }

  function dismissFailedRow() {
    setRunRow(null);
  }

  const canRunScan =
    scanner?.type === "docker" || scanner?.type === "sast" || scanner?.type === "aws";

  /** Reconcile sessionStorage pending when poll updates job or newest timeline row. */
  useEffect(() => {
    if (!id || loading) return;
    setClientPendingScan(deriveClientPendingScan(id, canRunScan, serverRunningJob, newestHint));
  }, [id, loading, canRunScan, serverRunningJob, newestHint]);

  async function goToTimelinePage(nextPage) {
    if (nextPage < 1) return;
    reportsPageRef.current = nextPage;
    try {
      await fetchTimeline(nextPage);
    } catch (err) {
      setReportsError(err.message);
    }
  }

  const showProcessing =
    runRow?.phase === "processing" ||
    Boolean(serverRunningJob) ||
    clientPendingScan;
  const scanBusy = Boolean(serverRunningJob) || running || clientPendingScan;

  useEffect(() => {
    if (!canRunScan || !id || loading) return;
    if (!scanBusy && runRow?.phase !== "processing") return;
    fetchScanState();
    const t = setInterval(fetchScanState, 3500);
    return () => clearInterval(t);
  }, [canRunScan, id, loading, scanBusy, runRow?.phase, fetchScanState]);

  if (loading) {
    return <p className="muted">Loading scanner…</p>;
  }

  if (error && !scanner) {
    return (
      <div className="panel">
        <div className="panel__head">
          <h1 className="panel__title">Scanner</h1>
          <Link to="/dashboard/scanners" className="btn btn--ghost">
            ← Back
          </Link>
        </div>
        <p className="form-error">{error}</p>
      </div>
    );
  }

  const pagedTimeline = shouldRenderPagination(pagination);

  return (
    <div
      className={`panel scanner-reports-panel${pagedTimeline ? " panel--list-pager-fill" : ""}`}
    >
      <div className="panel__head panel__head--split">
        <div className="panel__head-start">
          <Link to="/dashboard/scanners" className="btn btn--ghost btn--small">
            ← Scanners
          </Link>
          <h1 className="panel__title">
            {scanner?.name || "Scanner"}
            <span className="panel__title-sub muted">
              {" "}
              · {SCANNER_TYPE_LABELS[scanner?.type] || scanner?.type || "—"}
            </span>
          </h1>
        </div>
        <div className="panel__head-actions">
          <Link to={`/dashboard/scanners/${id}/edit`} className="btn btn--ghost btn--small">
            Edit
          </Link>
          <button
            type="button"
            className="btn btn--primary btn--small"
            disabled={scanBusy || !canRunScan}
            onClick={onGenerateReport}
            title={
              !canRunScan
                ? "Generate report is available for container, SAST (repository), and AWS cloud scanners only."
                : undefined
            }
          >
            {scanBusy ? "Running…" : "Generate report"}
          </button>
        </div>
      </div>

      {!canRunScan ? (
        <p className="muted small scanner-reports__hint">
          Run scan / report generation is not supported for this scanner type yet. You can still browse past reports if
          any exist.
        </p>
      ) : null}

      {banner ? (
        <p className={banner.type === "success" ? "scanner-banner scanner-banner--ok" : "scanner-banner scanner-banner--err"}>
          {banner.text}
        </p>
      ) : null}
      {reportsError ? <p className="form-error">{reportsError}</p> : null}

      <div className={`list-pager-stack${pagedTimeline ? " list-pager-stack--fill" : ""}`}>
        <h2 className="scanner-reports__heading">Reports</h2>
        <div className="list-pager-stack__scroll">
          {!reports.length &&
          !showProcessing &&
          runRow?.phase !== "failed" &&
          (!pagination || pagination.total === 0) ? (
            <p className="muted empty-state">
              No reports yet. {canRunScan ? "Use Generate report to run a scan." : ""}
            </p>
          ) : (
            <ul className="secret-list scanner-reports__list">
              {showProcessing ? (
                <li className="secret-list__row scanner-report-row scanner-report-row--processing">
                  <div className="scanner-report-row__main">
                    <div className="scanner-report-row__status">
                      <span className="scanner-report-row__pulse" aria-hidden />
                      <span className="secret-list__name">Processing scan…</span>
                    </div>
                    <div className="muted mono secret-list__meta">
                      Generating report — this can take a while. You can leave and come back; this row stays until the
                      scan finishes.
                      {serverRunningJob?.startedAt ? (
                        <>
                          {" "}
                          Server job started {new Date(serverRunningJob.startedAt).toLocaleString()}.
                        </>
                      ) : clientPendingScan ? (
                        <> Waiting for server job or reconnecting to scan status…</>
                      ) : null}
                    </div>
                  </div>
                </li>
              ) : null}
              {runRow?.phase === "failed" ? (
                <li className="secret-list__row scanner-report-row scanner-report-row--failed">
                  <div className="scanner-report-row__main">
                    <div className="scanner-report-row__status">
                      <span className="secret-list__name scanner-report-row__failed-title">Scan failed</span>
                    </div>
                    <div className="muted mono secret-list__meta scanner-report-row__failed-msg">{runRow.message}</div>
                    <div className="scanner-report-row__failed-actions">
                      <button type="button" className="btn btn--ghost btn--small" onClick={dismissFailedRow}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </li>
              ) : null}
              {reports.map((r) =>
                r.kind === "failed_job" ? (
                  <li key={`job-${r._id}`} className="secret-list__row scanner-report-row scanner-report-row--failed">
                    <div className="scanner-report-row__main">
                      <div className="scanner-report-row__status">
                        <span className="secret-list__name scanner-report-row__failed-title">Scan failed</span>
                      </div>
                      <div className="muted mono small">
                        {new Date(r.completedAt || r.createdAt).toLocaleString()}
                      </div>
                      <div className="muted mono secret-list__meta scanner-report-row__failed-msg">{r.error}</div>
                    </div>
                  </li>
                ) : (
                  <li key={r._id} className="secret-list__row scanner-report-row">
                    <div className="scanner-report-row__main">
                      <div className="secret-list__name mono">{new Date(r.createdAt).toLocaleString()}</div>
                      <div className="muted mono secret-list__meta">
                        {targetLabel(r.target)} · {formatSummary(r.summary)}
                        {Array.isArray(r.vulnerabilities) ? ` · ${r.vulnerabilities.length} finding(s)` : null}
                      </div>
                      <details className="scanner-report-row__details">
                        <summary className="muted small">Raw report</summary>
                        <pre className="scanner-report-row__pre mono">{JSON.stringify(r, null, 2)}</pre>
                      </details>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        <ListPagination
          pagination={pagination}
          onPageChange={goToTimelinePage}
          ariaLabel="Report pages"
        />
      </div>
    </div>
  );
}
