import { UsageAndCostScreen } from "@/components/client/usage/usage-and-cost-screen";

export default function UsageAndCostPage() {
  return (
    <section className="w-0 min-w-full">
      <UsageAndCostScreen heading={<h1 className="text-base font-semibold">Usage and cost</h1>} />
    </section>
  );
}
