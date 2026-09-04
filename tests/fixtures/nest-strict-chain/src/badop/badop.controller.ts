import { Controller, Get } from '@nestjs/common';
import { BadopService } from './badop.service';

@Controller('badop')
export class BadopController {
  constructor(private readonly svc: BadopService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
