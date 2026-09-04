import { Controller, Get, Param } from '@nestjs/common';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notes.findOne(id);
  }
}
