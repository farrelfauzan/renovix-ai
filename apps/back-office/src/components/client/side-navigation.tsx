"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION_ITEMS } from "@/lib/navigation/navigation-items";

/** The side menu; client component only to mark the current route. */
export function SideNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Back-office" className="flex flex-row flex-wrap gap-1 p-3 md:flex-col">
      {NAVIGATION_ITEMS.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className="flex items-center gap-2 rounded-rx px-3 py-2 text-sm text-rx-ink-300 hover:bg-rx-ink-hover hover:text-rx-white aria-[current=page]:bg-rx-ink-active aria-[current=page]:font-medium aria-[current=page]:text-rx-white"
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
