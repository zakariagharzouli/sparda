import { Body, Controller, Post } from '@nestjs/common';
import { PinAService } from './pin-a.service';

@Controller('ambigctrl')
export class PinController {
  constructor(private readonly svc: PinAService) {}

  @Post()
  create(@Body() dto: any) {
    return this.svc.persist(dto);
  }
}
