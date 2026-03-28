/** Default page size for all list APIs */
export const DEFAULT_PAGE_SIZE = 10;

/** Upper bound for `limit` query param */
export const MAX_PAGE_SIZE = 100;

/**
 * @param {string | string[] | undefined} raw
 */
function firstQueryValue(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) {
    const v = raw[0];
    return v === undefined || v === null ? undefined : String(v);
  }
  return String(raw);
}

/**
 * @param {import("express").Request["query"]} query
 * @returns {{ page: number; limit: number; skip: number }}
 */
export function parsePaginationQuery(query) {
  const pageStr = firstQueryValue(query.page);
  const limitStr = firstQueryValue(query.limit ?? query.pageSize);

  let page = parseInt(pageStr ?? "1", 10);
  if (!Number.isFinite(page) || page < 1) {
    page = 1;
  }

  let limit = parseInt(limitStr ?? String(DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(limit) || limit < 1) {
    limit = DEFAULT_PAGE_SIZE;
  }
  limit = Math.min(limit, MAX_PAGE_SIZE);

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * @param {{ total: number; page: number; limit: number }}
 */
export function paginationMeta({ total, page, limit }) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1 && total > 0,
  };
}
