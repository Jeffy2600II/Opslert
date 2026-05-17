// Path:    src/app/layout.tsx
// Purpose: Root layout for Opslert bot app.
//          Minimal — the bot has no UI besides a simple status page.
// Used by: Next.js App Router

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Opslert — LINE Alert Bot',
  description: 'Opslert alert system for YPLABS student council',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#09090F', color: '#e2e8f0' }}>
        {children}
      </body>
    </html>
  );
}