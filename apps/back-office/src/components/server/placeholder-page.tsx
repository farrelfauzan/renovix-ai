/** Body of a route whose screen a later ticket fills. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-rx-muted">Screens are filled by later tickets.</p>
    </section>
  );
}
