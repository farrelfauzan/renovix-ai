import { Suspense } from "react";
import { AuditLogScreen } from "@/components/client/audit-log/audit-log-screen";

export default function AuditLogPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Audit log</h1>
      <Suspense fallback={null}>
        <AuditLogScreen />
      </Suspense>
    </section>
  );
}
