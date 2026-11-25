const SHORT_ID_LENGTH = 8;

/** A user id as the list shows it: its first eight characters and an ellipsis; a short id is shown whole. The full id is in the detail. */
export function shortenUserId(id: string): string {
  return id.length > SHORT_ID_LENGTH ? `${id.slice(0, SHORT_ID_LENGTH)}…` : id;
}
