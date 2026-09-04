import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // the whole body travels, unnarrowed
  @Post()
  create(@Body() dto: any) {
    return this.orders.create(dto);
  }

  // a PIPE is a transform, not a launderer: it belongs IN the path
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.remove(id);
  }

  // TypeORM `update(criteria, partialEntity)` — the id selects, the body writes
  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: any) {
    return this.orders.edit(id, dto);
  }

  // static keys, nested: the destination is where the value LANDED
  @Post('profile')
  profile(@Body() dto: any) {
    return this.orders.store(dto);
  }
}
