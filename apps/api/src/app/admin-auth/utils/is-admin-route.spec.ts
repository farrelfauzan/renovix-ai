import { isAdminRoute } from "./is-admin-route";

describe("isAdminRoute (RX-156)", () => {
  it.each([
    ["admin/auth", "sign-in"],
    ["/admin/auth", "/"],
    ["admin", "/"],
    ["/", "admin/users"],
    [["public", "admin/users"], "/"],
  ])("%p + %p: an /admin route", (controllerPath, handlerPath) => {
    expect(isAdminRoute(controllerPath, handlerPath)).toBe(true);
  });

  it.each([
    ["codes", "redeem"],
    ["administration", "/"],
    ["/", "/"],
    ["chat", "admin"],
  ])("%p + %p: not an /admin route", (controllerPath, handlerPath) => {
    expect(isAdminRoute(controllerPath, handlerPath)).toBe(false);
  });
});
