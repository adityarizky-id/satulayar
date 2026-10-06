"use client";

/**
 * One pagination control for every long list in the dashboard.
 *
 * It reports the slice in items, not just pages: "31–45 of 214" tells a reader
 * how much is left, which "page 3 of 15" does not. The label is what makes it
 * safe to hide rows behind a page at all.
 */
export function Pagination({
  page,
  pageCount,
  totalItems,
  pageSize,
  itemNoun,
  onChange,
  disabled = false,
}: {
  page: number;
  pageCount: number;
  totalItems: number;
  pageSize: number;
  /** Singular noun, e.g. "keyword". Pluralised with a trailing s. */
  itemNoun: string;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (pageCount <= 1) return null;

  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalItems);

  return (
    <nav aria-label={`${itemNoun} pagination`} className="pagination">
      <button
        className="button button--secondary"
        disabled={disabled || page === 0}
        onClick={() => onChange(Math.max(0, page - 1))}
        type="button"
      >
        Previous
      </button>
      <span aria-live="polite">
        {first}–{last} of {totalItems} {itemNoun}
        {totalItems === 1 ? "" : "s"}
      </span>
      <button
        className="button button--secondary"
        disabled={disabled || page >= pageCount - 1}
        onClick={() => onChange(Math.min(pageCount - 1, page + 1))}
        type="button"
      >
        Next
      </button>
    </nav>
  );
}

/** Slices a list and keeps the page inside range when the list shrinks. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { rows: T[]; safePage: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  return {
    rows: items.slice(safePage * pageSize, safePage * pageSize + pageSize),
    safePage,
    pageCount,
  };
}
