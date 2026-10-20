/** The API refused a sign-in or enrolment request; `message` is the API's own message, shown as it is. */
export class RefusedError extends Error {
  /** The HTTP status of the refusal, when the API answered. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "RefusedError";
    this.status = status;
  }
}
