import { Controller, Get, Inject, Param } from '@nestjs/common';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  // The providers list IS literal — every other check passes. The parameter
  // decorator is the only thing between this and a stated linkage, because
  // `@Inject` hands the choice back to the container.
  constructor(@Inject(TagsService) private readonly tags: TagsService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tags.findOne(id);
  }
}
