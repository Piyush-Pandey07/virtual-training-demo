import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Technavious | AI-Led ISMS Awareness Training',
  description:
    'A one to one live training session where an AI trainer presents the ISO 27001 ISMS awareness deck and answers questions by voice.',
};

export const viewport: Viewport = {
  themeColor: '#1b1b1d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="bg-charcoal text-mist min-h-screen antialiased">{children}</body>
    </html>
  );
}
