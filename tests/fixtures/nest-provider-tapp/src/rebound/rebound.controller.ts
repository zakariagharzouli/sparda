import { Body, Controller, Post } from '@nestjs/common';
import { ReboundService } from './rebound.service';

@Controller('rebound')
export class ReboundController {
  constructor(private readonly svc: ReboundService) {}

  // the value that reaches the provider is NOT the one the client sent
  @Post('ctrl')
  ctrl(@Body() dto: any) {
    dto = { ...dto, tenant: 'fixed' };
    return this.svc.plain(dto);
  }

  @Post('svc')
  svc2(@Body() dto: any) {
    return this.svc.overwrites(dto);
  }
}
