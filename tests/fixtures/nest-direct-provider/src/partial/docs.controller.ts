import { Controller, Get, Param } from '@nestjs/common';
import { DocsService } from './docs.service';

@Controller('docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.docs.findOne(id);
  }
}
