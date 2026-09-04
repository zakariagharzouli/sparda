import { Controller, Get } from '@nestjs/common';
import { ComputedService } from './computed.service';

@Controller('computed')
export class ComputedController {
  constructor(private readonly svc: ComputedService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
