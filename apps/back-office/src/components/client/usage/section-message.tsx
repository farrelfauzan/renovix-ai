"use client";

/** A readable line for a read the API refused (e.g. 403) or a state that has no data; `role="alert"` when it is an error. */
export function SectionMessage({ text, isError = false }: { text: string; isError?: boolean }) {
  return (
    <p role={isError ? "alert" : "status"} className={`text-sm ${isError ? "text-rx-red-bar" : "text-rx-muted"}`}>
      {text}
    </p>
  );
}
