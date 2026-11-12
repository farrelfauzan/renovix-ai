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

interface McpDisconnectDialogProps {
  displayName: string;
  workspaceNames: string[];
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  onConfirmAction: () => void;
}

/** Confirms removing an account connection and names the workspaces where it is on. */
export function McpDisconnectDialog({
  displayName,
  workspaceNames,
  open,
  onOpenChangeAction,
  onConfirmAction,
}: McpDisconnectDialogProps) {
  const where =
    workspaceNames.length > 0
      ? `It is on in: ${workspaceNames.join(", ")}. Agents there lose access to it.`
      : "It is not on in any workspace.";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChangeAction}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your {displayName} connection from your account. {where}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmAction}>Disconnect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
