import { Controller, Get } from '@nestjs/common';
import { MutatedService } from './mutated.service';

@Controller('mutated')
export class MutatedController {
  constructor(private readonly svc: MutatedService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
