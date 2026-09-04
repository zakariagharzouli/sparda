import { Controller, Get } from '@nestjs/common';
import { NobindingService } from './nobinding.service';

@Controller('nobinding')
export class NobindingController {
  constructor(private readonly svc: NobindingService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
