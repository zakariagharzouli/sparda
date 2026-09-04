import { Controller, Get } from '@nestjs/common';
import { AmbiguousPort } from './ambiguous.port';

@Controller('ambiguous')
export class AmbiguousController {
  constructor(private readonly svc: AmbiguousPort) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
