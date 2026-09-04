import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { CatalogModule } from './catalog/catalog.module';
import { DeferredModule } from './deferred/deferred.module';
import { AlphaModule } from './ambiguous/alpha.module';
import { BetaModule } from './ambiguous/beta.module';
import { ReboundModule } from './rebound/rebound.module';
import { PositionsModule } from './positions/positions.module';
import { UnplaceableModule } from './unplaceable/unplaceable.module';
import { SurfacesModule } from './surfaces/surfaces.module';
import { LookalikeModule } from './lookalike/lookalike.module';

@Module({
  imports: [
    OrdersModule,
    CatalogModule,
    DeferredModule,
    AlphaModule,
    BetaModule,
    ReboundModule,
    PositionsModule,
    UnplaceableModule,
    SurfacesModule,
    LookalikeModule,
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
