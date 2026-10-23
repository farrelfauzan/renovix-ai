import "./global.css";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from "react";
import { SessionGate } from "@/components/client/session/session-gate";
import { RenovixLogo } from "@/components/server/renovix-logo";
import { SideNavigation } from "@/components/client/side-navigation";

export const metadata = {
  title: "Renovix back-office",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <SessionGate
          publicHeader={<RenovixLogo />}
          sideNavigation={
            <aside className="w-full shrink-0 bg-rx-ink text-rx-ink-300 md:w-60">
              <div className="px-6 py-4">
                <RenovixLogo tone="on-dark" size={28} />
              </div>
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
