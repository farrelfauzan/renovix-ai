import { CatalogSection } from "@/components/client/packages/catalog-section";
import { CodesSection } from "@/components/client/codes/codes-section";

/**
 * The sections of the packages-and-credits page, stacked: packages, top-up packs, Enterprise bundles and
 * invitation codes. A later section (the credit adjustment panel, RNX-99) is one more line here.
 */
export function PackagesAndCreditsSections() {
  return (
    <>
      <CatalogSection kind="package" title="Packages" />
      <CatalogSection kind="top-up-pack" title="Top-up packs" />
      <CatalogSection kind="enterprise-bundle" title="Enterprise bundles" />
      <CodesSection />
    </>
  );
}
