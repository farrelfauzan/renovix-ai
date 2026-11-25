import { Suspense } from "react";
import { CatalogSection } from "@/components/client/packages/catalog-section";
import { CodesSection } from "@/components/client/codes/codes-section";
import { CreditAdjustmentPanel } from "@/components/client/credits/credit-adjustment-panel";
import { PackagesAndCreditsTabs } from "@/components/client/packages/packages-and-credits-tabs";
import { SettingsScreen } from "@/components/client/settings/settings-screen";
import type { PackagesTabPanel } from "@/lib/packages/packages-tab-panel";

/** The tabs in display order (RNX-315); the ids are the `?tab=` values, and /settings redirects to "platform-settings". */
const PANELS: readonly PackagesTabPanel[] = [
  { id: "packages", label: "Packages", content: <CatalogSection kind="package" title="Packages" /> },
  { id: "top-ups", label: "Top-ups", content: <CatalogSection kind="top-up-pack" title="Top-up packs" /> },
  { id: "enterprise-bundles", label: "Enterprise bundles", content: <CatalogSection kind="enterprise-bundle" title="Enterprise bundles" /> },
  { id: "codes", label: "Codes", content: <CodesSection /> },
  { id: "credit-adjustment", label: "Credit adjustment", content: <CreditAdjustmentPanel /> },
  {
    id: "platform-settings",
    label: "Platform settings",
    content: (
      <section aria-label="Platform settings">
        <h2 className="rx-type-card-heading">Platform settings</h2>
        <SettingsScreen />
      </section>
    ),
  },
];

/**
 * The packages-and-credits page (RNX-98, RNX-99, RNX-315): packages, top-up packs, Enterprise bundles, invitation
 * codes, the credit adjustment panel and the platform settings (moved here from /settings), one tab at a time.
 */
export function PackagesAndCreditsSections() {
  return (
    <Suspense fallback={null}>
      <PackagesAndCreditsTabs
        heading={<h1 className="text-base font-semibold">Packages and credits</h1>}
        note={<p className="text-xs text-rx-muted">Public pricing reads this catalog live (D46). A price change creates a new version; earlier buyers keep their snapshot (D37).</p>}
        panels={PANELS}
      />
    </Suspense>
  );
}
