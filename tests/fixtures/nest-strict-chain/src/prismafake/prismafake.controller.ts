import { Controller, Get } from '@nestjs/common';
import { PrismaFakeService } from './prismafake.service';

@Controller('prismafake')
export class PrismaFakeController {
  constructor(private readonly svc: PrismaFakeService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
