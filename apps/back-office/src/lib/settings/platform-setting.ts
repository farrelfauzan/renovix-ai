/** One platform setting as `GET /admin/settings` lists it: the registry name and its value, null when not set. */
export type PlatformSetting = {
  readonly name: string;
  readonly value: number | null;
};
