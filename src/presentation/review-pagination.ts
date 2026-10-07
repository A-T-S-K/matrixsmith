/** Fixed presentation limit; evidence and report/export collections stay complete. */
export const REVIEW_PAGE_SIZE = 50;
export function pageWindow(length: number, requested: number) {
  const pages = Math.max(1, Math.ceil(length / REVIEW_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Math.trunc(requested) || 0));
  const start = page * REVIEW_PAGE_SIZE;
  return {
    page,
    pages,
    start,
    end: Math.min(length, start + REVIEW_PAGE_SIZE),
  };
}
