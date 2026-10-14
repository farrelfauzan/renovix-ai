// RX-149 evidence only: a failing API test, on a throwaway branch that is never merged.
describe("RX-149 red run", () => {
  it("fails on purpose so the CI job is shown red", () => {
    expect(1).toBe(2);
  });
});
