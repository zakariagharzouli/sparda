import { Body, Controller, Post } from '@nestjs/common';
import { TabService } from './tab.service';

@Controller('ambigsvc-b')
export class TabBController {
  constructor(private readonly svc: TabService) {}

  @Post()
  create(@Body() dto: any) {
    return this.svc.persist(dto);
  }
}
