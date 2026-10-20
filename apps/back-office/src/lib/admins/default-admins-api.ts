import { createApiClient } from "@/lib/api/create-api-client";
import { createAdminsApi } from "./admins-api";

/** Where the API runs when NEXT_PUBLIC_API_URL is not set (local development, `apps/api` on port 3000). */
const LOCAL_API_URL = "http://localhost:3000";

/** The admin, invitation and role routes on the API this build points at (RX-95, RNX-187). */
export const defaultAdminsApi = createAdminsApi(createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? LOCAL_API_URL }));
