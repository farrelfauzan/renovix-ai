import type { LucideIcon } from "lucide-react";

export type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
};
