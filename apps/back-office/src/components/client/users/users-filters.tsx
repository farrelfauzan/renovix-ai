"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { UserListQuery } from "@/lib/users/user-list-query";
import type { UserStatus } from "@/lib/users/user-status";

/** The value of the "any" option of both filters (a Select item cannot have an empty value). */
const ANY = "any";
const STATUS_OPTIONS: readonly { readonly value: UserStatus; readonly label: string }[] = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "locked", label: "Locked (no available credits)" },
];
const TRIGGER = "h-9 rounded-rx border-rx-line bg-rx-ground px-2 text-[13px] data-[size=default]:h-9";

type UsersFiltersProps = {
  /** The packages for the package filter; null hides it (no `packages:read`, or the list did not load). */
  readonly packages: readonly CatalogOffer[] | null;
  readonly packageId?: string;
  readonly status?: UserStatus;
  /** Runs on submit only (Enter or Search), never per keystroke. */
  readonly onSearch: (text: string) => void;
  readonly onFilter: (change: Partial<UserListQuery>) => void;
};

/** The header controls of the user list: the exact email or id search, and the package and status filters. */
export function UsersFilters({ packages, packageId, status, onSearch, onFilter }: UsersFiltersProps) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(text);
  };
  return (
    <form role="search" aria-label="Find users" onSubmit={submit} className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <Input
        type="search"
        aria-label="Exact email or user id"
        placeholder="Exact email or user id (no partial match)"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="h-9 w-80 max-w-full rounded-rx border-rx-line px-2.5 text-[13px] md:text-[13px]"
      />
      {packages && (
        <Select value={packageId ?? ANY} onValueChange={(value) => onFilter({ packageId: value === ANY ? undefined : value })}>
          <SelectTrigger aria-label="Package" className={TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any package</SelectItem>
            {packages.map((offer) => <SelectItem key={offer.id} value={offer.id}>{offer.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={status ?? ANY} onValueChange={(value) => onFilter({ status: STATUS_OPTIONS.find((option) => option.value === value)?.value })}>
        <SelectTrigger aria-label="Status" className={TRIGGER}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any status</SelectItem>
          {STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" type="submit" className="h-9 rounded-rx border-rx-line bg-transparent px-3.5 text-[13px] font-medium">
        Search
      </Button>
    </form>
  );
}
