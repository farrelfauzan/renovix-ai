import { BadRequestException, Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PLATFORM_SETTINGS } from "../../offers/config/platform-settings";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { PlatformSettingName } from "../../offers/types/platform-setting-name";
import { isPlatformSettingName } from "../../offers/utils/is-platform-setting-name";
import type { SaveSettingBodyDto } from "../dto/save-setting-body.dto";
import type { AdminWriteInput } from "../types/admin-write-input";
import type { Audited } from "../types/audited";
import type { SettingView } from "../types/setting-view";

/**
 * Typed platform settings through the admin API (RNX-226): every name of the registry (offers/config/platform-settings.ts)
 * with its value, and a write validated by the setting's schema. An unknown name or an invalid value is a 400 and
 * nothing is written. A setting without a value is shown as null: open decisions have no default.
 */
@Injectable()
export class AdminSettingsService {
  constructor(private readonly settings: PlatformSettingsService) {}

  /** Every setting of the registry, in registry order, with its value or null. */
  list(): Promise<SettingView[]> {
    const names = Object.keys(PLATFORM_SETTINGS) as PlatformSettingName[];
    return Promise.all(names.map(async (name) => ({ name, value: await this.settings.getSetting(name) })));
  }

  /** Writes the setting named `input.id`. Writing the value it already has changes nothing. */
  async save(input: AdminWriteInput<SaveSettingBodyDto>, tx: DbTransaction): Promise<Audited<SettingView>> {
    const { id: name, body, adminId } = input;
    if (!isPlatformSettingName(name)) throw new BadRequestException(`Unknown platform setting "${name}"`);
    const before = await this.settings.getSetting(name, tx);
    await this.settings.saveSetting({ name, value: body.value, author: { changedBy: adminId, reason: body.reason } }, tx);
    const after = await this.settings.getSetting(name, tx);
    return { result: { name, value: after }, change: { before: { name, value: before }, after: { name, value: after }, reason: body.reason } };
  }
}
