import { Controller, Get } from '@nestjs/common';
import { CompaniasService, type CompaniaDto } from './companias.service';

/**
 * Empresas (RIF) del tenant activo (P28). El selector de empresa del frontend lista esto tras
 * entrar para elegir/defaultear la empresa de trabajo dentro del tenant del token. Solo lectura;
 * el tenant ya viene acotado por el JWT (middleware) → RLS.
 */
@Controller('maestros/companias')
export class CompaniasController {
  constructor(private readonly companias: CompaniasService) {}

  @Get()
  async listar(): Promise<CompaniaDto[]> {
    return this.companias.listar();
  }
}
