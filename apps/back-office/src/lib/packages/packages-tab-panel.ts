import type { ReactNode } from "react";

/** One tab of the packages-and-credits page (RNX-315): its id in the URL (`?tab=`), its label and the section it shows. */
export type PackagesTabPanel = {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
};
