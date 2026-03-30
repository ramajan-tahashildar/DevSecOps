/**
 * @typedef {{
 *   page: number;
 *   limit: number;
 *   total: number;
 *   totalPages: number;
 *   hasNextPage: boolean;
 *   hasPrevPage: boolean;
 * }} ApiPagination
 */

/** Default page size for dashboard lists (scanners, secrets) when calling the API. */
export const DEFAULT_LIST_PAGE_SIZE = 10;

/**
 * Normalize pagination from an API JSON body `{ data, pagination }` or from a raw `pagination` object.
 * @param {unknown} bodyOrPagination Full list response or the `pagination` field alone.
 * @returns {ApiPagination | null}
 */
export function parsePaginationFromResponse(bodyOrPagination) {
  if (!bodyOrPagination || typeof bodyOrPagination !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (bodyOrPagination);
  const p =
    "pagination" in o && o.pagination != null && typeof o.pagination === "object"
      ? o.pagination
      : "page" in o && "total" in o
        ? bodyOrPagination
        : null;
  if (!p || typeof p !== "object") return null;

  const raw = /** @type {Record<string, unknown>} */ (p);
  const page = Number(raw.page);
  const limit = Number(raw.limit);
  const total = Number(raw.total);
  const totalPages = Number(raw.totalPages);

  if (!Number.isFinite(page) || !Number.isFinite(total) || total < 0) return null;

  const lim = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIST_PAGE_SIZE;
  const pages =
    Number.isFinite(totalPages) && totalPages >= 0
      ? totalPages
      : total === 0
        ? 0
        : Math.ceil(total / lim);

  const hasNext =
    typeof raw.hasNextPage === "boolean" ? raw.hasNextPage : page * lim < total;
  const hasPrev =
    typeof raw.hasPrevPage === "boolean" ? raw.hasPrevPage : page > 1 && total > 0;

  return {
    page,
    limit: lim,
    total,
    totalPages: pages,
    hasNextPage: hasNext,
    hasPrevPage: hasPrev,
  };
}

/**
 * @param {ApiPagination | null | undefined} pagination
 */
export function shouldRenderPagination(pagination) {
  return Boolean(pagination && pagination.total > 0);
}

/**
 * Clamp page after total pages shrink (e.g. after delete or filter).
 * @param {number} page
 * @param {ApiPagination | null} pagination
 */
export function clampPageToTotalPages(page, pagination) {
  if (!pagination || pagination.totalPages < 1) return 1;
  return Math.min(Math.max(1, page), pagination.totalPages);
}
