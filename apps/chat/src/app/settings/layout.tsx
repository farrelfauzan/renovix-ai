import { SettingsNavigation } from "@/components/settings/settings-navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <><SettingsNavigation /><div className="min-w-0 flex-1">{children}</div></>;
}
