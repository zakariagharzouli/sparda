import { Controller, Get } from '@nestjs/common';
import { AggregateService } from './aggregate.service';

@Controller('aggregate')
export class AggregateController {
  constructor(private readonly svc: AggregateService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
