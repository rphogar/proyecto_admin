import { calcularDigitoVerificadorRif, validarRif } from '@contave/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RifFeedback } from '@/components/maestros/rif-feedback';

const RIF_VALIDO = `J-30684322-${calcularDigitoVerificadorRif('J', '30684322')}`;

describe('RifFeedback (caso 16)', () => {
  it('no muestra nada cuando no hay resultado (campo vacío)', () => {
    const { container } = render(<RifFeedback resultado={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra confirmación y forma normalizada para un RIF válido', () => {
    render(<RifFeedback resultado={validarRif(RIF_VALIDO)} />);
    expect(screen.getByText(/RIF válido/i)).toBeInTheDocument();
  });

  it('explica el motivo cuando el dígito verificador no concuerda', () => {
    render(<RifFeedback resultado={{ valido: false, motivo: 'digito_verificador' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/dígito verificador/i);
  });

  it('explica el motivo cuando el formato es inválido', () => {
    render(<RifFeedback resultado={{ valido: false, motivo: 'formato_invalido' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/formato/i);
  });
});
