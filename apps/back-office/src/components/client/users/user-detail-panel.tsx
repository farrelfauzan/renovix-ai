"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { useReport } from "@/lib/usage/use-report";
import type { UsersApi } from "@/lib/users/users-api";
import { SectionMessage } from "../usage/section-message";
import { UserDetailTabs } from "./user-detail-tabs";
import { UserPersonalData } from "./user-personal-data";
import { formatDateTime } from "@/lib/users/format-date-time";

type UserDetailPanelProps = {
  readonly userId: string;
  readonly api: UsersApi;
  readonly onClose: () => void;
};

/**
 * The detail of one user, loaded once when it opens (mount it with `key={userId}` so another user starts afresh and
 * nothing revealed carries over). Its heading takes the focus, which also scrolls it into view on a phone.
 */
export function UserDetailPanel({ userId, api, onClose }: UserDetailPanelProps) {
  const { data, error } = useReport(useCallback(() => api.getUser(userId), [api, userId]));
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <section aria-labelledby="user-detail-heading" className="flex min-w-0 flex-col gap-4 rounded-rx border border-rx-line p-[18px] narrow:p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="user-detail-heading" ref={headingRef} tabIndex={-1} className="break-all text-lg font-semibold outline-none">
            User <span className="font-mono">{userId}</span>
          </h2>
          {data && (
            <span className="text-[13px] text-rx-muted">
              joined {formatDateTime(data.joinedAt)} · timezone {data.timezone ?? "not set"} · language {data.language ?? "not set"}
            </span>
          )}
        </div>
        <Button variant="outline" type="button" onClick={onClose} className="h-9 rounded-rx border-rx-line bg-transparent px-3.5 text-[13px] font-medium">
          Close
        </Button>
      </div>
      {error && <SectionMessage text={`The user could not be loaded: ${error}`} isError />}
      {!data && !error && <SectionMessage text="Loading the user…" />}
      {data && (
        <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <UserPersonalData detail={data} api={api} />
          <UserDetailTabs detail={data} />
        </div>
      )}
    </section>
  );
}
