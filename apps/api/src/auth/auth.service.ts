import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { instanteCaracasISO } from '@contave/shared';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { authEvents, passwordResetTokens, refreshTokens, users } from '../db/schema';
import { ControlBloqueoLogin } from '../seguridad/control-bloqueo-login';
import { claveJwt, firmarJwt, verificarJwt } from '../seguridad/jwt';
import { hashPassword, verifyPassword } from '../seguridad/password';
import { type MembresiaEmpresa, PermisosService } from '../seguridad/permisos.service';
import { SeguridadService } from '../seguridad/seguridad.service';
import {
  clasificarRefresh,
  generarRefreshToken,
  hashRefreshToken,
} from './tokens-sesion';

/** TTL del access token (segundos). Sesión corta (docs/05 §6). Configurable por entorno. */
function ttlAccessSeg(): number {
  return Number(process.env.AUTH_ACCESS_TTL ?? 900); // 15 min
}
/** TTL del refresh token (segundos). Rotativo y revocable. */
function ttlRefreshSeg(): number {
  return Number(process.env.AUTH_REFRESH_TTL ?? 7 * 24 * 60 * 60); // 7 días
}
/** TTL del reto 2FA entre el paso 1 (password) y el paso 2 (código). */
const TTL_RETO_2FA_SEG = 300; // 5 min
/** TTL del token de recuperación de contraseña. */
const TTL_RESET_MS = 30 * 60_000; // 30 min

/** Contexto del solicitante para auditoría (lo pasa el controlador). */
export interface OrigenPeticion {
  ip: string | undefined;
  device: string | undefined;
}

/** Par de tokens de una sesión emitida. */
export interface ParSesion {
  accessToken: string;
  refreshToken: string;
  expiraEnSeg: number;
}

/**
 * Sesión acotada a un tenant (P28): el par de tokens + la empresa activa a la que está acotado el
 * access (`tid`) y la lista de empresas del usuario para el selector. La emite el login y el cambio
 * de empresa.
 */
export interface SesionEmitida extends ParSesion {
  tenantActivo: string;
  empresas: MembresiaEmpresa[];
}

/** Resultado del paso 1 del login: o exige 2FA (reto), o ya entrega la sesión acotada. */
export type ResultadoLogin =
  | { requiere2fa: true; reto: string }
  | ({ requiere2fa: false } & SesionEmitida);

/**
 * Autenticación de identidad (P27, docs/05 §6). Login con Argon2, sesión por access JWT corto +
 * refresh rotativo revocable, logout, recuperación y 2FA TOTP (P18) como segundo paso. La
 * verificación de credenciales es PRE-tenant (opera sobre `users`, identidad global sin RLS); pero
 * la sesión que se emite YA va **acotada a un tenant** (P28): el access lleva `tid` y la sesión
 * recuerda su tenant en `refresh_tokens.tenant_id`. El login ata a la primera empresa del usuario y
 * `cambiarEmpresa` re-emite acotado a otra membresía válida (`memberships`). Todo se audita en
 * `auth_events`.
 *
 * El lockout vive en memoria del proceso (igual que el rate-limit de P18); en multi-instancia su
 * backend se sustituye por Redis conservando `ControlBloqueoLogin`.
 */
@Injectable()
export class AuthService {
  private readonly bloqueo = new ControlBloqueoLogin();

  constructor(
    private readonly database: DatabaseService,
    private readonly seguridad: SeguridadService,
    private readonly permisos: PermisosService,
  ) {}

  // ── Login (paso 1: email + password) ────────────────────────────────────────────────────────
  async login(
    email: string,
    password: string,
    origen: OrigenPeticion,
    ahora: Date = new Date(),
  ): Promise<ResultadoLogin> {
    const correo = email.trim().toLowerCase();
    const claveBloqueo = `${correo}|${origen.ip ?? 'sin-ip'}`;

    if (this.bloqueo.estado(claveBloqueo, ahora.getTime()).bloqueado) {
      await this.auditar({ tipo: 'lockout', emailIntentado: correo, origen, ahora });
      throw new HttpException(
        { codigo: 'CUENTA_BLOQUEADA', message: 'Demasiados intentos fallidos; reintentá más tarde' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [usuario] = await this.database.db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        totpEnabled: users.totpEnabled,
      })
      .from(users)
      .where(eq(users.email, correo))
      .limit(1);

    // Verificación de credenciales con respuesta uniforme (no revela si el email existe).
    const hashGuardado = usuario?.passwordHash ?? null;
    const passwordOk =
      hashGuardado !== null && (await verifyPassword(hashGuardado, password));
    if (usuario === undefined || usuario.status !== 'active' || !passwordOk) {
      this.bloqueo.registrarFallo(claveBloqueo, ahora.getTime());
      await this.auditar({
        tipo: 'login_fail',
        emailIntentado: correo,
        userId: usuario?.id ?? null,
        origen,
        ahora,
      });
      throw new UnauthorizedException({
        codigo: 'CREDENCIALES_INVALIDAS',
        message: 'Email o contraseña incorrectos',
      });
    }

    // TODO(verificacion-email): cuando exista la verificación de email (P29), exigir aquí que
    // `usuario.email_verified` sea true antes de emitir la sesión.

    this.bloqueo.reiniciar(claveBloqueo);

    // 2FA como segundo paso: si el usuario ya enroló TOTP, no se entrega la sesión todavía; se
    // emite un reto corto que el paso 2 canjea con el código (P18 `SeguridadService.verificar`).
    if (usuario.totpEnabled) {
      const reto = firmarJwt({ sub: usuario.id, scope: '2fa' }, claveJwt(), {
        ttlSeg: TTL_RETO_2FA_SEG,
        ahoraMs: ahora.getTime(),
      });
      await this.auditar({ tipo: 'login_ok', userId: usuario.id, origen, ahora, metadata: { paso: '2fa-requerido' } });
      return { requiere2fa: true, reto };
    }

    // Nota: un rol privilegiado (owner/admin/contador) que aún no enroló 2FA SÍ puede autenticarse
    // aquí (es identidad, pre-tenant), pero el `DosFactoresGuard` de P18 le bloquea las acciones
    // protegidas hasta que complete el enrolamiento.
    const sesion = await this.emitirSesionInicial(usuario.id, origen, ahora);
    await this.auditar({ tipo: 'login_ok', userId: usuario.id, origen, ahora });
    return { requiere2fa: false, ...sesion };
  }

  // ── Login (paso 2: código 2FA) ──────────────────────────────────────────────────────────────
  async login2fa(
    reto: string,
    codigo: string,
    origen: OrigenPeticion,
    ahora: Date = new Date(),
  ): Promise<SesionEmitida> {
    const claims = verificarJwt(reto, claveJwt(), ahora.getTime());
    if (claims === null || claims.scope !== '2fa') {
      throw new UnauthorizedException({ codigo: 'RETO_2FA_INVALIDO', message: 'Reto de 2FA inválido o expirado' });
    }
    const ok = await this.seguridad.verificar(claims.sub, codigo, ahora);
    if (!ok) {
      await this.auditar({ tipo: '2fa_fail', userId: claims.sub, origen, ahora });
      throw new UnauthorizedException({ codigo: 'CODIGO_2FA_INVALIDO', message: 'Código de verificación inválido' });
    }
    const sesion = await this.emitirSesionInicial(claims.sub, origen, ahora);
    await this.auditar({ tipo: 'login_ok', userId: claims.sub, origen, ahora, metadata: { paso: '2fa-ok' } });
    return sesion;
  }

  // ── Refresh rotativo (con detección de robo) ────────────────────────────────────────────────
  async refrescar(refreshToken: string, origen: OrigenPeticion, ahora: Date = new Date()): Promise<ParSesion> {
    const tokenHash = hashRefreshToken(refreshToken);
    const [fila] = await this.database.db
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        tenantId: refreshTokens.tenantId,
        familyId: refreshTokens.familyId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        rotatedTo: refreshTokens.rotatedTo,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (fila === undefined) {
      throw new UnauthorizedException({ codigo: 'REFRESH_INVALIDO', message: 'Refresh token inválido' });
    }

    const clase = clasificarRefresh(
      { expiresAt: fila.expiresAt, revokedAt: fila.revokedAt, rotatedTo: fila.rotatedTo },
      ahora,
    );
    if (clase.tipo === 'reuso') {
      // Reuso de un token ya rotado/revocado: posible robo → revocar TODA la familia.
      await this.revocarFamilia(fila.familyId, ahora);
      await this.auditar({ tipo: 'refresh_reuse', userId: fila.userId, origen, ahora, metadata: { familyId: fila.familyId } });
      throw new UnauthorizedException({ codigo: 'REFRESH_REUSO', message: 'Sesión invalidada por reuso de token' });
    }
    if (clase.tipo === 'expirado') {
      throw new UnauthorizedException({ codigo: 'REFRESH_EXPIRADO', message: 'Refresh token expirado' });
    }

    // El nuevo access hereda el tenant de la sesión (P28). Si la fila es previa a P28 (sin tenant),
    // se reacota al tenant por defecto del usuario.
    const tenantActivo = fila.tenantId ?? (await this.tenantPorDefecto(fila.userId));

    // Rotación atómica: marca el actual como rotado al sucesor y emite el nuevo par en la familia.
    return this.database.db.transaction(async (tx) => {
      const { par, refreshId } = await this.emitirSesion(
        fila.userId,
        fila.familyId,
        tenantActivo,
        origen,
        ahora,
        tx,
      );
      await tx
        .update(refreshTokens)
        .set({ rotatedTo: refreshId })
        .where(eq(refreshTokens.id, fila.id));
      await this.auditar({ tipo: 'refresh_rotate', userId: fila.userId, origen, ahora, tx });
      return par;
    });
  }

  // ── Cambio de empresa (re-emite un token acotado a otra membresía) ──────────────────────────────
  /**
   * Cambia la empresa/tenant activa de un usuario con varias membresías (P28, docs/05 §2). Valida
   * que exista membresía ACTIVA en el tenant destino (contra `memberships`, la fuente autoritativa);
   * si no la hay, audita el intento y rechaza con 403 — **es imposible forzar un tenant sin
   * membresía**. Si la hay, emite una **sesión nueva** (otra `family_id`) acotada al tenant destino.
   * La sesión anterior se deja vivir (sesiones independientes; expiran solas).
   */
  async cambiarEmpresa(
    userId: string,
    tenantDestino: string,
    origen: OrigenPeticion,
    ahora: Date = new Date(),
  ): Promise<SesionEmitida> {
    const rol = await this.permisos.rolDelActor(tenantDestino, userId);
    if (rol === null) {
      await this.auditar({
        tipo: 'cambio_empresa_denegado',
        userId,
        origen,
        ahora,
        metadata: { tenantDestino },
      });
      throw new ForbiddenException({
        codigo: 'SIN_MEMBRESIA',
        message: 'No tenés una membresía activa en esa empresa',
      });
    }
    const sesion = await this.emitirSesionEmpresa(userId, tenantDestino, origen, ahora);
    await this.auditar({
      tipo: 'cambio_empresa',
      userId,
      origen,
      ahora,
      metadata: { tenantDestino, rol },
    });
    return sesion;
  }

  // ── Logout (revoca el refresh presentado y su familia) ──────────────────────────────────────
  async logout(refreshToken: string, origen: OrigenPeticion, ahora: Date = new Date()): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    const [fila] = await this.database.db
      .select({ userId: refreshTokens.userId, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (fila === undefined) {
      return; // logout idempotente: un token desconocido no es error
    }
    await this.revocarFamilia(fila.familyId, ahora);
    await this.auditar({ tipo: 'logout', userId: fila.userId, origen, ahora });
  }

  // ── Recuperación de contraseña ──────────────────────────────────────────────────────────────
  /**
   * Solicita la recuperación. Responde igual exista o no el email (anti-enumeración). Devuelve el
   * token en claro SOLO en desarrollo (sin mailer); en producción se enviaría por correo.
   */
  async solicitarRecuperacion(
    email: string,
    origen: OrigenPeticion,
    ahora: Date = new Date(),
  ): Promise<{ tokenDev?: string }> {
    const correo = email.trim().toLowerCase();
    const [usuario] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, correo))
      .limit(1);

    if (usuario === undefined) {
      return {}; // no se revela que el email no existe
    }

    const token = generarRefreshToken(); // secreto opaco reutilizando el generador
    await this.database.db.insert(passwordResetTokens).values({
      userId: usuario.id,
      tokenHash: token.hash,
      expiresAt: new Date(ahora.getTime() + TTL_RESET_MS),
    });
    await this.auditar({ tipo: 'reset_request', userId: usuario.id, origen, ahora });

    // TODO(email): enviar el enlace de recuperación por correo cuando exista el mailer. Hasta
    // entonces, en desarrollo se devuelve el token para poder probar el flujo (nunca en prod).
    if (process.env.NODE_ENV !== 'production') {
      return { tokenDev: token.valor };
    }
    return {};
  }

  /** Confirma la recuperación: valida el token de un solo uso, cambia la clave y revoca sesiones. */
  async confirmarRecuperacion(
    token: string,
    nuevaPassword: string,
    origen: OrigenPeticion,
    ahora: Date = new Date(),
  ): Promise<void> {
    const tokenHash = hashRefreshToken(token);
    const [fila] = await this.database.db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (fila === undefined || fila.usedAt !== null || fila.expiresAt.getTime() <= ahora.getTime()) {
      throw new UnauthorizedException({ codigo: 'RESET_INVALIDO', message: 'Token de recuperación inválido o expirado' });
    }

    const nuevoHash = await hashPassword(nuevaPassword);
    await this.database.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: nuevoHash }).where(eq(users.id, fila.userId));
      await tx.update(passwordResetTokens).set({ usedAt: ahora }).where(eq(passwordResetTokens.id, fila.id));
      // Cambiar la contraseña invalida todas las sesiones vigentes del usuario.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: ahora })
        .where(and(eq(refreshTokens.userId, fila.userId), isNull(refreshTokens.revokedAt)));
      await this.auditar({ tipo: 'reset_confirm', userId: fila.userId, origen, ahora, tx });
    });
  }

  // ── Internos ────────────────────────────────────────────────────────────────────────────────

  /**
   * Emite la sesión INICIAL tras autenticar (login / 2FA): resuelve las empresas del usuario, ata
   * la sesión a una por defecto (la primera; el usuario cambia con `cambiarEmpresa`) y devuelve los
   * tokens + la lista para el selector. Sin membresías activas → 403 (no hay empresa que operar).
   */
  private async emitirSesionInicial(
    userId: string,
    origen: OrigenPeticion,
    ahora: Date,
  ): Promise<SesionEmitida> {
    const empresas = await this.permisos.membresiasDe(userId);
    const empresaDefecto = empresas[0];
    if (empresaDefecto === undefined) {
      throw new ForbiddenException({
        codigo: 'SIN_EMPRESAS',
        message: 'Tu usuario no tiene membresía en ninguna empresa; contactá al administrador',
      });
    }
    return this.emitirSesionEmpresa(userId, empresaDefecto.tenantId, origen, ahora, empresas);
  }

  /**
   * Emite una sesión NUEVA (otra `family_id`) acotada a `tenantActivo` y devuelve los tokens + la
   * lista de empresas. Si `empresas` ya se resolvió (login), se reutiliza; si no (cambio de
   * empresa), se vuelve a leer para que el selector quede al día.
   */
  private async emitirSesionEmpresa(
    userId: string,
    tenantActivo: string,
    origen: OrigenPeticion,
    ahora: Date,
    empresas?: MembresiaEmpresa[],
  ): Promise<SesionEmitida> {
    const lista = empresas ?? (await this.permisos.membresiasDe(userId));
    const { par } = await this.emitirSesion(userId, randomUUID(), tenantActivo, origen, ahora);
    return { ...par, tenantActivo, empresas: lista };
  }

  /** Tenant por defecto del usuario (primera membresía activa); 403 si no tiene ninguna. */
  private async tenantPorDefecto(userId: string): Promise<string> {
    const empresas = await this.permisos.membresiasDe(userId);
    const primera = empresas[0];
    if (primera === undefined) {
      throw new ForbiddenException({
        codigo: 'SIN_EMPRESAS',
        message: 'Tu usuario no tiene membresía en ninguna empresa; contactá al administrador',
      });
    }
    return primera.tenantId;
  }

  /**
   * Emite un access JWT (acotado al tenant `tid`) + un refresh nuevo dentro de `familyId`,
   * persistiendo el hash del refresh y el tenant de la sesión. Devuelve también el id de la fila
   * insertada (lo usa la rotación para enlazar `rotated_to`).
   */
  private async emitirSesion(
    userId: string,
    familyId: string,
    tenantActivo: string,
    origen: OrigenPeticion,
    ahora: Date,
    tx?: DatabaseTx,
  ): Promise<{ par: ParSesion; refreshId: string }> {
    const ttl = ttlAccessSeg();
    const accessToken = firmarJwt({ sub: userId, scope: 'access', tid: tenantActivo }, claveJwt(), {
      ttlSeg: ttl,
      ahoraMs: ahora.getTime(),
    });
    const refresh = generarRefreshToken();
    const ejecutor = tx ?? this.database.db;
    const [insertado] = await ejecutor
      .insert(refreshTokens)
      .values({
        userId,
        tenantId: tenantActivo,
        familyId,
        tokenHash: refresh.hash,
        expiresAt: new Date(ahora.getTime() + ttlRefreshSeg() * 1000),
        ip: origen.ip ?? null,
        userAgent: origen.device ?? null,
      })
      .returning({ id: refreshTokens.id });
    return {
      par: { accessToken, refreshToken: refresh.valor, expiraEnSeg: ttl },
      refreshId: insertado!.id,
    };
  }

  /** Revoca todos los refresh vigentes de una familia (rotación comprometida / logout). */
  private async revocarFamilia(familyId: string, ahora: Date, tx?: DatabaseTx): Promise<void> {
    const ejecutor = tx ?? this.database.db;
    await ejecutor
      .update(refreshTokens)
      .set({ revokedAt: ahora })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /** Inserta un evento en la bitácora de identidad (`auth_events`, append-only). */
  private async auditar(args: {
    tipo: string;
    origen: OrigenPeticion;
    ahora: Date;
    userId?: string | null;
    emailIntentado?: string | null;
    metadata?: unknown;
    tx?: DatabaseTx;
  }): Promise<void> {
    const ejecutor = args.tx ?? this.database.db;
    await ejecutor.insert(authEvents).values({
      userId: args.userId ?? null,
      emailIntentado: args.emailIntentado ?? null,
      tipo: args.tipo,
      ip: args.origen.ip ?? null,
      device: args.origen.device ?? null,
      tsUtc: args.ahora,
      tsCaracas: instanteCaracasISO(args.ahora),
      metadata: args.metadata ?? null,
    });
  }
}
