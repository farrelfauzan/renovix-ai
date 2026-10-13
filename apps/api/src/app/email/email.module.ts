import { Global, Module } from "@nestjs/common";
import { EmailService } from "./service/email.service";
import { EmailJobService } from "./service/email-job.service";
import { EmailTemplateService } from "./service/email-template.service";
import { EmailScheduler } from "./scheduler/email.scheduler";

@Global()
@Module({
  providers: [
    EmailService,
    EmailJobService,
    EmailTemplateService,
    EmailScheduler,
  ],
  exports: [EmailService, EmailJobService, EmailTemplateService],
})
export class EmailModule {}
