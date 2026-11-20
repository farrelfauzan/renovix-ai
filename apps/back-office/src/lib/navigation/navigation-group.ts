import type { NavigationItem } from "./navigation-item";

/** One block of the side menu: an optional heading (the canvas's "Platform") and its items in display order. */
export type NavigationGroup = {
  readonly heading: string | null;
  readonly items: readonly NavigationItem[];
};
