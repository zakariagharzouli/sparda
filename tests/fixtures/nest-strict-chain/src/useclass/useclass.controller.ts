import { Controller, Get } from '@nestjs/common';
import { UseClassPort } from './useclass.port';

@Controller('useclass')
export class UseClassController {
  constructor(private readonly svc: UseClassPort) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
