import { Controller, Get } from '@nestjs/common';
import { BarrelService } from './services';

@Controller('barrel')
export class BarrelController {
  constructor(private readonly svc: BarrelService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
