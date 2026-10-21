import type { ModelConnection } from "../types/model-connection";
import type { ServedBy } from "../types/served-by";

/** RNX-179: who one attempt of a call goes to; RNX-162: with the connection's cost basis when it has one. */
export function servedByOf(connection: ModelConnection): ServedBy {
  const { slug, providerName, costBasis } = connection;
  return costBasis ? { slug, providerName, costBasis } : { slug, providerName };
}
