"use client";

import type { PiiField } from "@/lib/users/pii-field";
import type { UserDetail } from "@/lib/users/user-detail";
import type { UsersApi } from "@/lib/users/users-api";
import { PiiFieldRow } from "./pii-field-row";

const FIELDS: readonly { readonly field: PiiField; readonly label: string }[] = [
  { field: "email", label: "Email" },
  { field: "phone", label: "Phone" },
  { field: "name", label: "Name" },
];

/** The user's email, phone and name, masked by the API, each with its own audited reveal. */
export function UserPersonalData({ detail, api }: { readonly detail: UserDetail; readonly api: UsersApi }) {
  return (
    <section aria-labelledby="user-personal-data-heading" className="flex min-w-0 flex-col gap-2.5 rounded-rx border border-rx-line bg-rx-surface p-3.5">
      <h3 id="user-personal-data-heading" className="text-[13px] font-semibold">Personal data</h3>
      <dl className="m-0 flex flex-col gap-3 text-[13px]">
        {FIELDS.map(({ field, label }) => (
          <PiiFieldRow key={field} userId={detail.id} field={field} label={label} masked={detail[field]} api={api} />
        ))}
      </dl>
      <p className="border-t border-rx-line pt-2.5 text-xs text-rx-muted">
        Each reveal needs a reason. Revealing needs users:read_pii, or a per-case grant for Support. The reveal and the reason are written to the audit log.
      </p>
    </section>
  );
}
