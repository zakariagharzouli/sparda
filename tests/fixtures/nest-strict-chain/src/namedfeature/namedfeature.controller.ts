import { Controller, Get } from '@nestjs/common';
import { NamedfeatureService } from './namedfeature.service';

@Controller('namedfeature')
export class NamedfeatureController {
  constructor(private readonly svc: NamedfeatureService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
