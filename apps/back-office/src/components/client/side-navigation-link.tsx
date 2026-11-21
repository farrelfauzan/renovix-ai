"use client";
import Link from "next/link";
import type { NavigationItem } from "@/lib/navigation/navigation-item";

type SideNavigationLinkProps = {
  readonly item: NavigationItem;
  readonly isCurrent: boolean;
};

/** One item of the side menu, marked when it is the current route. */
export function SideNavigationLink({ item, isCurrent }: SideNavigationLinkProps) {
  return (
    <Link
      href={item.href}
      aria-current={isCurrent ? "page" : undefined}
      className="flex min-h-[38px] items-center rounded-rx px-3 text-sm text-rx-ink-300 hover:bg-rx-ink-hover hover:text-rx-white aria-[current=page]:bg-rx-ink-active aria-[current=page]:font-medium aria-[current=page]:text-rx-white"
    >
      {item.label}
    </Link>
  );
}
