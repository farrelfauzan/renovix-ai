import { DEFAULT_PROFILE_LANGUAGE } from "../../auth/config/default-profile-language";
import { PROFILE_LANGUAGES } from "../../auth/config/profile-languages";

/**
 * RNX-335: the line of an agent's system prompt that asks for the runner's saved language (`users.locale`, D362), or
 * none when it is unset, the default language, or not one of the profile languages. Only the matched profile language
 * is written into the prompt, never the stored value.
 */
export function replyLanguageSection(locale?: string | null): string {
  const language = PROFILE_LANGUAGES.find((candidate) => candidate === locale);
  if (!language || language === DEFAULT_PROFILE_LANGUAGE) return "";
  return `\n\nReply in the user's language (language code: ${language}).`;
}
