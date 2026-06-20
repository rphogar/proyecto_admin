import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { users } from '../db/schema';
import { cifrar, claveMaestra, descifrar } from './cifrado';
import type { EstadoDosFactores } from './dos-factores';
import { decodificarBase32, generarSecreto, uriOtpauth, verificarTotp } from './totp';

const EMISOR_TOTP = 'ContaVE';

/** Resultado del inicio de enrolamiento: lo que se muestra/QR al usuario UNA sola vez. */
export interface EnrolamientoTotp {
  base32: string;
  otpauthUri: string;
}

/**
 * Gestión del segundo factor TOTP por usuario (P18, docs/05 §6). El secreto se guarda **cifrado
 * at-rest** (AES-256-GCM) en `users.totp_secret`; solo se descifra en memoria para verificar.
 * `users` es identidad global (sin RLS), por eso se consulta directo sin contexto de tenant.
 *
 * Flujo: `iniciarEnrolamiento` (genera secreto) → el usuario lo carga en su autenticador →
 * `confirmarEnrolamiento` (verifica un código y activa el 2FA). En el login, `verificar` valida
 * el código del segundo paso.
 */
@Injectable()
export class SeguridadService {
  constructor(private readonly database: DatabaseService) {}

  private clave(): Buffer {
    return claveMaestra();
  }

  /** Genera y persiste (cifrado) un nuevo secreto TOTP sin activarlo aún. */
  async iniciarEnrolamiento(userId: string): Promise<EnrolamientoTotp> {
    const [usuario] = await this.database.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (usuario === undefined) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }

    const { base32 } = generarSecreto();
    await this.database.db
      .update(users)
      .set({ totpSecret: cifrar(base32, this.clave()), totpEnabled: false, totpConfirmedAt: null })
      .where(eq(users.id, userId));

    return { base32, otpauthUri: uriOtpauth(base32, EMISOR_TOTP, usuario.email) };
  }

  /** Verifica un código contra el secreto en enrolamiento y activa el 2FA. */
  async confirmarEnrolamiento(userId: string, codigo: string, ahora = new Date()): Promise<void> {
    const base32 = await this.secretoBase32(userId);
    if (!verificarTotp(decodificarBase32(base32), codigo, ahora.getTime())) {
      throw new BadRequestException('Código TOTP inválido; no se activó el segundo factor');
    }
    await this.database.db
      .update(users)
      .set({ totpEnabled: true, totpConfirmedAt: ahora })
      .where(eq(users.id, userId));
  }

  /** Verifica el código del segundo paso de login. No muta estado. */
  async verificar(userId: string, codigo: string, ahora = new Date()): Promise<boolean> {
    const [fila] = await this.database.db
      .select({ secret: users.totpSecret, enabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (fila === undefined || !fila.enabled || fila.secret === null) {
      return false;
    }
    const base32 = descifrar(fila.secret, this.clave());
    return verificarTotp(decodificarBase32(base32), codigo, ahora.getTime());
  }

  /** Estado del 2FA del usuario (para la política de roles obligados). */
  async estado(userId: string): Promise<EstadoDosFactores> {
    const [fila] = await this.database.db
      .select({ enabled: users.totpEnabled, confirmedAt: users.totpConfirmedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (fila === undefined) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }
    return { totpHabilitado: fila.enabled, totpConfirmadoEn: fila.confirmedAt };
  }

  /** Desactiva el 2FA (p. ej. reemplazo de dispositivo, con re-enrolamiento posterior). */
  async desactivar(userId: string): Promise<void> {
    await this.database.db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false, totpConfirmedAt: null })
      .where(eq(users.id, userId));
  }

  private async secretoBase32(userId: string): Promise<string> {
    const [fila] = await this.database.db
      .select({ secret: users.totpSecret })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (fila === undefined) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }
    if (fila.secret === null) {
      throw new BadRequestException('No hay enrolamiento TOTP en curso para este usuario');
    }
    return descifrar(fila.secret, this.clave());
  }
}
