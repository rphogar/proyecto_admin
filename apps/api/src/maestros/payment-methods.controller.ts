import { Controller } from '@nestjs/common';
import { paymentMethods } from '../db/schema';
import { CrudMaestroController } from './crud-maestro.controller';
import { PaymentMethodsService } from './payment-methods.service';

/** CRUD de métodos de pago (P5). Permiso `payment_method.manage` (regla 13) al cablear guards. */
@Controller('maestros/payment-methods')
export class PaymentMethodsController extends CrudMaestroController<typeof paymentMethods.$inferSelect> {
  constructor(protected readonly servicio: PaymentMethodsService) {
    super();
  }
}
