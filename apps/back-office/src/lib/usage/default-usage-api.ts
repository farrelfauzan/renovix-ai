import { createApiClient } from "@/lib/api/create-api-client";
import { createUsageApi } from "./usage-api";

/** Where the API runs when NEXT_PUBLIC_API_URL is not set (local development, `apps/api` on port 3000). */
const LOCAL_API_URL = "http://localhost:3000";

/** The usage, profit and reconciliation routes on the API this build points at (RNX-228). */
export const defaultUsageApi = createUsageApi(createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? LOCAL_API_URL }));
