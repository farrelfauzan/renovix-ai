import type { ChangeAuthor } from "./change-author";

/** A write of one platform setting. name and value are checked against the registry before anything is written. */
export type SettingChange = {
  readonly name: string;
  readonly value: unknown;
  readonly author: ChangeAuthor;
};
