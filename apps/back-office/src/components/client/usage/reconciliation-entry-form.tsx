"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import type { ProviderOption } from "@/lib/usage/provider-option";
import type { UsageApi } from "@/lib/usage/usage-api";
import { SectionMessage } from "./section-message";

type ReconciliationEntryFormProps = {
  readonly api: UsageApi;
  /** The provider records to pick; null when the admin cannot list them, then the record id is typed. */
  readonly providers: readonly ProviderOption[] | null;
  readonly onRecorded: () => void;
};

const FIELD = "rounded-rx border border-rx-line px-2 py-1 text-rx-text h-auto text-sm";

/** The provider's portal balance and top-up of a day, in USD (`reconciliation:write`; the API audits it). */
export function ReconciliationEntryForm({ api, providers, onRecorded }: ReconciliationEntryFormProps) {
  const [providerId, setProviderId] = useState("");
  const [day, setDay] = useState("");
  const [portalBalanceUsd, setPortalBalanceUsd] = useState("");
  const [topUpUsd, setTopUpUsd] = useState("");
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const saved = await api.recordEntry({ providerId, day, portalBalanceUsd, ...(topUpUsd ? { topUpUsd } : {}) });
      setMessage({ text: `Saved the balance of ${saved.providerId} for ${saved.day}.`, isError: false });
      onRecorded();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "The balance could not be saved.", isError: true });
    }
  };
  return (
    <form aria-label="Portal balance" onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-rx border border-rx-line p-3">
      <label className="flex flex-col gap-1 text-sm text-rx-muted">
        Provider
        {providers ? (
          <Select required value={providerId} onValueChange={setProviderId}>
            <SelectTrigger className="w-full rounded-rx border-rx-line px-2 py-1 text-rx-text data-[size=default]:h-auto data-[placeholder]:text-rx-text">
              <SelectValue placeholder="Pick a provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map(({ id, name }) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input required value={providerId} onChange={(event) => setProviderId(event.target.value)} className={FIELD} />
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm text-rx-muted">
        Day
        <Input required type="date" value={day} onChange={(event) => setDay(event.target.value)} className={FIELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-rx-muted">
        Portal balance (USD)
        <Input required inputMode="decimal" value={portalBalanceUsd} onChange={(event) => setPortalBalanceUsd(event.target.value)} className={FIELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-rx-muted">
        Top-up that day (USD)
        <Input inputMode="decimal" placeholder="0" value={topUpUsd} onChange={(event) => setTopUpUsd(event.target.value)} className={FIELD} />
      </label>
      <Button variant="outline" type="submit" className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
        Save balance
      </Button>
      {message && <SectionMessage text={message.text} isError={message.isError} />}
    </form>
  );
}
