import { createApiClient } from "@/lib/api/create-api-client";
import { createSettingsApi } from "./settings-api";

/** Where the API runs when NEXT_PUBLIC_API_URL is not set (local development, `apps/api` on port 3000). */
const LOCAL_API_URL = "http://localhost:3000";

/** The platform-settings routes on the API this build points at (RNX-226). */
export const defaultSettingsApi = createSettingsApi(createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? LOCAL_API_URL }));
