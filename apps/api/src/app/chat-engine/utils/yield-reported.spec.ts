import { yieldReported } from "./yield-reported";

// RNX-328: yieldReported yields what a run reports while it runs, each item as it arrives, then returns the run's result.

type Run = (report: (item: string) => void) => Promise<string>;

/** Drives the generator to its end and returns what it yielded and what it returned. */
async function drain(generator: AsyncGenerator<string, string>): Promise<{ yielded: string[]; returned: string }> {
  const yielded: string[] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) return { yielded, returned: step.value };
    yielded.push(step.value);
  }
}

describe("RNX-328: yieldReported", () => {
  it("yields the items in the order they were reported, before the result, and returns the run's result", async () => {
    const inputRun: Run = async (report) => {
      report("first");
      report("second");
      report("third");
      return "result";
    };

    const actual = await drain(yieldReported(inputRun));

    expect(actual).toEqual({ yielded: ["first", "second", "third"], returned: "result" });
  });

  it("yields an item reported while the run is still pending, before the run settles", async () => {
    let finishRun!: () => void;
    const inputRunHeld = new Promise<void>((resolve) => (finishRun = resolve));
    const inputRun: Run = async (report) => {
      report("live");
      await inputRunHeld;
      return "result";
    };
    const generator = yieldReported(inputRun);

    const actualFirst = await generator.next();
    finishRun();
    const actualLast = await generator.next();

    expect(actualFirst).toEqual({ done: false, value: "live" });
    expect(actualLast).toEqual({ done: true, value: "result" });
  });

  it("yields an item reported later, after the consumer is already waiting, while the run is pending", async () => {
    let reportLater!: (item: string) => void;
    let finishRun!: () => void;
    const inputRunHeld = new Promise<void>((resolve) => (finishRun = resolve));
    const inputRun: Run = async (report) => {
      reportLater = report;
      await inputRunHeld;
      return "result";
    };
    const generator = yieldReported(inputRun);
    const pendingFirst = generator.next();

    reportLater("late");
    const actualFirst = await pendingFirst;
    finishRun();
    const actualLast = await generator.next();

    expect(actualFirst).toEqual({ done: false, value: "late" });
    expect(actualLast).toEqual({ done: true, value: "result" });
  });

  it("a run that rejects throws its error after the items it reported were yielded", async () => {
    const inputError = new Error("run failed");
    const inputRun: Run = async (report) => {
      report("before the failure");
      throw inputError;
    };
    const generator = yieldReported(inputRun);

    const actualFirst = await generator.next();

    expect(actualFirst).toEqual({ done: false, value: "before the failure" });
    await expect(generator.next()).rejects.toBe(inputError);
  });

  it("a run that reports nothing just returns its result", async () => {
    const inputRun: Run = async () => "only result";

    const actual = await drain(yieldReported(inputRun));

    expect(actual).toEqual({ yielded: [], returned: "only result" });
  });
});
