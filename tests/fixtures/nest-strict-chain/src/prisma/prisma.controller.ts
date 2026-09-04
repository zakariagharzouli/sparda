import { Controller, Get } from '@nestjs/common';
import { PrismaBackedService } from './prisma-backed.service';

@Controller('prisma')
export class PrismaBackedController {
  constructor(private readonly svc: PrismaBackedService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
