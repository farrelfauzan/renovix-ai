"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@performa-ai/ui/components/dialog";
import type { AuditLogRow } from "@/lib/audit-log/audit-log-row";
import { AuditLogValue } from "./audit-log-value";

type AuditLogEntryDialogProps = {
  readonly row: AuditLogRow;
  readonly onClose: () => void;
  /** Puts the focus back on what opened the dialog (the shared Dialog does it only for its own trigger). */
  readonly onReturnFocus: () => void;
};

/**
 * The detail of one audit entry in a modal (RNX-371, D446), from the row the list already holds: no request of its
 * own. Personal data is as the API returned it (masked unless `users:read_pii`). The close button, Esc or a click
 * outside closes it; the shared Dialog traps the focus, and `onReturnFocus` gives it back to the row's button.
 */
export function AuditLogEntryDialog({ row, onClose, onReturnFocus }: AuditLogEntryDialogProps) {
  const returnFocus = (event: Event) => {
    event.preventDefault();
    onReturnFocus();
  };
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent onCloseAutoFocus={returnFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-rx border-rx-line sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all pr-6 leading-snug">
            Audit entry <span className="font-mono">{row.id}</span>
          </DialogTitle>
          <DialogDescription>Recorded as shown; personal data is masked unless your role may see it.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] min-[700px]:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="text-rx-muted">Admin</dt>
          <dd>{row.adminEmail} <span className="font-mono text-rx-muted">({row.adminId})</span></dd>
          <dt className="text-rx-muted">Resource</dt>
          <dd>{row.resource}</dd>
          <dt className="text-rx-muted">Action</dt>
          <dd>{row.action}</dd>
          <dt className="text-rx-muted">Reason</dt>
          <dd>{row.reason}</dd>
          <dt className="text-rx-muted">Effective time</dt>
          <dd>{row.effectiveAt}</dd>
          <dt className="text-rx-muted">Recorded time</dt>
          <dd>{row.createdAt}</dd>
          <dt className="text-rx-muted">Request id</dt>
          <dd className="font-mono">{row.requestId}</dd>
        </dl>
        <div className="grid grid-cols-1 gap-4 min-[700px]:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-1 text-sm font-medium">Before</h3>
            <AuditLogValue value={row.before} />
          </div>
          <div className="min-w-0">
            <h3 className="mb-1 text-sm font-medium">After</h3>
            <AuditLogValue value={row.after} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
