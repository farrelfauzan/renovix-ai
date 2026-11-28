import { Reflector } from "@nestjs/core";
import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants";
import type { WeeklyFreeResetService } from "../service/weekly-free-reset.service";
import { WeeklyFreeResetScheduler } from "./weekly-free-reset.scheduler";

// RNX-321: the cron runs every Monday at 00:00 Asia/Jakarta and only hands the current time to the service.

describe("WeeklyFreeResetScheduler (RNX-321)", () => {
  it("is scheduled every Monday at 00:00 in Asia/Jakarta (the @Cron metadata ScheduleModule reads)", () => {
    const actualOptions = new Reflector().get(SCHEDULE_CRON_OPTIONS, WeeklyFreeResetScheduler.prototype.resetWeeklyFreeWallets);

    expect(actualOptions).toEqual({ cronTime: "0 0 * * 1", timeZone: "Asia/Jakarta" });
  });

  it("runs the reset with the current time", async () => {
    const mockReset = jest.fn().mockResolvedValue(3);
    const scheduler = new WeeklyFreeResetScheduler({ resetWeeklyFreeWallets: mockReset } as unknown as WeeklyFreeResetService);
    const before = Date.now();

    await scheduler.resetWeeklyFreeWallets();

    expect(mockReset).toHaveBeenCalledTimes(1);
    const actualNow = (mockReset.mock.calls[0] as [Date])[0];
    expect(actualNow.getTime()).toBeGreaterThanOrEqual(before);
    expect(actualNow.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
