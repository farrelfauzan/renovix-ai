/**
 * RNX-126: the slug a restored agent gets: `slug` itself when it is not among `takenSlugs`, else the first `<slug>-<n>`
 * (n from 1, as create numbers them) that is not. Ends after at most `takenSlugs.length` tries.
 */
export function pickFreeSlug(slug: string, takenSlugs: readonly string[]): string {
  const taken = new Set(takenSlugs);
  if (!taken.has(slug)) return slug;
  let suffix = 1;
  while (taken.has(`${slug}-${suffix}`)) suffix++;
  return `${slug}-${suffix}`;
}
