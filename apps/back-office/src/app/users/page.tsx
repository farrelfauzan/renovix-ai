import { UsersScreen } from "@/components/client/users/users-screen";

export default function UsersPage() {
  return (
    <section className="w-0 min-w-full">
      <UsersScreen heading={<h1 className="text-base font-semibold">Users</h1>} />
    </section>
  );
}
