import { BadRequestException } from "@nestjs/common";
import { parseRouteId } from "./parse-route-id";

// RNX-100: the id of a user or session route path.

describe("parseRouteId", () => {
  it("returns an id of 1 to 64 characters as it is", () => {
    const inputId = "00000000-0000-4000-8000-000000000001";

    const actualId = parseRouteId(inputId);

    expect(actualId).toBe(inputId);
  });

  it.each([
    ["an empty id", ""],
    ["an id of 65 characters", "x".repeat(65)],
  ])("refuses %s with a 400", (_case, inputId) => {
    expect(() => parseRouteId(inputId)).toThrow(BadRequestException);
  });
});
