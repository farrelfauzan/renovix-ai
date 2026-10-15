"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION_ITEMS } from "@/lib/navigation/navigation-items";

/** The side menu; client component only to mark the current route. */
export function SideNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Back-office" className="flex flex-col gap-1 p-3">
      {NAVIGATION_ITEMS.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-neutral-100 aria-[current=page]:bg-neutral-200 aria-[current=page]:font-medium"
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
