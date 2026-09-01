import type { Metadata, Viewport } from 'next';

import './globals.css';

import { ActingBanner } from '@/components/ActingBanner';

/**
 * The fallback title, used where no particular deck is being shown.
 *
 * It named the ISMS deck until decks became something a trainer uploads, at which
 * point a browser tab reading "ISMS Awareness Training" above a fire safety deck
 * is simply wrong. The deck pages override this with the deck's own title.
 */
export const metadata: Metadata = {
  title: 'Technavious | AI-Led Awareness Training',
  description:
    'A one to one live training session where an AI trainer presents a deck and answers questions by voice.',
};

export const viewport: Viewport = {
  themeColor: '#1b1b1d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="bg-charcoal text-mist min-h-screen antialiased">
        {/* Above every page rather than inside the header.
            
            The header is rendered from a client component on the session screen, and a
            banner that reads a cookie cannot be. Putting it here is not a workaround
            for that: the layout is where something that belongs above every page and
            below none of them actually belongs, and it renders nothing at all for
            everybody who is in their own organisation. */}
        <ActingBanner />
        {children}
      </body>
    </html>
  );
}
