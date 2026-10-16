import { Injectable } from "@nestjs/common";
import { UserRepository } from "../../auth/repository/user.repository";

/** The chat portal's signed-in user, for PortalGuard (a guard uses services, never repositories). */
@Injectable()
export class PortalUserService {
  constructor(private readonly users: UserRepository) {}

  /** The id, email and balance of this user, if there is one. */
  findPortalUser(userId: string) {
    return this.users.findPortalUser(userId);
  }
}
