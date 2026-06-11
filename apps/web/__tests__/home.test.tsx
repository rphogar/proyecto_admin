import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from '@/app/page';

// Home incluye el widget de tasa (TanStack Query) → requiere un QueryClientProvider.
function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Home />
    </QueryClientProvider>,
  );
}

describe('Home', () => {
  it('muestra el nombre del producto y el CTA', () => {
    renderHome();
    expect(screen.getByRole('heading', { name: 'ContaVE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comenzar' })).toBeInTheDocument();
  });
});
