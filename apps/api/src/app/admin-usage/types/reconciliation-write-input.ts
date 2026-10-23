import type { ReconciliationEntryBodyDto } from "../dto/reconciliation-entry-body.dto";

/** One portal balance to record (RNX-228): the parsed body and the admin who enters it. */
export type ReconciliationWriteInput = {
  readonly body: ReconciliationEntryBodyDto;
  readonly adminId: string;
};
