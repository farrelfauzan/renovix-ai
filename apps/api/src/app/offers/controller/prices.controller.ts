import { Controller, Get } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { PriceListService } from "../service/price-list.service";
import type { PriceList } from "../types/price-list";

/** GET /api/v1/prices (RNX-53, D237): the public, read-only price list in rupiah. The global throttler applies. */
@Controller("prices")
export class PricesController {
  constructor(private readonly priceList: PriceListService) {}

  /** The current top-up packs and packages in rupiah, with the USD to IDR rate, its date and its source. No USD amounts. */
  @Get()
  @Access({ public: true, reason: "public price list in rupiah, no account needed to see prices (RNX-53, D237)" })
  listPrices(): Promise<PriceList> {
    return this.priceList.getPriceList();
  }
}
