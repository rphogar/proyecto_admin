import { calcularDigitoVerificadorRif } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import {
  type DocumentoAEmitir,
  type Incumplimiento,
  validarRequisitosFactura,
} from './validar-requisitos';

/** RIF válido de prueba con dígito verificador calculado. */
function rif(tipo: 'J' | 'V', ocho: string): string {
  return `${tipo}-${ocho}-${calcularDigitoVerificadorRif(tipo, ocho)}`;
}

const RIF_EMISOR = rif('J', '00000001');
const RIF_CLIENTE = rif('J', '00000002');

/** Factura en USD que cumple TODOS los requisitos (base para mutar caso a caso). */
function facturaValida(): DocumentoAEmitir {
  return {
    tipo: 'FACTURA',
    medioEmision: 'FORMA_LIBRE',
    emisor: { razonSocial: 'Mi Empresa C.A.', rif: RIF_EMISOR, domicilioFiscal: 'Av. Principal, Caracas' },
    numeroControl: '00-00012345',
    adquirente: { esConsumidorFinal: false, rif: RIF_CLIENTE, nombre: 'Cliente C.A.', condicionIva: 'ordinario' },
    fechaEmision: '2026-06-12',
    moneda: 'USD',
    rateBcv: '40.00',
    totalVes: '4640.00',
    condicionPago: 'CONTADO',
    lineas: [
      { descripcion: 'Servicio de consultoría', cantidad: '1', precioUnitario: '100.00', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
    ],
    impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '100.00', monto: '16.00' }],
    total: '116.00',
  };
}

const codigos = (faltas: Incumplimiento[]): string[] => faltas.map((f) => f.codigo);

describe('validarRequisitosFactura (00071/00102/00121)', () => {
  it('una factura completa no tiene incumplimientos (emitible)', () => {
    expect(validarRequisitosFactura(facturaValida())).toEqual([]);
  });

  it('una factura en VES sin tasa BCV es válida (no es divisa)', () => {
    const f = facturaValida();
    const ves: DocumentoAEmitir = {
      ...f,
      moneda: 'VES',
      rateBcv: null,
      totalVes: '116.00',
    };
    expect(validarRequisitosFactura(ves)).toEqual([]);
  });

  describe('emisor', () => {
    it('exige razón social, RIF válido y domicilio', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        emisor: { razonSocial: '  ', rif: 'J-12345678-0', domicilioFiscal: null },
      };
      expect(codigos(validarRequisitosFactura(f))).toEqual(
        expect.arrayContaining(['EMISOR_SIN_RAZON_SOCIAL', 'EMISOR_RIF_INVALIDO', 'EMISOR_SIN_DOMICILIO']),
      );
    });
  });

  describe('número de control', () => {
    it('lo exige en formas libres', () => {
      const f = { ...facturaValida(), numeroControl: '' };
      expect(codigos(validarRequisitosFactura(f))).toContain('SIN_NUMERO_CONTROL');
    });

    it('NO lo exige en máquina fiscal (lo controla el hardware)', () => {
      const f: DocumentoAEmitir = { ...facturaValida(), medioEmision: 'MAQUINA_FISCAL', numeroControl: null };
      expect(codigos(validarRequisitosFactura(f))).not.toContain('SIN_NUMERO_CONTROL');
    });

    it('en imprenta digital el incumplimiento cita la 00102', () => {
      const f: DocumentoAEmitir = { ...facturaValida(), medioEmision: 'IMPRENTA_DIGITAL', numeroControl: '' };
      const falta = validarRequisitosFactura(f).find((x) => x.codigo === 'SIN_NUMERO_CONTROL');
      expect(falta?.norma).toBe('SNAT/2024/000102');
    });
  });

  describe('adquirente (casos 15 y 16)', () => {
    it('a un contribuyente le exige RIF y nombre', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        adquirente: { esConsumidorFinal: false, rif: null, nombre: null, condicionIva: 'ordinario' },
      };
      expect(codigos(validarRequisitosFactura(f))).toEqual(
        expect.arrayContaining(['ADQUIRENTE_SIN_RIF', 'ADQUIRENTE_SIN_NOMBRE']),
      );
    });

    it('rechaza un RIF de adquirente con dígito verificador inválido (caso 16)', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        adquirente: { esConsumidorFinal: false, rif: 'J-12345678-0', nombre: 'X', condicionIva: 'ordinario' },
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('ADQUIRENTE_RIF_INVALIDO');
    });

    it('permite consumidor final bajo el umbral configurado (venta al detal)', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        total: '116.00',
        totalVes: '116.00',
        umbralConsumidorFinalVes: '200.00',
        adquirente: { esConsumidorFinal: true, condicionIva: 'no_contribuyente' },
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });

    it('exige identificación si el consumidor final supera el umbral (caso 15)', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        total: '116.00',
        totalVes: '116.00',
        umbralConsumidorFinalVes: '50.00',
        adquirente: { esConsumidorFinal: true, condicionIva: 'no_contribuyente' },
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('CONSUMIDOR_FINAL_SOBRE_UMBRAL');
    });

    it('sin umbral configurado no permite consumidor final anónimo', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        adquirente: { esConsumidorFinal: true, condicionIva: 'no_contribuyente' },
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('CONSUMIDOR_FINAL_NO_PERMITIDO');
    });
  });

  describe('líneas e IVA discriminado (caso 12)', () => {
    it('exige al menos una línea', () => {
      const f: DocumentoAEmitir = { ...facturaValida(), lineas: [], impuestos: [], total: '0' };
      expect(codigos(validarRequisitosFactura(f))).toContain('SIN_LINEAS');
    });

    it('detecta líneas con cantidad/precio/descripción inválidos', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        lineas: [{ descripcion: '', cantidad: '0', precioUnitario: '-1', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      };
      expect(codigos(validarRequisitosFactura(f))).toEqual(
        expect.arrayContaining(['LINEA_SIN_DESCRIPCION', 'LINEA_CANTIDAD_INVALIDA', 'LINEA_PRECIO_INVALIDO']),
      );
    });

    it('exige discriminar la base/IVA de cada alícuota presente en las líneas', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        lineas: [
          { descripcion: 'A', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
          { descripcion: 'B', cantidad: '1', precioUnitario: '50', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
        ],
        // Falta el renglón de la alícuota REDUCIDA.
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '100', monto: '16' }],
        total: '166',
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('IVA_NO_DISCRIMINADO');
    });

    it('acepta líneas exentas sin IVA', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [{ descripcion: 'Medicina', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' }],
        impuestos: [{ alicuotaCodigo: 'EXENTO', alicuotaTasa: '0', base: '100', monto: '0' }],
        total: '100',
        totalVes: '100',
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });
  });

  describe('total y moneda', () => {
    it('detecta un total incoherente con base+IVA', () => {
      const f = { ...facturaValida(), total: '999.00' };
      expect(codigos(validarRequisitosFactura(f))).toContain('TOTAL_INCOHERENTE');
    });

    it('exige tasa BCV y equivalente en Bs para documentos en divisa', () => {
      const f: DocumentoAEmitir = { ...facturaValida(), rateBcv: null, totalVes: null };
      expect(codigos(validarRequisitosFactura(f))).toEqual(
        expect.arrayContaining(['DIVISA_SIN_TASA_BCV', 'DIVISA_SIN_EQUIVALENTE_BS']),
      );
    });

    it('exige condición de pago', () => {
      const f: DocumentoAEmitir = { ...facturaValida(), condicionPago: null };
      expect(codigos(validarRequisitosFactura(f))).toContain('SIN_CONDICION_PAGO');
    });
  });

  describe('notas de crédito/débito', () => {
    it('exigen referenciar la factura afectada (00121 art. 4)', () => {
      const f: DocumentoAEmitir = { ...facturaValida(), tipo: 'NOTA_CREDITO', documentoAfectado: null };
      expect(codigos(validarRequisitosFactura(f))).toContain('NC_ND_SIN_FACTURA_AFECTADA');
    });

    it('una NC con referencia completa es válida', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        tipo: 'NOTA_CREDITO',
        documentoAfectado: { numero: '1024', fecha: '2026-05-01', monto: '116.00' },
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });
  });

  describe('descuentos (00071 art. 6.1)', () => {
    it('rechaza un descuento negativo', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '100', descuento: '-5', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('LINEA_DESCUENTO_INVALIDO');
    });

    it('rechaza un descuento que supera el subtotal de la línea', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '100', descuento: '200', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('LINEA_DESCUENTO_INVALIDO');
    });

    it('acepta un descuento válido dentro del subtotal', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [{ descripcion: 'A', cantidad: '2', precioUnitario: '100', descuento: '50', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '150', monto: '24' }],
        total: '174',
        totalVes: '174',
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });
  });

  describe('coherencia código ↔ tasa (casos 12 y 22)', () => {
    it('rechaza una línea GENERAL con tasa 0%', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '0' }],
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('LINEA_TASA_INCOHERENTE');
    });

    it('rechaza una línea EXENTA/EXPORTACIÓN con tasa distinta de 0%', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'EXPORTACION', alicuotaTasa: '16' }],
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('LINEA_TASA_INCOHERENTE');
    });

    it('rechaza un renglón de impuesto que causa IVA con tasa 0%', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '0', base: '100', monto: '0' }],
        total: '100',
        totalVes: '100',
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('IMPUESTO_TASA_INCOHERENTE');
    });

    it('detecta un IVA discriminado que no coincide con base × tasa', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        // 100 × 16% = 16, pero se declara 5.
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '100', monto: '5' }],
        total: '105',
        totalVes: '105',
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('IMPUESTO_MONTO_INCOHERENTE');
    });
  });

  describe('factura multi-alícuota emitible (caso 12)', () => {
    it('16% + 8% + exento, discriminados y cuadrados, no tiene incumplimientos', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [
          { descripcion: 'Gravado 16', cantidad: '2', precioUnitario: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
          { descripcion: 'Gravado 8', cantidad: '3', precioUnitario: '500', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
          { descripcion: 'Exento', cantidad: '1', precioUnitario: '800', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
        ],
        impuestos: [
          { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '2000', monto: '320' },
          { alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8', base: '1500', monto: '120' },
          { alicuotaCodigo: 'EXENTO', alicuotaTasa: '0', base: '800', monto: '0' },
        ],
        total: '4740',
        totalVes: '4740',
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });

    it('una alícuota a 16,5% por cambio de vigencia es emitible (caso 14)', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16.5' }],
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16.5', base: '1000', monto: '165' }],
        total: '1165',
        totalVes: '1165',
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });
  });

  describe('exportación 0% (caso 22)', () => {
    it('una exportación 0% sin IVA es emitible y no exige tasa BCV (VES)', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'VES',
        rateBcv: null,
        lineas: [{ descripcion: 'Mercancía exportada', cantidad: '1', precioUnitario: '5000', alicuotaCodigo: 'EXPORTACION', alicuotaTasa: '0' }],
        impuestos: [{ alicuotaCodigo: 'EXPORTACION', alicuotaTasa: '0', base: '5000', monto: '0' }],
        total: '5000',
        totalVes: '5000',
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });
  });

  describe('divisa con doble conversión (caso 23)', () => {
    it('una factura en EUR con contravalor en Bs coherente es emitible', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'EUR',
        rateBcv: '44.00',
        lineas: [{ descripcion: 'Servicio', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '100', monto: '16' }],
        total: '116.00',
        totalVes: '5104.00', // 116 EUR × 44 Bs/EUR
      };
      expect(validarRequisitosFactura(f)).toEqual([]);
    });

    it('detecta un equivalente en Bs que no corresponde al total × tasa BCV', () => {
      const f: DocumentoAEmitir = {
        ...facturaValida(),
        moneda: 'EUR',
        rateBcv: '44.00',
        lineas: [{ descripcion: 'Servicio', cantidad: '1', precioUnitario: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        impuestos: [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '100', monto: '16' }],
        total: '116.00',
        totalVes: '4000.00', // ≠ 116 × 44 = 5104
      };
      expect(codigos(validarRequisitosFactura(f))).toContain('DIVISA_CONTRAVALOR_INCOHERENTE');
    });
  });

  it('los documentos no fiscales (presupuesto) no se validan como factura', () => {
    const f: DocumentoAEmitir = { ...facturaValida(), tipo: 'PRESUPUESTO', emisor: { razonSocial: null, rif: null, domicilioFiscal: null } };
    expect(validarRequisitosFactura(f)).toEqual([]);
  });
});
