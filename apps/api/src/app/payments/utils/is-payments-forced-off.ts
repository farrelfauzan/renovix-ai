/** True when PAYMENTS_FORCE_OFF is exactly "true" (RNX-35): payments are off whatever the paymentsEnabled setting says. */
export const isPaymentsForcedOff = (env: NodeJS.ProcessEnv): boolean => env.PAYMENTS_FORCE_OFF === "true";
