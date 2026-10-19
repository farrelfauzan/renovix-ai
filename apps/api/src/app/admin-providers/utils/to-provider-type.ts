import type { ProviderType } from "@generated/prisma/client.js";
import { PROVIDER_TYPE_NAMES } from "../config/provider-type-names";

/** The stored provider type of an API type name (RX-177): "9router" → nine_router. */
export function toProviderType(name: (typeof PROVIDER_TYPE_NAMES)[ProviderType]): ProviderType {
  const types = Object.keys(PROVIDER_TYPE_NAMES) as ProviderType[];
  return types.find((type) => PROVIDER_TYPE_NAMES[type] === name) as ProviderType;
}
