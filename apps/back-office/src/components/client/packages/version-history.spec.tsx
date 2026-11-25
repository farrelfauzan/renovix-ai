import { fireEvent, render, screen } from "@testing-library/react";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import { VersionHistory } from "./version-history";

// RNX-356: the version history shows each version's id with a Copy button.
const offer: CatalogOffer = {
  id: "pkg-1", name: "Starter", active: true,
  versions: [
    { id: "ver-aaaa-2222", versionNumber: 2, effectiveFrom: "2020-02-01T00:00:00.000Z", createdBy: "admin", reason: "raise", priceUsdCents: 3000 },
    { id: "ver-bbbb-1111", versionNumber: 1, effectiveFrom: "2020-01-01T00:00:00.000Z", createdBy: "admin", reason: "seed", priceUsdCents: 2500 },
  ],
};

describe("VersionHistory", () => {
  it("shows each version's id and Copy puts the full id on the clipboard", () => {
    const writeText = jest.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<VersionHistory kind="package" offer={offer} />);
    expect(screen.getByText(/ver-aaaa-2222/)).toBeTruthy();
    expect(screen.getByText(/ver-bbbb-1111/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy id of version ver-bbbb-1111" }));
    expect(writeText).toHaveBeenCalledWith("ver-bbbb-1111");
  });
});
