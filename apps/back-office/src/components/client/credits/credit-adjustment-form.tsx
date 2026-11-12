"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import { Textarea } from "@performa-ai/ui/components/textarea";
import { buildCreditAdjustmentInput } from "@/lib/credits/build-credit-adjustment-input";
import type { CreditAdjustmentFields } from "@/lib/credits/credit-adjustment-fields";
import type { CreditAdjustmentInput } from "@/lib/credits/credit-adjustment-input";
import { EMPTY_ADJUSTMENT_FIELDS } from "@/lib/credits/empty-adjustment-fields";
import { LabeledInput } from "../form/labeled-input";

const TRIGGER = "w-full rounded-rx border-rx-line px-2 py-1 data-[size=default]:h-auto";

type CreditAdjustmentFormProps = {
  /** Sends the adjustment (asks for re-authentication first); answers the refusal text, or null when it was recorded. */
  readonly onSubmit: (input: CreditAdjustmentInput, idempotencyKey: string) => Promise<string | null>;
};

/**
 * The adjustment fields: target, direction, amount, reason and the optional references. One idempotency key
 * serves every attempt at the same fields (a retry never writes twice); editing a field starts a new one.
 */
export function CreditAdjustmentForm({ onSubmit }: CreditAdjustmentFormProps) {
  const [fields, setFields] = useState<CreditAdjustmentFields>(EMPTY_ADJUSTMENT_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const keyRef = useRef<string | null>(null);
  const set = <K extends keyof CreditAdjustmentFields>(key: K, value: CreditAdjustmentFields[K]) => {
    keyRef.current = null;
    setFields((held) => ({ ...held, [key]: value }));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = buildCreditAdjustmentInput(fields);
    if ("error" in built) return setError(built.error);
    keyRef.current ??= crypto.randomUUID();
    setError(null);
    setIsSending(true);
    const message = await onSubmit(built.input, keyRef.current);
    setIsSending(false);
    if (message === null) {
      keyRef.current = null;
      return setFields(EMPTY_ADJUSTMENT_FIELDS);
    }
    setError(message);
  };
  return (
    <form onSubmit={submit} aria-label="Credit adjustment" className="mt-4 flex max-w-xl flex-col gap-3 rounded-rx border border-rx-line p-4">
      <p className="text-sm text-rx-muted">Writes a ledger entry; never edits a balance directly. Needs credits:adjust and your password again.</p>
      <label className="flex flex-col gap-1 text-sm">
        Wallet of
        <Select name="targetKind" value={fields.targetKind} onValueChange={(value) => set("targetKind", value as CreditAdjustmentFields["targetKind"])}>
          <SelectTrigger className={TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">A user</SelectItem>
            <SelectItem value="company">A company</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <LabeledInput label="User or company id (exact)" name="targetId" isRequired maxLength={64} value={fields.targetId} onChange={(value) => set("targetId", value)} />
      <label className="flex flex-col gap-1 text-sm">
        Direction
        <Select name="direction" value={fields.direction} onValueChange={(value) => set("direction", value as CreditAdjustmentFields["direction"])}>
          <SelectTrigger className={TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add">Add</SelectItem>
            <SelectItem value="remove">Remove</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <LabeledInput label="Credits" name="amount" isRequired value={fields.amount} onChange={(value) => set("amount", value)} />
      <LabeledInput label="Ticket reference (optional)" name="ticketReference" maxLength={200} value={fields.ticketReference} onChange={(value) => set("ticketReference", value)} />
      <LabeledInput label="Payment reference (optional)" name="paymentReference" maxLength={200} value={fields.paymentReference} onChange={(value) => set("paymentReference", value)} />
      <label className="flex flex-col gap-1 text-sm">
        Reason (required, audited)
        <Textarea name="reason" required maxLength={500} value={fields.reason} onChange={(event) => set("reason", event.target.value)} className="min-h-0 rounded-rx border-rx-line px-2 py-1 text-sm field-sizing-fixed" />
      </label>
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div>
        <Button type="submit" disabled={isSending} className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent h-auto font-normal whitespace-normal">Adjust credits</Button>
      </div>
    </form>
  );
}
