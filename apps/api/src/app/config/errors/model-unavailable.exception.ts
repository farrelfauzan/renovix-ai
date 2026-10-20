import { BadRequestException } from "@nestjs/common";

/** The fixed text of every unresolvable model (RX-178, D199-3): never a slug, key, URL or provider body. */
export const MODEL_UNAVAILABLE_MESSAGE = "The requested model is not available";

/**
 * RX-178 (D199-3): the slug resolves to no usable provider record: an unknown slug, a model without a
 * provider record, or a provider that is inactive or deleted. A 400, thrown before any credit is reserved
 * and before any upstream call.
 */
export class ModelUnavailableException extends BadRequestException {
  constructor() {
    super(MODEL_UNAVAILABLE_MESSAGE);
  }
}
