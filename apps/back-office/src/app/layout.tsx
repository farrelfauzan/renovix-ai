import "./global.css";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from "react";
import { SessionGate } from "@/components/client/session/session-gate";
import { BackOfficePublicHeader } from "@/components/server/back-office-public-header";
import { BackOfficeSidebar } from "@/components/server/back-office-sidebar";

export const metadata = {
  title: "Renovix back-office",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <SessionGate
          publicHeader={<BackOfficePublicHeader />}
          sideNavigation={<BackOfficeSidebar />}
        >
          {children}
        </SessionGate>
      </body>
    </html>
  );
}
