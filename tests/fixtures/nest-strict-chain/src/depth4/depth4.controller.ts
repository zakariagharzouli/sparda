import { Controller, Get } from '@nestjs/common';
import { FourOneService } from './four-one.service';

@Controller('depth4')
export class Depth4Controller {
  constructor(private readonly one: FourOneService) {}
  @Get()
  list() {
    return this.one.list();
  }
}
