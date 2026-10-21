import { z } from "zod";
import { EnterpriseBundleVersionTermsDto } from "../../offers/dto/enterprise-bundle-version-terms.dto";
import { ChangeReasonDto } from "./change-reason.dto";
import { EffectiveFromDto } from "./effective-from.dto";

/** POST /admin/enterprise-bundles/:id/versions (RNX-226): the new version's amounts (D1 open: each may be null), why, and when. */
export const EnterpriseBundleVersionBodyDto = EnterpriseBundleVersionTermsDto.extend({ reason: ChangeReasonDto, effectiveFrom: EffectiveFromDto });
export type EnterpriseBundleVersionBodyDto = z.infer<typeof EnterpriseBundleVersionBodyDto>;
