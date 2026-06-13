import { EditorFactura } from '@/components/ventas/editor-factura';

/**
 * Nueva factura / NC / ND. Acepta `?nota=credito|debito&afecta=<id>` para abrir el editor en modo
 * nota referenciando la factura afectada (asistente desde el listado).
 */
export default async function NuevaFacturaPage({
  searchParams,
}: {
  searchParams: Promise<{ nota?: string; afecta?: string }>;
}) {
  const { nota, afecta } = await searchParams;
  const tipo = nota === 'credito' ? 'NOTA_CREDITO' : nota === 'debito' ? 'NOTA_DEBITO' : 'FACTURA';
  return <EditorFactura tipo={tipo} affectedDocumentId={afecta} />;
}
