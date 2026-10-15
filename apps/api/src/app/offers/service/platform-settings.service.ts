import { BadRequestException, Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { PLATFORM_SETTINGS } from "../config/platform-settings";
import { CatalogChangeRepository } from "../repository/catalog-change.repository";
import { PlatformSettingRepository } from "../repository/platform-setting.repository";
import type { PlatformSettingName } from "../types/platform-setting-name";
import type { PlatformSettingValues } from "../types/platform-setting-values";
import type { SettingChange } from "../types/setting-change";
import { buildCatalogChange } from "../utils/build-catalog-change";
import { hasSameValues } from "../utils/has-same-values";
import { isPlatformSettingName } from "../utils/is-platform-setting-name";
import { parseOrRefuse } from "../utils/parse-or-refuse";

/**
 * Typed platform settings (RX-86, docs/credits.md section 9). Every write is validated by the setting's
 * schema in the registry (config/platform-settings.ts) and writes its change record in the same transaction;
 * an unknown name or an invalid value is refused with 400 and nothing is written.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly settings: PlatformSettingRepository,
    private readonly changes: CatalogChangeRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** The setting's value, or null when it is not set. */
  async getSetting<K extends PlatformSettingName>(name: K, tx?: DbTransaction): Promise<PlatformSettingValues[K] | null> {
    const row = await this.settings.findByName(name, tx);
    return row ? (PLATFORM_SETTINGS[name].parse(row.value) as PlatformSettingValues[K]) : null;
  }

  /** Writes the setting. Writing the value it already has writes nothing. */
  async saveSetting(change: SettingChange, tx?: DbTransaction): Promise<void> {
    if (!isPlatformSettingName(change.name)) throw new BadRequestException(`Unknown platform setting "${change.name}"`);
    const value = parseOrRefuse(PLATFORM_SETTINGS[change.name], change.value, `Platform setting ${change.name}`);
    await this.transactions.run(async (db) => {
      const before = await this.settings.findByName(change.name, db);
      if (before && hasSameValues({ value: before.value }, { value })) return;
      await this.settings.upsert(change.name, value, db);
      await this.changes.create(buildCatalogChange({ entity: "platform_setting", entityId: change.name, before: before?.value, after: value, author: change.author }), db);
    }, undefined, tx);
  }
}
