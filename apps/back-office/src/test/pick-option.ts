import { fireEvent, screen } from "@testing-library/react";

/** Opens a shared Select (Radix) by its trigger, then clicks the option; jsdom needs the scrollIntoView stub of the spec. */
export const pickOption = (trigger: HTMLElement, name: string): void => {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name }));
};
