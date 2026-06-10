import { Controller, Get } from '@nestjs/common';

interface HealthStatus {
  status: 'ok';
  service: string;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return { status: 'ok', service: 'contave-api' };
  }
}
