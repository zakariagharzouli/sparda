import { Controller, Get } from '@nestjs/common';
import { NotinjectableService } from './notinjectable.service';

@Controller('notinjectable')
export class NotinjectableController {
  constructor(private readonly svc: NotinjectableService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
