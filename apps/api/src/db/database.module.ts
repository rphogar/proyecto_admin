import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Módulo global de base de datos: expone `DatabaseService` (Drizzle sobre postgres.js) a toda
 * la app. Global porque la mayoría de los módulos de negocio necesitarán la DB.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
