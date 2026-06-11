import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { CapturaBcvService } from './captura-bcv.service';

const REDIS_URL = process.env.REDIS_URL ?? '';
const NOMBRE_COLA = 'tasas-bcv';

/** Deriva opciones de conexión Redis desde una URL (BullMQ crea su propio cliente ioredis). */
function opcionesRedis(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port === '' ? '6379' : u.port),
    ...(u.username === '' ? {} : { username: decodeURIComponent(u.username) }),
    ...(u.password === '' ? {} : { password: decodeURIComponent(u.password) }),
    maxRetriesPerRequest: null,
  };
}

/**
 * Programa la captura diaria de tasas BCV (~9:00 y ~17:00 VET) vía BullMQ. La lógica vive en
 * `CapturaBcvService`; aquí solo está el wiring de la cola, deliberadamente fino. Se ACTIVA solo
 * si `REDIS_URL` está configurado (en dev no hay Redis: memoria docker-no-disponible-local), así
 * el arranque no falla y la captura sigue disponible de forma manual (`POST /tasas/capturar`).
 */
@Injectable()
export class TasasScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasasScheduler.name);
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(private readonly captura: CapturaBcvService) {}

  async onModuleInit(): Promise<void> {
    if (REDIS_URL === '') {
      this.logger.log('REDIS_URL ausente: scheduler de tasas BCV inactivo (captura manual disponible)');
      return;
    }
    const connection = opcionesRedis(REDIS_URL);
    this.queue = new Queue(NOMBRE_COLA, { connection });
    await this.queue.upsertJobScheduler(
      'captura-diaria',
      { pattern: '0 9,17 * * *', tz: 'America/Caracas' },
      { name: 'capturar' },
    );
    this.worker = new Worker(NOMBRE_COLA, async () => this.captura.capturar(), { connection });
    this.worker.on('failed', (_job, err) =>
      this.logger.error(`captura BCV falló en el worker: ${err.message}`),
    );
    this.logger.log('Scheduler de tasas BCV activo (cron 9:00 y 17:00 VET)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
