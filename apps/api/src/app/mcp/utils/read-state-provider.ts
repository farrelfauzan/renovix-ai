/**
 * The provider an MCP OAuth `state` names, read WITHOUT checking its signature (RX-152). Only for
 * naming the cookie the callback reads and clears; the service verifies the whole state before it
 * trusts anything in it. Null when the state is absent or its payload is not readable JSON with a
 * string `p`.
 */
export function readStateProvider(state: string | undefined): string | null {
  if (!state) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString("utf8"));
    const provider = (payload as { p?: unknown } | null)?.p;
    return typeof provider === "string" ? provider : null;
  } catch {
    return null;
  }
}
