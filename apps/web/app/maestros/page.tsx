import Link from 'next/link';

/** Índice del módulo Maestros (doc 06 §M12). */
export default function MaestrosIndex() {
  const modulos = [
    { href: '/maestros/parties', titulo: 'Terceros', desc: 'Clientes y proveedores con RIF y condición tributaria.' },
    { href: '/maestros/items', titulo: 'Ítems', desc: 'Productos y servicios con categoría de alícuota.' },
    { href: '/maestros/price-lists', titulo: 'Listas de precios', desc: 'Precios multimoneda por lista.' },
    { href: '/maestros/warehouses', titulo: 'Almacenes', desc: 'Depósitos para el kardex de inventario.' },
    { href: '/maestros/payment-methods', titulo: 'Métodos de pago', desc: 'Mapeo a cuentas contables e IGTF.' },
    { href: '/maestros/series', titulo: 'Series de documentos', desc: 'Numeración consecutiva sin huecos.' },
  ];
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Maestros</h1>
        <p className="text-sm text-muted-foreground">
          Datos maestros de la empresa activa (docs/05 §3.2 y §3.4).
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {modulos.map((m) => (
          <Link key={m.href} href={m.href} className="rounded-lg border p-4 transition-colors hover:bg-accent/40">
            <p className="font-medium">{m.titulo}</p>
            <p className="text-sm text-muted-foreground">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
