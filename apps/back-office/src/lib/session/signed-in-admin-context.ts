import { createContext } from "react";
import type { AdminProfile } from "./admin-profile";

/**
 * The profile of the session gate's last `GET /admin/auth/me` answer, for the shell around a gated route (RNX-312a):
 * the side menu's permissions and the session footer. Null outside the gate.
 */
export const SignedInAdminContext = createContext<AdminProfile | null>(null);
