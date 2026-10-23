import type { EmailRevealBodyDto } from "../dto/email-reveal-body.dto";

/** One email reveal (RNX-228): whose email, and the parsed body with the reason. */
export type EmailRevealInput = {
  readonly userId: string;
  readonly body: EmailRevealBodyDto;
};
