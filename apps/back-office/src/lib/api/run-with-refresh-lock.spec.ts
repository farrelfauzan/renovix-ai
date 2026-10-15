/** @jest-environment node */
import { runWithRefreshLock } from "./run-with-refresh-lock";

describe("runWithRefreshLock", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it("takes the named browser-wide lock when Web Locks exist", async () => {
    const request = jest.fn(async (_name: string, task: () => Promise<string>) => task());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request } }, configurable: true });
    await expect(runWithRefreshLock(async () => "done")).resolves.toBe("done");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("rx-admin-refresh");
  });

  it("just runs the task when there are no Web Locks", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    await expect(runWithRefreshLock(async () => "done")).resolves.toBe("done");
  });
});
