/**
 * What `@AdminAudit` declares for a state-changing back-office route (RX-97): the resource and action
 * its audit row names, or an exemption with the reason (the route has no signed-in admin yet).
 */
export type AdminAuditOptions =
  | { readonly resource: string; readonly action: string; readonly exempt?: never }
  | { readonly exempt: true; readonly reason: string };
