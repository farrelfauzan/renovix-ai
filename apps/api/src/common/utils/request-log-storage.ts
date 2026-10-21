import { AsyncLocalStorage } from "node:async_hooks";
import type { LoggedRequest } from "../types/logged-request";

/** RNX-17: the request being handled, for the logger (set by `bindRequestLogContext`). */
export const requestLogStorage = new AsyncLocalStorage<LoggedRequest>();
