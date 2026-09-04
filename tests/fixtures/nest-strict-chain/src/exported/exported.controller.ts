import { Controller, Get } from '@nestjs/common';
import { SharedRowService } from './shared-row.service';

@Controller('exported')
export class ExportedController {
  constructor(private readonly svc: SharedRowService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
