import { Controller, Get } from '@nestjs/common';
import { FakeOrmService } from './fakeorm.service';

@Controller('fakeorm')
export class FakeOrmController {
  constructor(private readonly svc: FakeOrmService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
