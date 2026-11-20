/** RNX-78: a Fastify request's raw headers as a Web `Headers` object (what Better Auth's server API reads). */
export function toWebHeaders(raw: Readonly<Record<string, string | string[] | undefined>>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}
