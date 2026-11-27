import { AdminDetailRoute } from "@/components/client/admins/admin-detail-route";

type AdminDetailPageProps = {
  readonly params: Promise<{ readonly adminId: string }>;
};

export default async function AdminDetailPage({ params }: AdminDetailPageProps) {
  const { adminId } = await params;
  return (
    <section>
      <h1 className="text-xl font-semibold">Admins and roles</h1>
      <AdminDetailRoute adminId={adminId} />
    </section>
  );
}
