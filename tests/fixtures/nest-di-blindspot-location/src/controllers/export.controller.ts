import { Controller, Post, Body } from '@nestjs/common';
import { ExportService } from 'src/services/export.service';

// E-099 reproduction, in the shape it was found in the wild: the route is here, the
// blind spot is a file away. Line 10 below is BLANK on purpose — it is the line the
// ledger used to name, because it paired this file with the service's line number.
@Controller('exports')
export class ExportController {
  constructor(private exports: ExportService) {}

  @Post()
  create(@Body() dto: any) {
    return this.exports.writeReport(dto);
  }
}
