import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ContaVE',
  description: 'Sistema administrativo-contable-fiscal multimoneda para PYMEs venezolanas',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      {/*
        suppressHydrationWarning: extensiones del navegador (Bitdefender/gestores de contraseñas)
        inyectan atributos en <body> (bis_register, __processed_*) ANTES de que React hidrate,
        provocando un falso "hydration mismatch". No es un bug de la app; esto silencia ese ruido
        solo a nivel del <body> sin afectar la detección de desajustes reales en el árbol interno.
      */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-background text-foreground antialiased"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
