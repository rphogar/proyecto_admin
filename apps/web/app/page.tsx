import Link from 'next/link';
import { TasaDelDia } from '@/components/tasa-del-dia';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">ContaVE</h1>
      <p className="text-muted-foreground">
        Sistema administrativo-contable-fiscal multimoneda para PYMEs venezolanas. Multimoneda
        nativa (VES fiscal / USD gerencial), cumplimiento SENIAT.
      </p>
      <div className="w-full max-w-sm text-left">
        <TasaDelDia moneda="USD" />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">Mi negocio hoy</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/maestros">Gestionar maestros</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/ventas/facturas">Ventas</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/compras">Compras</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/tesoreria/posicion">Tesorería</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/nomina/trabajadores">Nómina</Link>
        </Button>
      </div>
    </main>
  );
}
