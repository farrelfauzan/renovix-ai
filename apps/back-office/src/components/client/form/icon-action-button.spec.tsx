import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { Pencil } from "lucide-react";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";

// D406: a table row's action is an icon-only button; its title is the accessible name and shows in a tooltip.
// jsdom has no hover or focus-visible, so the shared tooltip is replaced by one that always shows its content: this
// checks what the tooltip is given; that it opens on hover and on focus is checked in a real browser.
jest.mock("@performa-ai/ui/components/tooltip", () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
describe("IconActionButton", () => {
  it("is a button named by its title, with no visible text, and runs the action on click", () => {
    const onClick = jest.fn();
    render(<IconActionButton title="Flags" icon={Pencil} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Flags" });
    expect(button.textContent).toBe("");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("gives the tooltip its title, not the longer accessible name", () => {
    render(<IconActionButton title="Edit" label="Edit Seat ceiling" icon={Pencil} onClick={() => undefined} />);
    expect(screen.getByRole("tooltip").textContent).toBe("Edit");
  });

  it("takes a longer accessible name than its tooltip, and says when it has opened something", () => {
    render(<IconActionButton title="Edit" label="Edit Seat ceiling" icon={Pencil} onClick={() => undefined} isExpanded />);
    expect(screen.getByRole("button", { name: "Edit Seat ceiling" }).getAttribute("aria-expanded")).toBe("true");
  });
});
