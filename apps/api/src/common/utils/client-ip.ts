import { Logger } from "@nestjs/common";
import type { ClientIpRequest } from "../types/client-ip-request";
import { readClientIpHeader } from "./client-ip-header";

const clientIpLogger = new Logger("clientIp");
let warnedMissingIpHeader = false;

/**
 * The client IP for the free-tier caps and the throttler (D48). With
 * CLIENT_IP_HEADER set, only that header counts (a trusted proxy in front of
 * the API must set it and overwrite any client-sent copy); without it (local,
 * tests) the socket address. Never X-Forwarded-For or request.ip.
 */
export function clientIp(req: ClientIpRequest): string {
  const headerName = readClientIpHeader();
  if (headerName) {
    const value = req.headers[headerName];
    const ip = (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim();
    if (ip) return ip;
    if (!warnedMissingIpHeader) {
      warnedMissingIpHeader = true;
      clientIpLogger.warn(
        `Header ${headerName} missing: requests without it share the "unknown" IP bucket`,
      );
    }
    return "unknown";
  }
  return (
    req.raw?.socket?.remoteAddress ?? req.socket?.remoteAddress ?? "unknown"
  );
}
