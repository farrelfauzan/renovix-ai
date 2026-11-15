"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@performa-ai/ui/components/alert-dialog";

interface RevokeKeyDialogProps {
  keyName: string;
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  onConfirmAction: () => void;
}

/** Confirms revoking one key. */
export function RevokeKeyDialog({ keyName, open, onOpenChangeAction, onConfirmAction }: RevokeKeyDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChangeAction}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {keyName}?</AlertDialogTitle>
          <AlertDialogDescription>Anything using this key stops working within a minute. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmAction}>Revoke</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
