import type { RequestLogFields } from "../types/request-log-fields";
import { requestLogStorage } from "./request-log-storage";

/**
 * RNX-17: the fields of the request being handled, or undefined outside a request (startup, schedulers). Read when
 * each line is written, so the account appears once a guard has attached it.
 */
export function readRequestLogFields(): RequestLogFields | undefined {
  const request = requestLogStorage.getStore();
  if (!request) return undefined;
  const accountId = request.user?.userId ?? request.user?.id ?? request.portalIdentity?.user?.id;
  const adminId = request.admin?.adminId;
  return {
    requestId: request.id,
    ...(request.routeOptions?.url && { route: request.routeOptions.url }),
    ...(accountId && { accountId }),
    ...(adminId && { adminId }),
  };
}
