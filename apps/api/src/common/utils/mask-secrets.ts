const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

/** Keys whose whole value is a secret: auth headers, cookies, passwords, API and provider keys, tokens. */
const SECRET_KEY = /authorization|cookie|passw(or)?d|secret|token$|api[-_]?key|private[-_]?key|portal[-_]?session|credential/i;

/** A secret's value masked, keeping its label (`authorization: `, `Bearer `, none) and its quotes. */
const maskLabelledValue = (_match: string, label: string, value: string): string =>
  /^["']/.test(value) ? `${label}${value[0]}${REDACTED}${value[0]}` : `${label}${REDACTED}`;

/** Secrets found by their shape anywhere in a text: group 1 is a label kept as is, group 2 the secret. */
const SECRET_TEXT: readonly RegExp[] = [
  // Bearer credentials anywhere.
  /\b(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi,
  // An authorization or cookie header written out: its quoted value, or everything after it on the line (any
  // scheme, `a=1; b=2`).
  /\b((?:authorization|(?:set-)?cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n]*)/gi,
  // `password=...`, `"apiKey": "..."`, `token: ...` in a message, a query string or JSON.
  /\b((?:passw(?:or)?d|secret|token|api[-_]?key|x-portal-session)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
  // API and provider keys: rnx_live_... (ours, RNX-18), sk_live_..., sk-or-v1-... (OpenRouter), sk-ant-..., sk-proj-...
  /()\b((?:rnx_live_|sk[-_])[A-Za-z0-9_-]{6,})/g,
  // JWTs.
  /()\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/g,
  // The password of a connection string (postgresql://user:password@host).
  /(\/\/[^\s:/@]+:)([^\s@/]+)(?=@)/g,
];

function maskText(text: string): string {
  return SECRET_TEXT.reduce((masked, pattern) => masked.replace(pattern, maskLabelledValue), text);
}

function maskEntries(entries: [string, unknown][], seen: WeakSet<object>, depth: number): Record<string, unknown> {
  return Object.fromEntries(
    entries.map(([key, value]) => [key, SECRET_KEY.test(key) ? REDACTED : maskValue(value, seen, depth + 1)]),
  );
}

/** A copy of the error with its message, stack, own fields and cause masked; it prints like the original. */
function maskError(err: Error, seen: WeakSet<object>, depth: number): Error {
  const masked = new Error(maskText(err.message));
  masked.name = err.name;
  masked.stack = err.stack === undefined ? undefined : maskText(err.stack);
  Object.assign(masked, maskEntries(Object.entries(err), seen, depth));
  if (err.cause !== undefined) masked.cause = maskValue(err.cause, seen, depth + 1);
  return masked;
}

function maskObject(value: object, seen: WeakSet<object>, depth: number): unknown {
  if (seen.has(value)) return "[Circular]";
  if (depth > MAX_DEPTH) return "[Object]";
  seen.add(value);
  if (value instanceof Error) return maskError(value, seen, depth);
  if (Array.isArray(value)) return value.map((item) => maskValue(item, seen, depth + 1));
  if (value instanceof Map) return maskEntries([...value].map(([k, v]) => [String(k), v]), seen, depth);
  if (value instanceof Set) return [...value].map((item) => maskValue(item, seen, depth + 1));
  // A Date, a Prisma Decimal, ...: what JSON.stringify would print, masked.
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return maskValue((value as { toJSON: () => unknown }).toJSON(), seen, depth + 1);
  }
  return maskEntries(Object.entries(value), seen, depth);
}

function maskValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return maskText(value);
  if (typeof value === "function") return value;
  if (typeof value === "object" && value !== null) return maskObject(value, seen, depth);
  return value;
}

/**
 * RNX-17: a copy of a log argument with every secret replaced by `[REDACTED]`: by key name in objects and errors
 * (any depth), and by shape in every string (Bearer credentials, authorization and cookie headers, `rnx_live_`,
 * `sk-`/`sk_` keys, JWTs, `key=value` pairs, connection-string passwords). A masked value never appears in full or in part.
 */
export function maskSecrets(value: unknown): unknown {
  return maskValue(value, new WeakSet<object>(), 0);
}
