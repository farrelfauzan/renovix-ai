/**
 * RNX-328: yields what `run` reports through its callback while it runs, each item as it arrives, then returns its
 * result. A failed `run` throws here once everything it reported has been yielded.
 */
export async function* yieldReported<Item, Result>(run: (report: (item: Item) => void) => Promise<Result>): AsyncGenerator<Item, Result> {
  const reported: Item[] = [];
  let isSettled = false;
  let wake = (): void => undefined;
  const settle = (): void => {
    isSettled = true;
    wake();
  };
  const result = run((item) => {
    reported.push(item);
    wake();
  });
  result.then(settle, settle);
  while (reported.length > 0 || !isSettled) {
    if (reported.length > 0) yield reported.shift() as Item;
    else await new Promise<void>((resolve) => (wake = resolve));
  }
  return result;
}
