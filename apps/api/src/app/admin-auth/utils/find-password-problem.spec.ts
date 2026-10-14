import { findPasswordProblem } from "./find-password-problem";

// RX-94 password rules: length in characters, the breached list (whole password, any case), the service
// name and the email name. The list here is a stand-in; password.service.spec.ts checks the real one.
describe("findPasswordProblem", () => {
  const breached = new Set(["correcthorsebattery"]);
  const check = (password: string, email = "dewi.lestari@example.com") =>
    findPasswordProblem({ password, email, minLength: 12, breached });

  it("accepts a 12-character password that breaks no rule", () => {
    expect(check("Tq8#vLm2Pz!w")).toBeNull();
  });

  it.each([
    ["11 characters", "Tq8#vLm2Pz!", "at least 12 characters"],
    ["11 characters that are 12+ bytes (counted in characters)", "Tq8#vLm2Pzé", "at least 12 characters"],
    ["a listed password", "correcthorsebattery", "breached"],
    ["a listed password in another case", "CorrectHorseBattery", "breached"],
    ['"renovix" inside', "MyRenovixPass#2026", '"renovix"'],
    ["the email name inside", "xx-Dewi.Lestari-2026", "name part of the email"],
  ])("refuses %s", (_case, password, reason) => {
    expect(check(password)).toContain(reason);
  });

  it("does not look for an email name shorter than 3 characters", () => {
    expect(check("Tq8#vLm2Pz!w-ab", "ab@example.com")).toBeNull();
  });
});
