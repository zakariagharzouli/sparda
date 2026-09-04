import { Controller, Get } from '@nestjs/common';
import { TypeormService } from './typeorm.service';

@Controller('typeorm')
export class TypeormController {
  constructor(private readonly svc: TypeormService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
