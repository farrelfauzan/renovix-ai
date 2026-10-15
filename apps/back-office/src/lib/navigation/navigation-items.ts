import {
  Activity,
  Boxes,
  Building2,
  Cpu,
  FileClock,
  Inbox,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { NavigationItem } from "./navigation-item";

/** The v1 back-office navigation, in display order. Each item is a route with a placeholder page. */
export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Enterprise requests", href: "/enterprise-requests", icon: Inbox },
  { label: "Companies", href: "/companies", icon: Building2 },
  { label: "Users", href: "/users", icon: Users },
  { label: "Packages and credits", href: "/packages-and-credits", icon: Package },
  { label: "Models and providers", href: "/models-and-providers", icon: Cpu },
  { label: "Usage and cost", href: "/usage-and-cost", icon: Activity },
  { label: "Guardrails", href: "/guardrails", icon: ShieldCheck },
  { label: "Admins and roles", href: "/admins-and-roles", icon: Boxes },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Audit log", href: "/audit-log", icon: FileClock },
];
