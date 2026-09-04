import { Controller, Get } from '@nestjs/common';
import { CallbackService } from './callback.service';

@Controller('callback')
export class CallbackController {
  constructor(private readonly svc: CallbackService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
