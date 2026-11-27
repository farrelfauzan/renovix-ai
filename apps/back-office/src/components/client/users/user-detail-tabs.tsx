"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@performa-ai/ui/components/tabs";
import type { UserDetail } from "@/lib/users/user-detail";
import type { UsersApi } from "@/lib/users/users-api";
import { UserLedgerTable } from "./user-ledger-table";
import { UserOverview } from "./user-overview";
import { UserSessionsPanel } from "./user-sessions-panel";

const TAB = "min-h-9 flex-none rounded-none border-b-2 border-transparent px-3 py-0 text-[13px] text-rx-muted data-[state=active]:border-rx-accent data-[state=active]:bg-transparent data-[state=active]:text-rx-accent data-[state=active]:shadow-none";

type UserDetailTabsProps = {
  readonly detail: UserDetail;
  readonly api: UsersApi;
  /** Holds `users:write`: the Sessions tab offers Revoke and Revoke all (RNX-100). */
  readonly canWriteUsers: boolean;
};

/** Overview; Ledger when the API sent the ledger (the admin holds `credits:read`); and Sessions (RNX-100), read when opened. */
export function UserDetailTabs({ detail, api, canWriteUsers }: UserDetailTabsProps) {
  return (
    <Tabs defaultValue="overview" className="min-w-0 gap-4">
      <TabsList aria-label="User sections" className="h-auto w-full max-w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-rx-line bg-transparent p-0">
        <TabsTrigger value="overview" className={TAB}>Overview</TabsTrigger>
        {detail.ledger && <TabsTrigger value="ledger" className={TAB}>Ledger</TabsTrigger>}
        <TabsTrigger value="sessions" className={TAB}>Sessions</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-0 min-w-0">
        <UserOverview detail={detail} />
      </TabsContent>
      {detail.ledger && (
        <TabsContent value="ledger" className="mt-0 min-w-0">
          <UserLedgerTable entries={detail.ledger} />
        </TabsContent>
      )}
      <TabsContent value="sessions" className="mt-0 min-w-0">
        <UserSessionsPanel userId={detail.id} api={api} canWrite={canWriteUsers} />
      </TabsContent>
    </Tabs>
  );
}
