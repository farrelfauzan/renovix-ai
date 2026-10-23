import { CatalogSection } from "@/components/client/packages/catalog-section";
import { CodesSection } from "@/components/client/codes/codes-section";
import { CreditAdjustmentPanel } from "@/components/client/credits/credit-adjustment-panel";

/**
 * The sections of the packages-and-credits page, stacked: packages, top-up packs, Enterprise bundles and
 * invitation codes and the credit adjustment panel (RNX-99).
 */
export function PackagesAndCreditsSections() {
  return (
    <>
      <CatalogSection kind="package" title="Packages" />
      <CatalogSection kind="top-up-pack" title="Top-up packs" />
      <CatalogSection kind="enterprise-bundle" title="Enterprise bundles" />
      <CodesSection />
      <CreditAdjustmentPanel />
    </>
  );
}
