/** Characters of a key the API may show (RX-177). */
const HINT_CHARACTERS = 4;

/** The stored and shown hint of a provider key (RX-177): its last 4 characters. */
export const toApiKeyHint = (apiKey: string): string => apiKey.slice(-HINT_CHARACTERS);
