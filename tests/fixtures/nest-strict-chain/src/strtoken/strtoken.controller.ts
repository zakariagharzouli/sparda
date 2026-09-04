import { Controller, Get, Inject } from '@nestjs/common';
import { StrtokenService } from './strtoken.service';

@Controller('strtoken')
export class StrtokenController {
  constructor(@Inject('USERS') private readonly svc: StrtokenService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
