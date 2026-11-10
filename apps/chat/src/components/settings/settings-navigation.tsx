"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellWorkspaces } from "@/hooks/use-shell-workspaces";

export function SettingsNavigation() {
  const pathname = usePathname();
  const { capability } = useShellWorkspaces();
  const navRef = useRef<HTMLElement>(null);
  const companyOwner = capability?.collaborationAllowed === true && capability.effectiveRole === "owner";
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname, companyOwner]);
  return (
    <nav ref={navRef} aria-label="Settings" className="flex min-w-0 shrink-0 flex-nowrap gap-2 overflow-x-auto border-b p-3">
      {[
        { href: "/settings/general", label: "General" },
        { href: "/settings/workspace", label: companyOwner ? "Workspace and members" : "Workspace" },
        { href: "/settings/billing", label: companyOwner ? "Company and credits" : "Billing and credits" },
        { href: "/settings/tools", label: "Connected tools" },
        { href: "/settings/api-keys", label: "API keys" },
      ].map(({ href, label }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="shrink-0 whitespace-nowrap rounded-md px-3 py-3 text-sm sm:py-2 hover:bg-secondary aria-[current=page]:bg-secondary">
          {label}
        </Link>
      ))}
    </nav>
  );
}
