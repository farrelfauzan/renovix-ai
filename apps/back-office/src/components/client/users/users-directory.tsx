"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { PackagesApi } from "@/lib/packages/packages-api";
import { useReport } from "@/lib/usage/use-report";
import { toSearchFilter } from "@/lib/users/to-search-filter";
import type { UserListQuery } from "@/lib/users/user-list-query";
import type { UsersApi } from "@/lib/users/users-api";
import { SectionMessage } from "../usage/section-message";
import { UserDetailPanel } from "./user-detail-panel";
import { UsersFilters } from "./users-filters";
import { UsersPager } from "./users-pager";
import { UsersTable } from "./users-table";

const FIRST_PAGE = 1;

type UsersDirectoryProps = {
  readonly heading?: ReactNode;
  readonly api: UsersApi;
  readonly packagesApi: PackagesApi;
  /** Holds `packages:read`: the package filter lists the packages; without it the filter is not shown. */
  readonly canListPackages: boolean;
  /** Lacks `users:read_pii`: the banner says so (visibility only: the API masks and decides reveals). */
  readonly isMasked: boolean;
};

/**
 * The user list with its search and filters, one page (50) per request, and the detail of the user opened from it.
 * A search or a filter change goes back to page 1; nothing polls.
 */
export function UsersDirectory({ heading, api, packagesApi, canListPackages, isMasked }: UsersDirectoryProps) {
  const [query, setQuery] = useState<UserListQuery>({ page: FIRST_PAGE });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [packages, setPackages] = useState<readonly CatalogOffer[] | null>(null);
  const { data, error } = useReport(useCallback(() => api.listUsers(query), [api, query]));
  useEffect(() => {
    if (canListPackages) packagesApi.listOffers("package").then(setPackages, () => setPackages(null));
  }, [canListPackages, packagesApi]);
  const filter = (change: Partial<UserListQuery>) => setQuery((current) => ({ ...current, ...change, page: FIRST_PAGE }));
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rx-line pb-3">
        {heading}
        <UsersFilters
          packages={packages}
          packageId={query.packageId}
          status={query.status}
          onSearch={(text) => filter({ email: undefined, id: undefined, ...toSearchFilter(text) })}
          onFilter={filter}
        />
      </header>
      {isMasked && <p className="rounded-rx border border-rx-line bg-rx-surface px-3 py-2 font-mono text-xs text-rx-muted">Personal data masked for your role</p>}
      <section aria-label="User list" className="flex min-w-0 flex-col gap-3 rounded-rx border border-rx-line p-[18px] narrow:p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-rx-muted">{data ? `${data.pageSize} per page · newest sign-in first` : "Newest sign-in first"}</span>
          <span className="text-xs text-rx-muted">Email, phone and name are masked; a reveal is per field, with a reason.</span>
        </div>
        {error && <SectionMessage text={`Users could not be loaded: ${error}`} isError />}
        {!data && !error && <SectionMessage text="Loading users…" />}
        {data && data.items.length === 0 && <SectionMessage text="No users match." />}
        {data && data.items.length > 0 && <UsersTable items={data.items} selectedId={selectedId} onOpen={setSelectedId} />}
        {data && <UsersPager page={data.page} hasMore={data.hasMore} onPage={(page) => setQuery((current) => ({ ...current, page }))} />}
      </section>
      {selectedId && <UserDetailPanel key={selectedId} userId={selectedId} api={api} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
