import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { RoleRow } from "./role-row";

// RNX-369 (D406): the row actions of the roles table are icon-only buttons. The accessible name is the one each had
// as a text button; the tooltip carries the short title. jsdom has no hover or focus-visible, so the shared tooltip
// is replaced by one that always shows its content, as the next sibling of its button.
jest.mock("@performa-ai/ui/components/tooltip", () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});

const CUSTOM_ROLE = { name: "custom_ro", permissions: ["users:read"], builtIn: false };

/** Asserts the button named `name` shows no text and has `title` as its tooltip; returns it. */
function expectIconAction(name: string, title: string): HTMLElement {
  const button = screen.getByRole("button", { name });
  expect(button.textContent).toBe("");
  expect(button.nextElementSibling?.textContent).toBe(title);
  return button;
}

describe("row actions of the roles table", () => {
  it("Edit and Delete are icon-only, named by their role, and run their action", () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(<table><tbody><RoleRow role={CUSTOM_ROLE} canWrite onEdit={onEdit} onDelete={onDelete} /></tbody></table>);
    fireEvent.click(expectIconAction("Edit role custom_ro", "Edit"));
    fireEvent.click(expectIconAction("Delete role custom_ro", "Delete"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
