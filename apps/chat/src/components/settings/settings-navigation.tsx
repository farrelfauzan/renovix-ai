"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellWorkspaces } from "@/hooks/use-shell-workspaces";

export function SettingsNavigation() {
  const pathname = usePathname();
  const { capability } = useShellWorkspaces();
  const companyOwner = capability?.collaborationAllowed === true && capability.effectiveRole === "owner";
  return (
    <nav aria-label="Settings" className="flex shrink-0 flex-wrap gap-2 border-b p-3">
      {[
        { href: "/settings/general", label: "General" },
        { href: "/settings/workspace", label: companyOwner ? "Workspace and members" : "Workspace" },
        { href: "/settings/billing", label: companyOwner ? "Company and credits" : "Billing and credits" },
      ].map(({ href, label }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="rounded-md px-3 py-2 text-sm hover:bg-secondary aria-[current=page]:bg-secondary">
          {label}
        </Link>
      ))}
    </nav>
  );
}
