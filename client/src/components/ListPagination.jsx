import { shouldRenderPagination } from "../utils/pagination";

/**
 * Reusable prev / summary / next bar for any API list that returns `pagination`.
 *
 * @param {{
 *   pagination: import("../utils/pagination").ApiPagination | null | undefined;
 *   onPageChange: (page: number) => void;
 *   className?: string;
 *   ariaLabel?: string;
 *   prevLabel?: string;
 *   nextLabel?: string;
 *   formatSummary?: (p: import("../utils/pagination").ApiPagination) => string;
 * }} props
 */
export function ListPagination({
  pagination,
  onPageChange,
  className = "",
  ariaLabel = "Pagination",
  prevLabel = "Previous",
  nextLabel = "Next",
  formatSummary,
}) {
  if (!shouldRenderPagination(pagination)) return null;

  const p = /** @type {import("../utils/pagination").ApiPagination} */ (pagination);
  const summary =
    formatSummary?.(p) ?? `Page ${p.page} of ${p.totalPages} · ${p.total} total`;

  return (
    <nav className={`list-pagination${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={!p.hasPrevPage}
        onClick={() => onPageChange(p.page - 1)}
      >
        {prevLabel}
      </button>
      <span className="list-pagination__meta muted small">{summary}</span>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={!p.hasNextPage}
        onClick={() => onPageChange(p.page + 1)}
      >
        {nextLabel}
      </button>
    </nav>
  );
}
