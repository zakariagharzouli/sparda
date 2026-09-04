import { Controller, Get } from '@nestjs/common';
import { FakeforfeatureService } from './fakeforfeature.service';

@Controller('fakeforfeature')
export class FakeforfeatureController {
  constructor(private readonly svc: FakeforfeatureService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
