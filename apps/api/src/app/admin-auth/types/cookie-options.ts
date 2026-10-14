/** Input of `buildCookie`. */
export type CookieOptions = {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly maxAgeSeconds: number;
};
