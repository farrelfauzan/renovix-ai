import { EntitlementService } from "../src/app/offers/service/entitlement.service";

/**
 * RNX-76 B3 (D297): from now on, `ownerId`'s packages no longer enable workspace collaboration (the state a plan
 * downgrade used to arrange). Purchase snapshots are append-only, so the entitlement read is stubbed for that owner
 * only; every other field and user is read from the database. Restore with `jest.restoreAllMocks()`.
 */
export function withdrawCollaboration(ownerId: string): void {
  const read = EntitlementService.prototype.getForUser;
  jest.spyOn(EntitlementService.prototype, "getForUser").mockImplementation(async function (this: EntitlementService, userId, tx) {
    const entitlement = await read.call(this, userId, tx);
    return userId === ownerId && entitlement ? { ...entitlement, collaborationEnabled: false } : entitlement;
  });
}
