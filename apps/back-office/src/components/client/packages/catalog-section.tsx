"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultAdminsApi } from "@/lib/admins/default-admins-api";
import type { ReauthCredentials } from "@/lib/admins/reauth-credentials";
import { useReauthGate } from "@/lib/admins/use-reauth-gate";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import { defaultPackagesApi } from "@/lib/packages/default-packages-api";
import type { FlagsInput } from "@/lib/packages/flags-input";
import type { OfferKind } from "@/lib/packages/offer-kind";
import type { PackagesApi } from "@/lib/packages/packages-api";
import type { PriceList } from "@/lib/packages/price-list";
import type { VersionInput } from "@/lib/packages/version-input";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { useAdminProfile } from "@/lib/session/use-admin-profile";
import { ReauthPrompt } from "../admins/reauth-prompt";
import { CatalogTable } from "./catalog-table";
import { FlagsForm } from "./flags-form";
import { VersionForm } from "./version-form";

type CatalogSectionProps = {
  readonly kind: OfferKind;
  readonly title: string;
  /** Replaced in tests only. */
  readonly api?: PackagesApi;
  readonly sessionApi?: SessionApi;
  readonly reauth?: (credentials: ReauthCredentials) => Promise<void>;
};

type OpenForm = { readonly mode: "version" | "flags"; readonly offer: CatalogOffer };

/**
 * Packages, top-up packs or Enterprise bundles (RNX-98, PRD 09 F6): the offers with their current version and,
 * for an admin with `packages:write`, new versions and flags (visibility only: the API enforces the permission,
 * asks for re-authentication on a new version and audits every write). A refusal shows the API's message.
 */
export function CatalogSection({ kind, title, api = defaultPackagesApi, sessionApi = defaultSessionApi, reauth = defaultAdminsApi.reauth }: CatalogSectionProps) {
  const profile = useAdminProfile(sessionApi);
  const [offers, setOffers] = useState<readonly CatalogOffer[] | null>(null);
  const [priceList, setPriceList] = useState<PriceList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<OpenForm | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const { perform, prompt } = useReauthGate(reauth);
  const canRead = profile?.permissions.includes("packages:read") ?? false;
  const canWrite = profile?.permissions.includes("packages:write") ?? false;
  const load = useCallback(async () => {
    try {
      setOffers(await api.listOffers(kind));
      setLoadError(null);
    } catch (err) {
      setLoadError(describeFailure(err));
    }
    setPriceList(await api.getPriceList().catch(() => null));
  }, [api, kind]);
  useEffect(() => {
    if (canRead) load();
  }, [canRead, load]);
  const save = async (write: () => Promise<void>): Promise<string | null> => {
    const outcome = await perform(write);
    if (!outcome.ok) return outcome.message;
    await load();
    return null;
  };
  if (!profile) return <p className="mt-4 text-sm text-rx-muted">Loading…</p>;
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="rx-type-card-heading">{title}</h2>
      {!canRead && <p className="mt-2 text-sm text-rx-muted">Your role cannot view {title.toLowerCase()} (packages:read).</p>}
      {loadError && <p role="alert" className="mt-2 text-sm text-rx-red-bar">{loadError}</p>}
      {prompt && <ReauthPrompt prompt={prompt} />}
      {form?.mode === "version" && (
        <VersionForm key={form.offer.id} kind={kind} offer={form.offer} onSave={(input: VersionInput) => save(() => api.createVersion(kind, form.offer.id, input))} onClose={() => setForm(null)} />
      )}
      {form?.mode === "flags" && (
        <FlagsForm key={form.offer.id} kind={kind} offer={form.offer} onSave={(input: FlagsInput) => save(() => api.updateOffer(kind, form.offer.id, input))} onClose={() => setForm(null)} />
      )}
      {offers && (
        <CatalogTable kind={kind} offers={offers} priceList={priceList} canWrite={canWrite} historyOpenId={historyOpenId}
          onToggleHistory={(id) => setHistoryOpenId((open) => (open === id ? null : id))} onNewVersion={(offer) => setForm({ mode: "version", offer })} onEditFlags={(offer) => setForm({ mode: "flags", offer })} />
      )}
    </section>
  );
}
