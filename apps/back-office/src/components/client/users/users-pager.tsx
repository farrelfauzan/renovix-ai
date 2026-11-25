"use client";

import { Button } from "@performa-ai/ui/components/button";

type UsersPagerProps = {
  readonly page: number;
  /** The API's `hasMore`: a next page has users (there is no total). */
  readonly hasMore: boolean;
  readonly onPage: (page: number) => void;
};

const BUTTON = "rounded-rx border border-rx-line px-3 py-1 text-rx-text disabled:opacity-50 h-auto bg-transparent font-normal whitespace-normal";

/** Previous and Next over the API's pages of users. */
export function UsersPager({ page, hasMore, onPage }: UsersPagerProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-rx-muted">
      <span>Page {page}</span>
      <Button variant="outline" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BUTTON}>
        Previous
      </Button>
      <Button variant="outline" type="button" disabled={!hasMore} onClick={() => onPage(page + 1)} className={BUTTON}>
        Next
      </Button>
    </div>
  );
}
