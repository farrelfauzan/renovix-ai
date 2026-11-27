"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@performa-ai/ui/components/dialog";
import { MAX_REASON_LENGTH } from "@/lib/admins/max-reason-length";
import type { ReasonRequest } from "@/lib/admins/reason-request";
import { LabeledInput } from "../form/labeled-input";

type ReasonDialogProps = {
  /** The write waiting for its reason: the title names it. */
  readonly request: ReasonRequest;
  readonly onClose: () => void;
};

/**
 * Asks for the reason of an admin write that has no form of its own (RNX-370): the API requires one and stores it on
 * the write's audit row. Confirm stays disabled while the reason is empty or only spaces, so no request fires; Esc,
 * the close button and Cancel close it and nothing is sent. Confirm closes it, then runs the write with the reason.
 */
export function ReasonDialog({ request, onClose }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const isEmpty = reason.trim() === "";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isEmpty) return;
    onClose();
    request.confirm(reason.trim());
  };
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="rounded-rx border-rx-line bg-rx-white sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="break-all">{request.title}</DialogTitle>
            <DialogDescription>Give the reason for this change. It is stored in the audit log.</DialogDescription>
          </DialogHeader>
          <LabeledInput label="Reason (required, audited)" name="reason" isRequired maxLength={MAX_REASON_LENGTH} value={reason} onChange={setReason} />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Cancel</Button>
            <Button type="submit" disabled={isEmpty} className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent h-auto font-normal whitespace-normal hover:bg-rx-accent-hover">Confirm</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
