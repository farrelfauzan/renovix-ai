import { Logger } from "@nestjs/common";
import { ReminderScheduler } from "./reminder.scheduler";
import { RemindersTableMissingException } from "../errors/reminders-table-missing.exception";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-139: when the reminders table is missing (the repository raises RemindersTableMissingException, was Prisma P2021)
// the scheduler logs one warning and skips the run, as before; any other error is logged as an error. The scheduler
// never throws out of processReminders. Collaborators are stubs; AgentToolService loads ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../service/reminder.service", () => ({ ReminderService: class {} }));

describe("RNX-139: the scheduler when the reminders table is missing", () => {
  afterEach(() => jest.restoreAllMocks());

  const schedulerFailingWith = (error: Error) => {
    const reminderService = { getDueReminders: jest.fn().mockRejectedValue(error) };
    return new ReminderScheduler(reminderService as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  };

  it("RemindersTableMissingException: one warning, no error line, no throw", async () => {
    const { lines } = captureLogLines();
    const scheduler = schedulerFailingWith(new RemindersTableMissingException());

    await expect(scheduler.processReminders()).resolves.toBeUndefined();

    expect(lines.filter((line) => line.includes("Reminders table not found. Skipping scheduler"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("Scheduler error"))).toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it("another error: logged as a scheduler error, no throw", async () => {
    const { lines } = captureLogLines();
    const scheduler = schedulerFailingWith(new Error("connection lost"));

    await expect(scheduler.processReminders()).resolves.toBeUndefined();

    expect(lines.filter((line) => line.includes("Scheduler error: connection lost"))).toHaveLength(1);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });
});
