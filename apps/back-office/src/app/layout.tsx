import "./global.css";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from "react";
import { SessionGate } from "@/components/client/session/session-gate";
import { SideNavigation } from "@/components/client/side-navigation";

export const metadata = {
  title: "Renovix back-office",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <SessionGate
          sideNavigation={
            <aside className="w-60 shrink-0 border-r border-neutral-200">
              <div className="px-6 py-4 font-semibold">Renovix back-office</div>
              <SideNavigation />
            </aside>
          }
        >
          {children}
        </SessionGate>
      </body>
    </html>
  );
}
