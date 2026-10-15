import "./global.css";
import type { ReactNode } from "react";
import { SideNavigation } from "@/components/client/side-navigation";

export const metadata = {
  title: "Renovix back-office",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r border-neutral-200">
            <div className="px-6 py-4 font-semibold">Renovix back-office</div>
            <SideNavigation />
          </aside>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
