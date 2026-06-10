import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ContaVE',
  description: 'Sistema administrativo-contable-fiscal multimoneda para PYMEs venezolanas',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
