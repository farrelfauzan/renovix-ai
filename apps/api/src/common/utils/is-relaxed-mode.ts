/**
 * True when NODE_ENV is development or test; anything else, unset included, is treated as production (RX-110).
 * Shared by the refuse-before-start checks that are relaxed in development and test (secrets, CORS_ORIGIN).
 */
export const isRelaxedMode = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === "development" || env.NODE_ENV === "test";
