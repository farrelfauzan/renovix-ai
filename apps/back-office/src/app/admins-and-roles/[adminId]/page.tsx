import { AdminDetailScreen } from "@/components/client/admins/admin-detail-screen";

type AdminDetailPageProps = {
  readonly params: Promise<{ readonly adminId: string }>;
};

export default async function AdminDetailPage({ params }: AdminDetailPageProps) {
  const { adminId } = await params;
  return (
    <section>
      <h1 className="text-xl font-semibold">Admins and roles</h1>
      <AdminDetailScreen adminId={adminId} />
    </section>
  );
}
