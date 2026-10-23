/** The new-version form's fields as typed text; `buildVersionInput` turns them into the API's body. */
export type VersionFields = {
  /** Dollars, e.g. "49.00"; blank for an Enterprise bundle means not set. */
  readonly price: string;
  /** Credits (a pack, a package) or the pool per period (a bundle); blank for a bundle means not set. */
  readonly credits: string;
  readonly billing: "one_time" | "monthly";
  readonly maxAgents: string;
  readonly maxConnectedTools: string;
  readonly apiAccess: boolean;
  /** Comma separated. */
  readonly allowedChannels: string;
  readonly allowedTiers: readonly string[];
  /** The value of a datetime-local input (the admin's local time). */
  readonly effectiveFrom: string;
  readonly reason: string;
};
