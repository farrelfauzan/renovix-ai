import { ServiceUnavailableException } from "@nestjs/common";

/** The `reminders` table does not exist yet: the reminder migration is not applied (RNX-139, was Prisma P2021). */
export class RemindersTableMissingException extends ServiceUnavailableException {
  constructor() {
    super("Reminders table not found");
  }
}
