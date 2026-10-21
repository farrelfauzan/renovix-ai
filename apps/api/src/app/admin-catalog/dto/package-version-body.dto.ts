import { z } from "zod";
import { PackageVersionTermsDto } from "../../offers/dto/package-version-terms.dto";
import { ChangeReasonDto } from "./change-reason.dto";
import { EffectiveFromDto } from "./effective-from.dto";

/** POST /admin/packages/:id/versions (RNX-226): the new version's terms (price in US dollar cents), why, and when it takes effect. */
export const PackageVersionBodyDto = PackageVersionTermsDto.extend({ reason: ChangeReasonDto, effectiveFrom: EffectiveFromDto });
export type PackageVersionBodyDto = z.infer<typeof PackageVersionBodyDto>;
