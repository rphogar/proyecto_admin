import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { DevController } from './dev.controller';

/** Utilidades de desarrollo (login demo). Solo se importa cuando NODE_ENV !== 'production'. */
@Module({
  imports: [DatabaseModule],
  controllers: [DevController],
})
export class DevModule {}
