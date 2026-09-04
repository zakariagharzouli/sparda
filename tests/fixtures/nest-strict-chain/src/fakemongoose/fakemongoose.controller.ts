import { Controller, Get } from '@nestjs/common';
import { FoxService } from './fox.service';

@Controller('fakemongoose')
export class FoxController {
  constructor(private readonly svc: FoxService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
