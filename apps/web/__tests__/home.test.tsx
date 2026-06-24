import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import Home from '@/app/page';

// La home monta los providers reales (TanStack Query + empresa activa); este último usa el router de
// Next, que en jsdom no está montado → se mockea. El widget de tasa hace IO; con `retry:false` el
// fallo de red cae en el estado de error sin romper el render (lo cubre el e2e `home.spec.ts`).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

describe('Home', () => {
  it('muestra el nombre del producto y el acceso al negocio', () => {
    render(
      <Providers>
        <Home />
      </Providers>,
    );
    expect(screen.getByRole('heading', { name: 'ContaVE' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi negocio hoy' })).toBeInTheDocument();
  });
});
