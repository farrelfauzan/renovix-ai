import { useEffect, useState } from "react";

/** The state of one read: `data` once loaded, `error` (the API's message) when refused, both null while loading. */
export type ReportState<T> = { readonly data: T | null; readonly error: string | null; readonly reload: () => void };

/** Runs `load` on mount and whenever `load` changes (pass a memoised function), and again on `reload`. */
export function useReport<T>(load: () => Promise<T>): ReportState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    setData(null);
    setError(null);
    load().then(
      (result) => isCurrent && setData(result),
      (err: unknown) => isCurrent && setError(err instanceof Error ? err.message : "The request failed."),
    );
    return () => {
      isCurrent = false;
    };
  }, [load, version]);
  return { data, error, reload: () => setVersion((current) => current + 1) };
}
