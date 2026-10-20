/** The API refused a sign-in or enrolment request; `message` is the API's own message, shown as it is. */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedError";
  }
}
