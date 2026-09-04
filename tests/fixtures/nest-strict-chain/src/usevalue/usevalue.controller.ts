import { Controller, Get } from '@nestjs/common';
import { UsevalueService } from './usevalue.service';

@Controller('usevalue')
export class UsevalueController {
  constructor(private readonly svc: UsevalueService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
