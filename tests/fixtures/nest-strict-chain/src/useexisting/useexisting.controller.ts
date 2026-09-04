import { Controller, Get } from '@nestjs/common';
import { AliasPort } from './alias.port';

@Controller('useexisting')
export class UseExistingController {
  constructor(private readonly svc: AliasPort) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
