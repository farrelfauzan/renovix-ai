/** RNX-17: the request fields every log line written while a request is handled carries. */
export interface RequestLogFields {
  readonly requestId: string;
  /** The route pattern (e.g. `/api/v1/chat/completions`, `/agents/:id`), never the raw URL with ids or a query string. */
  readonly route?: string;
  /** The signed-in product user (JWT, session, API key or portal user), once the guard has attached it. */
  readonly accountId?: string;
  /** The signed-in back-office admin on a `staff` route, once AccessGuard has attached it. */
  readonly adminId?: string;
}
