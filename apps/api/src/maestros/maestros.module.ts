import { Module } from '@nestjs/common';
import { CompaniasController } from './companias.controller';
import { CompaniasService } from './companias.service';
import { ItemPricesController } from './item-prices.controller';
import { ItemPricesService } from './item-prices.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

/**
 * Módulo de maestros (P5, docs/05 §3.2 y §3.4): terceros (con validación de RIF, caso 16), ítems
 * y precios por lista, almacenes, listas de precios, métodos de pago mapeados a cuentas y series de
 * documentos. Todos company-scoped → RLS; escritura auditada (regla 5). `DatabaseService` y
 * `AuditService` llegan por los módulos globales (DatabaseModule, AuditModule).
 */
@Module({
  controllers: [
    CompaniasController,
    PartiesController,
    ItemsController,
    ItemPricesController,
    PriceListsController,
    WarehousesController,
    PaymentMethodsController,
    SeriesController,
  ],
  providers: [
    CompaniasService,
    PartiesService,
    ItemsService,
    ItemPricesService,
    PriceListsService,
    WarehousesService,
    PaymentMethodsService,
    SeriesService,
  ],
  exports: [
    PartiesService,
    ItemsService,
    ItemPricesService,
    PriceListsService,
    WarehousesService,
    PaymentMethodsService,
    SeriesService,
  ],
})
export class MaestrosModule {}
