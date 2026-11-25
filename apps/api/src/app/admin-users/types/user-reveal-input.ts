import type { AdminIdentity } from "../../admin-auth/types/admin-identity";
import type { UserRevealBodyDto } from "../dto/user-reveal-body.dto";

/** One personal-data reveal (RNX-357): who asks, whose field, and the parsed body with the field and the reason. */
export type UserRevealInput = {
  readonly admin: AdminIdentity;
  readonly userId: string;
  readonly body: UserRevealBodyDto;
};
