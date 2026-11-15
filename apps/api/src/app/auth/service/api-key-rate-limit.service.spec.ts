import { ApiKeyRateLimitService } from "./api-key-rate-limit.service";
import type { PlatformSettingsService } from "../../offers/service/platform-settings.service";

describe("ApiKeyRateLimitService.getRequestsPerMinute (RNX-82)", () => {
  const getSetting = jest.fn();
  const service = new ApiKeyRateLimitService({ getSetting } as unknown as PlatformSettingsService);

  beforeEach(() => getSetting.mockReset());

  it("answers the apiKeyRequestsPerMinute setting", async () => {
    getSetting.mockResolvedValue(120);

    expect(await service.getRequestsPerMinute()).toBe(120);
    expect(getSetting).toHaveBeenCalledWith("apiKeyRequestsPerMinute");
  });

  it("answers the default while the setting has no value, the same one consume() enforces", async () => {
    getSetting.mockResolvedValue(null);

    const actualLimit = await service.getRequestsPerMinute();

    expect(actualLimit).toBe(60);
    for (let call = 0; call < actualLimit; call += 1) await service.consume("key-a");
    await expect(service.consume("key-a")).rejects.toMatchObject({ status: 429 });
  });
});
