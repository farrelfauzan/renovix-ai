import type { VersionInput } from "./version-input";

/** The body built from the form, or the text that says what is wrong with it. */
export type VersionInputResult = { readonly input: VersionInput } | { readonly error: string };
