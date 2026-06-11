import type { EstadoFrescura } from '@contave/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TasaDelDiaVista } from '@/components/tasa-del-dia';
import type { TasaDelDiaDto } from '@/lib/api';

function dto(frescura: EstadoFrescura, rate: string | null = '36.87340000'): TasaDelDiaDto {
  return { moneda: 'USD', fecha: '2026-06-11', rate, rateDate: '2026-06-09', source: 'BCV', frescura };
}

describe('TasaDelDiaVista', () => {
  it('muestra la tasa en formato venezolano y la fuente', () => {
    render(<TasaDelDiaVista data={dto('fresca')} isLoading={false} isError={false} />);
    expect(screen.getByText('Bs 36,87340000')).toBeInTheDocument();
    expect(screen.getByText('BCV')).toBeInTheDocument();
  });

  it('no muestra banner cuando la tasa es fresca', () => {
    render(<TasaDelDiaVista data={dto('fresca')} isLoading={false} isError={false} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('caso 57: muestra banner de advertencia cuando la tasa está rezagada', () => {
    render(<TasaDelDiaVista data={dto('rezagada')} isLoading={false} isError={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/rezago/i);
  });

  it('caso 57: banner crítico cuando no hay tasa reciente del BCV', () => {
    render(<TasaDelDiaVista data={dto('critica')} isLoading={false} isError={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/última disponible/i);
  });

  it('muestra estado de carga y de error', () => {
    const { rerender } = render(<TasaDelDiaVista data={undefined} isLoading isError={false} />);
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
    rerender(<TasaDelDiaVista data={undefined} isLoading={false} isError />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no se pudo/i);
  });
});
