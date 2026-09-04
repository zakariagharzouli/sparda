import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ORDERS_SERVICE } from './orders.tokens';
import type { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  // TOKEN injection: the container decides what is behind ORDERS_SERVICE. The
  // source does not.
  constructor(@Inject(ORDERS_SERVICE) private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }
}
