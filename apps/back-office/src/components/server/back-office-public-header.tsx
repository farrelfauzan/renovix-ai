import { RenovixLogo } from "./renovix-logo";

/**
 * The brand row above the public screens (sign-in, accept-invitation), as the canvas's sign-in artboard draws it
 * on the dark page (RNX-332): the Renovix logo, who may sign in here, and that this is not the product's login.
 */
export function BackOfficePublicHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <span className="flex items-center gap-2.5">
        <RenovixLogo layout="mark" tone="on-dark" size={30} />
        <span className="flex flex-col">
          <span className="text-base font-bold text-rx-white">Renovix Admin</span>
          <span className="font-mono text-[11px] text-rx-dark-muted">staff only · invitation required</span>
        </span>
      </span>
      <span className="font-mono text-xs text-rx-dark-muted">Separate from the product: own cookie, own accounts. A customer login does not work here.</span>
    </div>
  );
}
