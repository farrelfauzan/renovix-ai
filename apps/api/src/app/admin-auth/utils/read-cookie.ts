/** The value of the cookie `name` in a Cookie request header, or undefined. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  const prefix = `${name}=`;
  const pair = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return pair ? pair.slice(prefix.length) || undefined : undefined;
}
