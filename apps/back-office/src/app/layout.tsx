import "./global.css";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from "react";
import { SessionGate } from "@/components/client/session/session-gate";
import { BackOfficeSidebar } from "@/components/server/back-office-sidebar";
import { RenovixLogo } from "@/components/server/renovix-logo";

export const metadata = {
  title: "Renovix back-office",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <SessionGate
          publicHeader={<RenovixLogo />}
          sideNavigation={<BackOfficeSidebar />}
        >
          {children}
        </SessionGate>
      </body>
    </html>
  );
}
