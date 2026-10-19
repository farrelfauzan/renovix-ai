import { normalizeModelId } from "./normalize-model-id";

describe("normalizeModelId (RX-178)", () => {
  it("writes dots as dashes, so a dotted and a dashed id match", () => {
    expect(normalizeModelId("vendor/model-5.5")).toBe("vendor/model-5-5");
    expect(normalizeModelId("x/model-5-5")).toBe("x/model-5-5");
  });

  it("lower-cases the id", () => {
    expect(normalizeModelId("Vendor/Model-4.6")).toBe("vendor/model-4-6");
  });
});
