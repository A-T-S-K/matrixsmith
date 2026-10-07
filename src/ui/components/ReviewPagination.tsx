import type { JSX } from "preact";
import type { pageWindow } from "../../presentation/review-pagination";
export function ReviewPagination({
  window: w,
  label,
  onPage,
}: {
  window: ReturnType<typeof pageWindow>;
  label: string;
  onPage(page: number): void;
}): JSX.Element {
  return (
    <nav class="review-pagination" aria-label={`${label} pagination`}>
      <span>
        {w.end === 0 ? "0" : `${w.start + 1}–${w.end}`} · Page {w.page + 1} of{" "}
        {w.pages}
      </span>
      <button disabled={w.page === 0} onClick={() => onPage(w.page - 1)}>
        Previous
      </button>
      <button
        disabled={w.page + 1 === w.pages}
        onClick={() => onPage(w.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
