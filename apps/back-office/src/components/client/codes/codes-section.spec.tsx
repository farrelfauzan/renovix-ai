import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CodesApi } from "@/lib/codes/codes-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { pickOption } from "@/test/pick-option";
import { CodesSection } from "./codes-section";

// RNX-291: the code form's "Grants" select, through the section against a fake of CodesApi.
// jsdom has no scrollIntoView, which the open Select list calls on its selected item.
Element.prototype.scrollIntoView = jest.fn();

const profile: AdminProfile = { id: "a", email: "a@example.com", name: "a", role: "r", permissions: ["packages:write"], scope: "full", mustChangePassword: false, mfaEnrolled: true };
const sessionApi: SessionApi = { me: async () => profile, changePassword: async () => undefined, signOut: async () => undefined };

describe("CodesSection create form", () => {
  it("creates the code with the type picked in the select", async () => {
    const createCode = jest.fn(async () => undefined);
    const api: CodesApi = { listCodes: async () => ({ codes: [], total: 0, page: 1, limit: 25 }), createCode, deactivateCode: async () => undefined, listRedemptions: async () => [] };
    render(<CodesSection api={api} sessionApi={sessionApi} reauth={async () => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create code" }));
    pickOption(screen.getByRole("combobox", { name: "Grants" }), "A plan");
    fireEvent.change(screen.getByLabelText("Package version id"), { target: { value: "pv-1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create code" })[0]);
    await waitFor(() => expect(createCode).toHaveBeenCalled());
    expect(createCode).toHaveBeenCalledWith(expect.objectContaining({ type: "subscription", packageVersionId: "pv-1" }));
  });
});
