import { z } from "zod";
import { TopUpPackVersionTermsDto } from "../../offers/dto/top-up-pack-version-terms.dto";
import { ChangeReasonDto } from "./change-reason.dto";
import { EffectiveFromDto } from "./effective-from.dto";

/** POST /admin/top-up-packs/:id/versions (RNX-226): the new version's terms (price in US dollar cents), why, and when it takes effect. */
export const TopUpPackVersionBodyDto = TopUpPackVersionTermsDto.extend({ reason: ChangeReasonDto, effectiveFrom: EffectiveFromDto });
export type TopUpPackVersionBodyDto = z.infer<typeof TopUpPackVersionBodyDto>;
