import { createApiClient } from "@/lib/api/create-api-client";
import { createCodesApi } from "./codes-api";

/** Where the API runs when NEXT_PUBLIC_API_URL is not set (local development, `apps/api` on port 3000). */
const LOCAL_API_URL = "http://localhost:3000";

/** The invitation-code routes on the API this build points at (RNX-226). */
export const defaultCodesApi = createCodesApi(createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? LOCAL_API_URL }));
