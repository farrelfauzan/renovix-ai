import './global.css';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Renovix AI — Your Intelligent Chat & AI Agent Platform',
  description:
    'Chat with powerful AI models, deploy custom agents, and automate your daily workflow. The next-generation AI platform built for productivity.',
  openGraph: {
    title: 'Renovix AI — Chat, Create, Automate',
    description:
      'Your all-in-one AI platform. Chat naturally, build custom agents, and supercharge your workflow.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  );
}
