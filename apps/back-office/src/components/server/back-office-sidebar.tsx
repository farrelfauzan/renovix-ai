import { SessionFooter } from "@/components/client/session/session-footer";
import { SessionHeaderMenu } from "@/components/client/session/session-header-menu";
import { SideNavigation } from "@/components/client/side-navigation";
import { RenovixLogo } from "./renovix-logo";

/**
 * The back-office shell's sidebar, as the design canvas's Main artboard draws it (RNX-312a): the brand with the
 * environment label (NEXT_PUBLIC_ADMIN_ENV_LABEL, hidden when unset), the side menu and the session footer. At
 * 760 px or less it collapses to a top row: the menu wraps, and the header menu holds the idle time and Sign out.
 * Above 760 px it stays in view at the height of the screen while the page scrolls, and scrolls on its own when the
 * menu is taller than the screen (RNX-374); the top row scrolls away with the page.
 */
export function BackOfficeSidebar() {
  const environmentLabel = process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL;
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-0.5 bg-rx-ink px-3 py-4 text-rx-white wide:sticky wide:top-0 wide:h-screen wide:overflow-y-auto narrow:w-full narrow:flex-row narrow:flex-wrap narrow:items-center narrow:gap-1 narrow:p-2.5">
      <div className="flex items-center gap-2.5 px-2.5 pt-1 pb-2.5 narrow:basis-full">
        <RenovixLogo layout="mark" tone="on-dark" size={28} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">Renovix Admin</span>
          {environmentLabel && <span className="font-mono text-[11px] text-rx-dark-muted">{environmentLabel}</span>}
        </span>
        <SessionHeaderMenu />
      </div>
      <SideNavigation />
      <div className="flex-1 narrow:hidden" />
      <SessionFooter />
    </aside>
  );
}
