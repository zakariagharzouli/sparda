import { Body, Controller, Post } from '@nestjs/common';
import { LeafService } from './services';

@Controller('barrel')
export class BarrelController {
  constructor(private readonly svc: LeafService) {}

  @Post()
  create(@Body() dto: any) {
    return this.svc.persist(dto);
  }
}
