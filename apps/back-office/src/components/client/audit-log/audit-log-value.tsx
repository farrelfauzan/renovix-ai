"use client";

/** A before or after value of an audit row (RX-164), as indented JSON. */
export function AuditLogValue({ value }: { value: unknown }) {
  return <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>;
}
