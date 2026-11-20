"use client";

import { usePathname } from "next/navigation";
import { Fragment, useContext } from "react";
import { NAVIGATION_GROUPS } from "@/lib/navigation/navigation-groups";
import { selectVisibleNavigation } from "@/lib/navigation/select-visible-navigation";
import { SignedInAdminContext } from "@/lib/session/signed-in-admin-context";
import { SideNavigationLink } from "./side-navigation-link";

/**
 * The side menu (RNX-312a): the canvas's groups, each item shown only when the signed-in admin's permissions allow
 * its screen (visibility only). Client component to mark the current route and read the gate's profile. At 760 px
 * or less it wraps into the top row, without group headings.
 */
export function SideNavigation() {
  const pathname = usePathname();
  const profile = useContext(SignedInAdminContext);
  const groups = selectVisibleNavigation(NAVIGATION_GROUPS, profile?.permissions ?? []);
  return (
    <nav aria-label="Back-office" className="flex flex-col gap-0.5 narrow:flex-row narrow:flex-wrap narrow:gap-1">
      {groups.map((group) => (
        <Fragment key={group.heading ?? "main"}>
          {group.heading && <span className="px-3 pt-3.5 pb-1 font-mono text-[10px] tracking-[0.08em] text-rx-ink-group uppercase narrow:hidden">{group.heading}</span>}
          {group.items.map((item) => (
            <SideNavigationLink key={item.href} item={item} isCurrent={pathname === item.href} />
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
