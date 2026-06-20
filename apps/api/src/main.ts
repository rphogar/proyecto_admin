import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // CORS: el frontend (Next, otro origen) no podía llamar a la API sin esto — el navegador
  // bloqueaba toda petición cross-origin. Se restringe al origen de la web (configurable) y se
  // permiten las cabeceras de contexto de tenant/actor hasta que la auth real las reemplace.
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-user-id'],
  });

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
