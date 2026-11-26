import { render, screen } from "@testing-library/react";
import { BackOfficeSidebar } from "./back-office-sidebar";

// RNX-312a: the environment label under the sidebar logo comes from NEXT_PUBLIC_ADMIN_ENV_LABEL, hidden when unset.

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }), usePathname: () => "/" }));

const LABEL = "admin.renovix.id · staging";

describe("BackOfficeSidebar (RNX-312a)", () => {
  const saved = process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL;

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL;
    else process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL = saved;
  });

  it("shows the environment label when NEXT_PUBLIC_ADMIN_ENV_LABEL is set", () => {
    process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL = LABEL;

    render(<BackOfficeSidebar />);

    expect(screen.getByText(LABEL)).toBeTruthy();
    expect(screen.getByText("Renovix Admin")).toBeTruthy();
  });

  it.each([["unset", undefined], ["empty", ""]])("shows no environment label when it is %s", (_case, value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL;
    else process.env.NEXT_PUBLIC_ADMIN_ENV_LABEL = value;

    render(<BackOfficeSidebar />);

    expect(screen.getByText("Renovix Admin").parentElement?.children).toHaveLength(1);
  });

  // RNX-374: jsdom has no layout, so this pins the classes the layout rests on; the real scroll is shown in a browser.
  it("stays in view above 760 px: stuck to the top at the height of the screen, with its own scroll, and not as the top row", () => {
    render(<BackOfficeSidebar />);

    const actualClasses = screen.getByRole("complementary").className.split(" ");

    expect(actualClasses).toEqual(expect.arrayContaining(["wide:sticky", "wide:top-0", "wide:h-screen", "wide:overflow-y-auto"]));
    expect(actualClasses.filter((name) => /^(narrow:)?(sticky|fixed|h-screen|top-0)$/.test(name))).toEqual([]);
  });
});
