import type { PROFILE_LANGUAGES } from "./profile-languages";

/** RNX-335: the language `users.locale` defaults to (schema `@default("en")`); it cannot be told apart from a choice of it. */
export const DEFAULT_PROFILE_LANGUAGE: (typeof PROFILE_LANGUAGES)[number] = "en";
