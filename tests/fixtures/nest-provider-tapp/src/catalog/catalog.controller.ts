import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Written in the SAME parameter order as `OrdersController.edit`, and the two
  // ORMs read the two positions the other way round. That is the whole point of
  // this module: one shared role table would state the exact opposite of the
  // truth on one of them.
  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: any) {
    return this.catalog.edit(id, dto);
  }
}
