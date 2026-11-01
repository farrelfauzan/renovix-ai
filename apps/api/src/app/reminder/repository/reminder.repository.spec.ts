import { Prisma } from "@generated/prisma/client.js";
import { ReminderRepository } from "./reminder.repository";
import { RemindersTableMissingException } from "../errors/reminders-table-missing.exception";
import type { PrismaService } from "../../prisma/prisma.service";

// RNX-139 (AGENTS.md Repositories, rule 2): the repository turns the Prisma error P2021 (the reminders table is
// missing) into an app error class, as the scheduler used to check for it itself. Any other error passes unchanged.
describe("RNX-139: ReminderRepository.findDueReminders, Prisma errors", () => {
  const knownError = (code: string, table: string) =>
    new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "test", meta: { table } });

  const repositoryFailingWith = (error: Error) => {
    const findMany = jest.fn().mockRejectedValue(error);
    return new ReminderRepository({ reminder: { findMany } } as unknown as PrismaService);
  };

  it("P2021 on the reminders table: RemindersTableMissingException (HTTP 503)", async () => {
    const repository = repositoryFailingWith(knownError("P2021", "public.reminders"));

    const actual = await repository.findDueReminders(20).catch((err: unknown) => err);

    expect(actual).toBeInstanceOf(RemindersTableMissingException);
    expect((actual as RemindersTableMissingException).getStatus()).toBe(503);
  });

  it("P2021 on another table: the Prisma error unchanged", async () => {
    const inputError = knownError("P2021", "public.channels");
    const repository = repositoryFailingWith(inputError);

    await expect(repository.findDueReminders(20)).rejects.toBe(inputError);
  });

  it("another Prisma code on the reminders table: the Prisma error unchanged", async () => {
    const inputError = knownError("P2002", "public.reminders");
    const repository = repositoryFailingWith(inputError);

    await expect(repository.findDueReminders(20)).rejects.toBe(inputError);
  });

  it("an error that is not a Prisma error: unchanged", async () => {
    const inputError = new Error("connection lost");
    const repository = repositoryFailingWith(inputError);

    await expect(repository.findDueReminders(20)).rejects.toBe(inputError);
  });
});
