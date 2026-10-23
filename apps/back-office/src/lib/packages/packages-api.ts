import type { ApiClient } from "@/lib/api/api-client";
import { sendAdminRequest } from "@/lib/api/send-admin-request";
import type { CatalogOffer } from "./catalog-offer";
import type { FlagsInput } from "./flags-input";
import type { OfferKind } from "./offer-kind";
import type { PriceList } from "./price-list";
import type { VersionInput } from "./version-input";

/** The admin route segment of each kind (RNX-226). */
const SEGMENT: Record<OfferKind, string> = { package: "packages", "top-up-pack": "top-up-packs", "enterprise-bundle": "enterprise-bundles" };
const PRICES_PATH = "/api/v1/prices";

/**
 * The catalog routes of RNX-226. Each throws SignedOutError when the session is over, ReauthRequiredError for a
 * new version without a recent re-authentication, and a RefusedError with the API's message otherwise.
 */
export type PackagesApi = {
  readonly listOffers: (kind: OfferKind) => Promise<readonly CatalogOffer[]>;
  /** Creates the next version (needs a recent re-authentication). */
  readonly createVersion: (kind: OfferKind, id: string, input: VersionInput) => Promise<void>;
  /** Changes the active flag (and, for packages, visible and display order); no new version. */
  readonly updateOffer: (kind: OfferKind, id: string, input: FlagsInput) => Promise<void>;
  /** The public rupiah prices derived from the dollar prices (no session needed). */
  readonly getPriceList: () => Promise<PriceList>;
};

/** The catalog routes on the session client; the public price list through `publicClient`. */
export function createPackagesApi(client: ApiClient, publicClient: ApiClient): PackagesApi {
  const path = (kind: OfferKind, id?: string): string => `/${SEGMENT[kind]}${id ? `/${encodeURIComponent(id)}` : ""}`;
  return {
    listOffers: async (kind) => (await sendAdminRequest(client, path(kind))).json(),
    createVersion: async (kind, id, { terms, reason, effectiveFrom }) => {
      await sendAdminRequest(client, `${path(kind, id)}/versions`, "POST", { ...terms, reason, effectiveFrom });
    },
    updateOffer: async (kind, id, input) => {
      await sendAdminRequest(client, path(kind, id), "PATCH", input);
    },
    getPriceList: async () => {
      const res = await publicClient.request(PRICES_PATH);
      if (!res.ok) throw new Error(`The price list answered ${res.status}.`);
      return res.json();
    },
  };
}
