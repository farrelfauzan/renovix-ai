import { toWebHeaders } from "./to-web-headers";

describe("RNX-78: toWebHeaders", () => {
  it("copies each header, joins repeated ones and leaves out empty ones", () => {
    const actual = toWebHeaders({ cookie: "a=1", "x-repeated": ["one", "two"], "x-missing": undefined });

    expect([...actual.entries()]).toEqual([
      ["cookie", "a=1"],
      ["x-repeated", "one, two"],
    ]);
  });
});
