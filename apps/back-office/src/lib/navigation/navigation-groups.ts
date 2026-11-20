import type { NavigationGroup } from "./navigation-group";

/**
 * The v1 back-office navigation, grouped and in display order as the design canvas draws it (RNX-312a). Each item
 * is a route of this app. Only Packages and credits and Models and providers name a permission (D353 Q5); the
 * others are shown to every admin.
 */
export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    heading: null,
    items: [
      { label: "Overview", href: "/" },
      { label: "Enterprise requests", href: "/enterprise-requests" },
      { label: "Companies", href: "/companies" },
      { label: "Users", href: "/users" },
      { label: "Packages and credits", href: "/packages-and-credits", permission: "packages:read" },
      { label: "Models and providers", href: "/models-and-providers", permission: "providers:read" },
      { label: "Usage and cost", href: "/usage-and-cost" },
      { label: "Guardrails", href: "/guardrails" },
    ],
  },
  {
    heading: "Platform",
    items: [
      { label: "Admins and roles", href: "/admins-and-roles" },
      { label: "Settings", href: "/settings" },
      { label: "Audit log", href: "/audit-log" },
    ],
  },
];
