import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './orders.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ORDERS_SERVICE } from './orders.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
  // a token provider: the binding is a container decision, not a source fact
  providers: [{ provide: ORDERS_SERVICE, useClass: OrdersService }],
})
export class OrdersModule {}
