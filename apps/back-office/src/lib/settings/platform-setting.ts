/**
 * One platform setting as `GET /admin/settings` lists it: the registry name and its value, null when not set. Most
 * values are numbers; the payments switch is a boolean and its pilot allow-list a list of user ids (RNX-35).
 */
export type PlatformSetting = {
  readonly name: string;
  readonly value: number | boolean | readonly string[] | null;
};
