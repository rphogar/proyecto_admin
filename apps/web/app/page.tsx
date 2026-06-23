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
      <div className="grid w-full max-w-2xl gap-4 text-left sm:grid-cols-2">
        <TasaDelDia moneda="USD" />
        <TasaDelDia moneda="EUR" />
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
        <Button variant="outline" asChild>
          <Link href="/impuestos/iva">Impuestos</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/portal">Portal del contador</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/configuracion/usuarios">Usuarios y roles</Link>
        </Button>
      </div>
    </main>
  );
}
