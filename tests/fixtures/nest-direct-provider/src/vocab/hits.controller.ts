import { Controller, Post, Param } from '@nestjs/common';
import { HitsService } from './hits.service';

@Controller('hits')
export class HitsController {
  constructor(private readonly hits: HitsService) {}

  @Post(':id')
  bump(@Param('id') id: string) {
    return this.hits.bump(id);
  }
}
