import { Controller, Get } from '@nestjs/common';
import { FakeinjectableService } from './fakeinjectable.service';

@Controller('fakeinjectable')
export class FakeinjectableController {
  constructor(private readonly svc: FakeinjectableService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
