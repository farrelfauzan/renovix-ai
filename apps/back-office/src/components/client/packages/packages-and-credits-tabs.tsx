"use client";

import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@performa-ai/ui/components/tabs";
import type { PackagesTabPanel } from "@/lib/packages/packages-tab-panel";

/** The search parameter that names the selected tab, so a reload keeps it and a link (/settings) can open one. */
const TAB_PARAMETER = "tab";

type PackagesAndCreditsTabsProps = {
  readonly heading: ReactNode;
  readonly note: ReactNode;
  /** In display order; the first is selected when the URL names no tab or an unknown one. */
  readonly panels: readonly PackagesTabPanel[];
};

/**
 * The packages-and-credits page in the design canvas's layout (RNX-315): the heading with the tabs, the page note,
 * and the selected tab's section in a card. The selected tab lives in `?tab=` (kept on reload, followed when a
 * link changes it). Only the selected section is mounted, so each one loads its data when its tab opens; each
 * section keeps its own permission checks (visibility only: the API enforces them).
 */
export function PackagesAndCreditsTabs({ heading, note, panels }: PackagesAndCreditsTabsProps) {
  const requested = useSearchParams().get(TAB_PARAMETER);
  const resolve = (id: string | null): string => panels.find((panel) => panel.id === id)?.id ?? panels[0].id;
  const [selected, setSelected] = useState(() => resolve(requested));
  const [seenRequested, setSeenRequested] = useState(requested);
  if (requested !== seenRequested) {
    setSeenRequested(requested);
    setSelected(resolve(requested));
  }
  const select = (id: string) => {
    setSelected(id);
    window.history.replaceState(null, "", `?${new URLSearchParams({ [TAB_PARAMETER]: id })}`);
  };
  return (
    <Tabs value={selected} onValueChange={select} className="gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rx-line pb-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3.5">
          {heading}
          <TabsList aria-label="Sections" className="h-auto w-auto max-w-full justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent p-0">
            {panels.map((panel) => (
              <TabsTrigger key={panel.id} value={panel.id} className="min-h-9 flex-none rounded-none border-b-2 border-transparent px-3 py-0 text-[13px] text-rx-muted data-[state=active]:border-rx-accent data-[state=active]:bg-transparent data-[state=active]:text-rx-accent data-[state=active]:shadow-none">
                {panel.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {note}
      </header>
      {panels.map((panel) => (
        <TabsContent key={panel.id} value={panel.id} className="mt-0 min-w-0 rounded-rx border border-rx-line p-[18px] narrow:p-3.5">
          {panel.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
