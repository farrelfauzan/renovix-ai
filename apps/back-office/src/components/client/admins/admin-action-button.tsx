"use client";

import { Button } from "@performa-ai/ui/components/button";

type AdminActionButtonProps = {
  readonly label: string;
  readonly onClick: () => void;
};

/** One account action of an admin's detail: a text button (the detail is not a table row, so D406 does not apply). */
export function AdminActionButton({ label, onClick }: AdminActionButtonProps) {
  return (
    <Button variant="outline" type="button" onClick={onClick} className="h-auto rounded-rx border border-rx-line bg-transparent px-3 py-1 text-sm font-normal whitespace-normal">
      {label}
    </Button>
  );
}
