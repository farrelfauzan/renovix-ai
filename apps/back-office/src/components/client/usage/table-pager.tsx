"use client";

import { useState, type ReactNode } from "react";
import { TABLE_PAGE_SIZE } from "@/lib/usage/table-page-size";

type TablePagerProps<Row> = {
  readonly rows: readonly Row[];
  /** Renders the table for the rows of the current page. */
  readonly children: (pageRows: readonly Row[]) => ReactNode;
};

/** Shows `rows` TABLE_PAGE_SIZE at a time with Previous and Next; back on the first page whenever `rows` is a new array. */
export function TablePager<Row>({ rows, children }: TablePagerProps<Row>) {
  const [state, setState] = useState({ rows, page: 0 });
  const page = state.rows === rows ? state.page : 0;
  const first = page * TABLE_PAGE_SIZE;
  const last = Math.min(first + TABLE_PAGE_SIZE, rows.length);
  const goTo = (next: number) => setState({ rows, page: next });
  return (
    <div className="flex flex-col gap-2">
      {children(rows.slice(first, last))}
      <div className="flex flex-wrap items-center gap-3 text-sm text-rx-muted">
        <span>{rows.length === 0 ? "Rows 0 of 0" : `Rows ${first + 1}–${last} of ${rows.length}`}</span>
        <button type="button" disabled={page === 0} onClick={() => goTo(page - 1)} className="rounded-rx border border-rx-line px-3 py-1 text-rx-text disabled:opacity-50">
          Previous
        </button>
        <button type="button" disabled={last >= rows.length} onClick={() => goTo(page + 1)} className="rounded-rx border border-rx-line px-3 py-1 text-rx-text disabled:opacity-50">
          Next
        </button>
      </div>
    </div>
  );
}
