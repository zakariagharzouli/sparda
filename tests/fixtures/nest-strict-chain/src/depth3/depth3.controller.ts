import { Controller, Get } from '@nestjs/common';
import { HopOneService } from './hop-one.service';

@Controller('depth3')
export class Depth3Controller {
  constructor(private readonly one: HopOneService) {}
  @Get()
  list() {
    return this.one.list();
  }
}
