import { createPublicApiClient } from "@/lib/api/create-public-api-client";
import { createInvitationApi } from "./invitation-api";

/** Where the API runs when NEXT_PUBLIC_API_URL is not set (local development, `apps/api` on port 3000). */
const LOCAL_API_URL = "http://localhost:3000";

/** The invitation routes on the API this build points at (RX-95). */
export const defaultInvitationApi = createInvitationApi(createPublicApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? LOCAL_API_URL }));
