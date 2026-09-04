import { Controller, Get } from '@nestjs/common';
import { FakebridgeService } from './fakebridge.service';

@Controller('fakebridge')
export class FakebridgeController {
  constructor(private readonly svc: FakebridgeService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
