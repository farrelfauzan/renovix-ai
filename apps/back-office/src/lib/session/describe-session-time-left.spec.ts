import { describeSessionTimeLeft } from "./describe-session-time-left";

const MINUTE = 60_000;
const NOW = Date.parse("2026-10-14T08:00:00.000Z");

const atMinutesFromNow = (minutes: number): string => new Date(NOW + minutes * MINUTE).toISOString();

describe("describeSessionTimeLeft (RNX-346)", () => {
  it("the idle limit is sooner: \"Session idle in N min\"", () => {
    const inputIdle = { idleExpiresAt: atMinutesFromNow(20), absoluteExpiresAt: atMinutesFromNow(90), now: NOW };

    const actualText = describeSessionTimeLeft(inputIdle);

    expect(actualText).toBe("Session idle in 20 min");
  });

  it("the absolute limit is sooner: \"Session ends in N min\"", () => {
    const inputAbsolute = { idleExpiresAt: atMinutesFromNow(30), absoluteExpiresAt: atMinutesFromNow(5), now: NOW };

    const actualText = describeSessionTimeLeft(inputAbsolute);

    expect(actualText).toBe("Session ends in 5 min");
  });

  it("under a minute to the absolute limit: \"Session ends in under 1 min\"", () => {
    const inputAbsoluteSoon = { idleExpiresAt: atMinutesFromNow(30), absoluteExpiresAt: atMinutesFromNow(0.5), now: NOW };

    const actualText = describeSessionTimeLeft(inputAbsoluteSoon);

    expect(actualText).toBe("Session ends in under 1 min");
  });

  it("under a minute to the idle limit: \"Session idle in under 1 min\"", () => {
    const inputIdleSoon = { idleExpiresAt: atMinutesFromNow(0.5), absoluteExpiresAt: atMinutesFromNow(90), now: NOW };

    const actualText = describeSessionTimeLeft(inputIdleSoon);

    expect(actualText).toBe("Session idle in under 1 min");
  });

  it("both limits at the same instant: the idle wording", () => {
    const inputEqual = { idleExpiresAt: atMinutesFromNow(15), absoluteExpiresAt: atMinutesFromNow(15), now: NOW };

    const actualText = describeSessionTimeLeft(inputEqual);

    expect(actualText).toBe("Session idle in 15 min");
  });
});
