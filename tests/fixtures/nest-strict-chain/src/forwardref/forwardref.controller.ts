import { Controller, Get } from '@nestjs/common';
import { ForwardrefService } from './forwardref.service';

@Controller('forwardref')
export class ForwardrefController {
  constructor(private readonly svc: ForwardrefService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
