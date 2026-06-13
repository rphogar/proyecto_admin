import { EditorFactura } from '@/components/ventas/editor-factura';

/** Edición de un borrador de documento (carga el DRAFT en el editor para guardarlo o emitirlo). */
export default async function EditarBorradorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorFactura documentoId={id} />;
}
