/**
 * What a back-office session may do (RX-94, RX-95): "enrolment" only sets up TOTP; "password_change" only
 * changes the password after a forced reset; "full" is a signed-in admin.
 */
export type SessionScope = "enrolment" | "password_change" | "full";
