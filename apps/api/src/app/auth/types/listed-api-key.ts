import type { ApiKeyView } from "./api-key-view";

/** A key as the list route answers it (RNX-82): its view and the credits its calls charged in the last 30 days as a decimal string ("0": none). */
export interface ListedApiKey extends ApiKeyView {
  readonly creditsLast30Days: string;
}
