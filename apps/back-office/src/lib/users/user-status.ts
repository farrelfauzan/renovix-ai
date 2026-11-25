/** A user's state in the back office (RNX-357): "locked" means the paid wallet has no available credits, or there is none. */
export type UserStatus = "active" | "suspended" | "locked";
