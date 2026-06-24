'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { login, login2fa } from '@/lib/auth-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { PARAM_SESION_EXPIRADA } from '@/lib/sesion-eventos';

/**
 * Login real (P28): email + password y, si el usuario tiene 2FA, un segundo paso con el código
 * TOTP. Reemplaza al login demo retirado. Al entrar, fija la sesión (token acotado al tenant) y
 * redirige al dashboard. El selector de empresa permite luego cambiar de empresa.
 */
export default function LoginPage() {
  const router = useRouter();
  const { iniciarSesion } = useEmpresaActiva();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reto, setReto] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expirada, setExpirada] = useState(false);

  // Aviso de "sesión expirada": el guardia redirige aquí con `?expirada=1` tras un 401. Se lee del
  // `window` en un efecto (no `useSearchParams`) para no exigir un límite de Suspense en build.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setExpirada(params.get(PARAM_SESION_EXPIRADA) === '1');
  }, []);

  const entrar = async (emitida: Parameters<typeof iniciarSesion>[0]) => {
    await iniciarSesion(emitida);
    router.push('/dashboard');
  };

  const onSubmitCredenciales = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const r = await login(email, password);
      if (r.requiere2fa) {
        setReto(r.reto);
      } else {
        await entrar(r);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setCargando(false);
    }
  };

  const onSubmit2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reto === null) {
      return;
    }
    setCargando(true);
    setError(null);
    try {
      await entrar(await login2fa(reto, codigo));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido');
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Ingresar a ContaVE</h1>

      {expirada && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Tu sesión expiró por seguridad. Vuelve a iniciar sesión para continuar.
        </p>
      )}

      {reto === null ? (
        <form onSubmit={(e) => void onSubmitCredenciales(e)} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="email">
            Correo
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className="text-sm font-medium" htmlFor="password">
            Contraseña
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={cargando} className="mt-2">
            {cargando ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void onSubmit2fa(e)} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Ingresá el código de tu app de autenticación.
          </p>
          <label className="text-sm font-medium" htmlFor="codigo">
            Código 2FA
          </label>
          <Input
            id="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
          />
          <Button type="submit" disabled={cargando} className="mt-2">
            {cargando ? 'Verificando…' : 'Verificar'}
          </Button>
        </form>
      )}

      {error !== null && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </main>
  );
}
