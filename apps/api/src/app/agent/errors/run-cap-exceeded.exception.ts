import { HttpException, HttpStatus } from "@nestjs/common";
import type { Decimal } from "@prisma/client/runtime/client";

/**
 * docs/credits.md section 13.2: the root agent's first model call alone does not fit under the per-run credit cap,
 * so the run is refused before it starts, with a message that names the cap. Nothing was reserved. HTTP 402.
 */
export class RunCapExceededException extends HttpException {
  constructor(cap: Decimal) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: "RUN_CAP_EXCEEDED",
        message: `This message needs more than the per-run credit cap of ${cap.toFixed()} credits`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
