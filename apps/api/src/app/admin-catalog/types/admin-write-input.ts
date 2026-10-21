/** An admin-catalog write (RNX-226): the id of the row it is about, the parsed body, and the admin who makes it. */
export type AdminWriteInput<TBody> = {
  readonly id: string;
  readonly body: TBody;
  readonly adminId: string;
};
