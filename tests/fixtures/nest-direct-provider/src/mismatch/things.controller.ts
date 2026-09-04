import { Controller, Get, Param } from '@nestjs/common';
import { ThingsService } from './things.service';

@Controller('things')
export class ThingsController {
  constructor(private readonly things: ThingsService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.things.findOne(id);
  }
}
