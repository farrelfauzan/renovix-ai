"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@performa-ai/ui/components/tabs";
import type { UserDetail } from "@/lib/users/user-detail";
import { UserLedgerTable } from "./user-ledger-table";
import { UserOverview } from "./user-overview";

const TAB = "min-h-9 flex-none rounded-none border-b-2 border-transparent px-3 py-0 text-[13px] text-rx-muted data-[state=active]:border-rx-accent data-[state=active]:bg-transparent data-[state=active]:text-rx-accent data-[state=active]:shadow-none";

/** Overview and, when the API sent the ledger (the admin holds `credits:read`), Ledger. */
export function UserDetailTabs({ detail }: { readonly detail: UserDetail }) {
  return (
    <Tabs defaultValue="overview" className="min-w-0 gap-4">
      <TabsList aria-label="User sections" className="h-auto w-full max-w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-rx-line bg-transparent p-0">
        <TabsTrigger value="overview" className={TAB}>Overview</TabsTrigger>
        {detail.ledger && <TabsTrigger value="ledger" className={TAB}>Ledger</TabsTrigger>}
      </TabsList>
      <TabsContent value="overview" className="mt-0 min-w-0">
        <UserOverview detail={detail} />
      </TabsContent>
      {detail.ledger && (
        <TabsContent value="ledger" className="mt-0 min-w-0">
          <UserLedgerTable entries={detail.ledger} />
        </TabsContent>
      )}
    </Tabs>
  );
}
