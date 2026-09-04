import { Controller, Get } from '@nestjs/common';
import { EntitymismatchService } from './entitymismatch.service';

@Controller('entitymismatch')
export class EntitymismatchController {
  constructor(private readonly svc: EntitymismatchService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
