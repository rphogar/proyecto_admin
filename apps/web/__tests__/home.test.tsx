import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from '@/app/page';

describe('Home', () => {
  it('muestra el nombre del producto y el CTA', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'ContaVE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comenzar' })).toBeInTheDocument();
  });
});
