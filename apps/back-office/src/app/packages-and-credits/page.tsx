import { PackagesAndCreditsSections } from "@/components/server/packages/packages-and-credits-sections";

export default function PackagesAndCreditsPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Packages and credits</h1>
      <p className="mt-2 text-sm text-rx-muted">Public pricing reads this catalog live (D46). A price change creates a new version; earlier buyers keep their snapshot (D37).</p>
      <PackagesAndCreditsSections />
    </section>
  );
}
