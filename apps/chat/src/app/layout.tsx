import './global.css';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { ProfileGate } from "@/components/profile-gate";

export const metadata = {
  title: "Renovix AI Chat",
  description: "AI Chat Portal powered by Renovix AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers><ProfileGate><AppShell>{children}</AppShell></ProfileGate></Providers>
      </body>
    </html>
  );
}
