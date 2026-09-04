import { Controller, Get, Param } from '@nestjs/common';
import { BoxesService } from './boxes.service';

@Controller('boxes')
export class BoxesController {
  constructor(private readonly boxes: BoxesService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.boxes.findOne(id);
  }
}
