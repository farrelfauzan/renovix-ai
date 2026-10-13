import { Global, Module } from "@nestjs/common";
import { GuardrailService } from "./service/guardrail.service";
import { InputGuardrailService } from "./service/input-guardrail.service";
import { OutputGuardrailService } from "./service/output-guardrail.service";
import { InjectionDetectorService } from "./service/injection-detector.service";
import { ContentPolicyService } from "./service/content-policy.service";
import { PiiDetectorService } from "./service/pii-detector.service";
import { ViolationTrackerService } from "./service/violation-tracker.service";

@Global()
@Module({
  providers: [
    GuardrailService,
    InputGuardrailService,
    OutputGuardrailService,
    InjectionDetectorService,
    ContentPolicyService,
    PiiDetectorService,
    ViolationTrackerService,
  ],
  exports: [GuardrailService],
})
export class GuardrailModule {}
