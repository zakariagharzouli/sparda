import { Controller, Get } from '@nestjs/common';
import { HiddenService } from './hidden.service';

@Controller('notexported')
export class NotexportedController {
  constructor(private readonly svc: HiddenService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
