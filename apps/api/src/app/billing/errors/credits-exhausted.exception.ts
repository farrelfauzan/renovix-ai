import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * I5 (docs/credits.md section 2.2): the entry would take the wallet's balance below 0 or below what its open
 * reservations hold. Nothing was written. HTTP 402 with the code CREDITS_EXHAUSTED.
 */
export class CreditsExhaustedException extends HttpException {
  constructor() {
    super(
      { statusCode: HttpStatus.PAYMENT_REQUIRED, code: "CREDITS_EXHAUSTED", message: "Not enough credits" },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
