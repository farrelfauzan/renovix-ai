/** What a back-office session may do (RX-94): "enrolment" only sets up TOTP; "full" is a signed-in admin. */
export type SessionScope = "enrolment" | "full";
