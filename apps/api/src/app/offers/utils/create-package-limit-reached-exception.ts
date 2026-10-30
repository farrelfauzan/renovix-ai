import { BadRequestException } from "@nestjs/common";
import type { PackageLimitDetails } from "../types/package-limit-details";

/** The one refusal of every package gate (RNX-76): 400 with `error.type` PACKAGE_LIMIT_REACHED; the front end owns the copy. */
export const createPackageLimitReachedException = (details: PackageLimitDetails): BadRequestException =>
  new BadRequestException({ error: { type: "PACKAGE_LIMIT_REACHED", ...details } });
