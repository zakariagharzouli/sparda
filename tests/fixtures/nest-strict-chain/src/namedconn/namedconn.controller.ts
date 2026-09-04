import { Controller, Get } from '@nestjs/common';
import { NamedconnService } from './namedconn.service';

@Controller('namedconn')
export class NamedconnController {
  constructor(private readonly svc: NamedconnService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
