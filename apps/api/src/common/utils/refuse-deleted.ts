import { NotFoundException } from "@nestjs/common";
// The runtime's class, not the generated client's re-export: `bun run seed` loads repositories without the `@generated`
// path alias (knowledge-base.repository.ts), so this helper may only name the runtime import.
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

const NO_SUCH_ROW_CODE = "P2025";

/**
 * Runs a write on one live row (RNX-124, RNX-125, RNX-145): Prisma's "no such row" (P2025: the row was deleted, or
 * deleted meanwhile) becomes a 404 with the given message. Any other error passes through unchanged.
 */
export async function refuseDeleted<T>(write: () => Promise<T>, message: string): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof PrismaClientKnownRequestError && err.code === NO_SUCH_ROW_CODE) {
      throw new NotFoundException(message);
    }
    throw err;
  }
}
