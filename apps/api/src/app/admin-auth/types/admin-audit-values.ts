/**
 * The values an audit row records before and after a change (RX-97): flat, non-secret state such as
 * `{ sessionId, revoked: false }`. Never tokens, TOTP secrets, recovery codes, password hashes or
 * personal data.
 */
export type AdminAuditValues = Readonly<Record<string, string | number | boolean | null>>;
