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
      <Button>Comenzar</Button>
    </main>
  );
}
